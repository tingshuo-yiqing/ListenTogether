/**
 * 一起听歌 · 外部音乐元数据源共享实现（Hi歌曲 / QQ 音乐 / 网易云音乐 / MusicBrainz）
 *
 * 谁在用：scripts/metadata-manager.mjs 的界面端点。原先它是独立命令行脚本
 *   scripts/fetch-metadata.mjs，2026-09-27 并入可视化管理器后删除，避免同一套
 *   查询与打分口径存在两份实现——两份会漂移，届时"界面判可写、脚本判需复核"。
 *
 * Hi歌曲HTML适配见 higequ.mjs；管理器默认优先使用它，再回退以下三个API源。
 * 为什么保留三个API源：本库以华语流行为主，MusicBrainz 的中文录音条目常缺 artist-credit
 *   或只有罗马字转写（代码里"带艺术家查不到就退回只按歌名"的兜底就是为此而写）；
 *   QQ 音乐/网易云的中文目录覆盖远好于它。三者字段口径在此归一为同一 candidate 形状。
 *
 * 单位与时钟域：durationMs 为毫秒整数；year 为四位公历年；score 归一到 0–1，
 *   与界面阈值同一量纲，不做二次换算。三源的时长原生单位不同（MB=毫秒、QQ=秒、
 *   网易云=毫秒），一律在各自 mapper 里换算完再出。
 *
 * 并发与限速：每个源各持一个节流队列（Date.now 墙钟，仅用于节流，不参与判定）。
 *   队列是实例级而非全局，因此进程内每个源只允许存在一个供批量使用的实例；
 *   换源跑批量用的是另一条队列，不会叠加同一平台的请求频率。
 *   MB 官方政策 1 请求/秒；QQ/网易云无公开政策，按其反爬表现取 800ms 保守值。
 *
 * 失败行为：网络/HTTP/JSON 解析错误一律抛给调用方，由调用方决定是"记 network-error
 *   继续下一首"还是"整次失败"——本模块不吞异常、也不静默降级成空候选。
 *   （唯一例外：网易云主接口失败时会重试其备用接口，两条都失败才抛。）
 *
 * 可测性：出网请求与延迟都经注入（request/sleep/now），单测传假实现即可完全离线，
 *   不访问公网（与 docs/modules/10-testing-observability.md 的分层约定一致）。
 */

import { createHiGequ } from './higequ.mjs';

const DEFAULT_ROOT = 'https://musicbrainz.org/ws/2';
const DEFAULT_USER_AGENT = 'ListenTogetherMetadata/0.1 (local project tool)';
const DEFAULT_DELAY_MS = 1100;
const DEFAULT_TIMEOUT_MS = 15000;
export const DEFAULT_MIN_SCORE = 0.8;

// 两个国内平台的接口口径（2026-09-27 实测确认，非猜测）：
//   QQ  搜索 GET  c.y.qq.com/soso/fcgi-bin/search_for_qq_cp  → data.song.list（含 pubtime/albummid）
//       已失效：client_search_cp（HTTP 500）、musicu.fcg 的 music.search.SearchCgiService（空列表）
//   网易 搜索 POST music.163.com/api/cloudsearch/pc          → result.songs（含 dt/al.picUrl）
//       已失效：/api/search/get/web（响应体被 AES 加密）
// 平台会改接口，故这些常量集中在此，出错时先看这里。
const QQ_SEARCH = 'https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp';
const QQ_REFER = 'https://y.qq.com/';
const QQ_COVER = 'https://y.gtimg.cn/music/photo_new/T002R800x800M000{mid}.jpg';
const NETEASE_SEARCH = 'https://music.163.com/api/cloudsearch/pc';
const NETEASE_SEARCH_FALLBACK = 'https://music.163.com/api/search/get';
const NETEASE_REFER = 'https://music.163.com/';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CN_DELAY_MS = 800;
const SEARCH_LIMIT = 5;

/**
 * 名次 → 相关度（0–100，对齐 MusicBrainz 的 score 量纲，使打分函数三源通用）。
 * QQ/网易云不返回数值相关度，但结果列表本身按平台相关性排序，名次就是它们唯一的
 * 相关性信号。用它填满打分公式里 0.35 的那一格，好处是：
 * 命中榜首且标题艺术家全等 → 1.0；榜首是翻唱（艺术家不符）→ 0.75，够不到默认阈值 0.8。
 */
export function rankScore(index, total) {
  const n = Number(total) || 0;
  if (n <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((100 * (n - index)) / n)));
}

/**
 * 纪元时间 → 四位年份。QQ 的 pubtime 是秒、网易云 publishTime 是毫秒且常为 0，
 * 故按量级判单位（>1e11 视为毫秒）。取 UTC 年：12-31/01-01 边界的发行日可能差一年，
 * 年份只是展示字段，为此引入时区表不值得；0 与非法值一律 null，不得当成 1970。
 */
export function epochYear(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e11 ? n : n * 1000;
  const year = new Date(ms).getUTCFullYear();
  return Number.isFinite(year) && year > 1900 && year < 2100 ? year : null;
}

/** 秒 → 毫秒；0/负数/非数一律 null（不得把"平台没给时长"写成 0 分参与打分）。 */
function secondsToMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
}
function millisToMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** 节流队列：串行化同一源的所有出网请求。send 负责真正的 fetch，异常原样抛出。 */
function createThrottler({ delayMs, send, sleep, now }) {
  let lastRequestAt = 0;
  return async function call(url, options) {
    const wait = delayMs - (now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();
    return send(url, options);
  };
}

/** 折叠空白并去首尾；非字符串归一为空串，便于后面所有字段统一按真值判断。 */
export function clean(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * 比较用归一化：小写、去括注里的版本标记（现场/重制版等）、符号统一、只留字母数字。
 * 注意 localeCompare 无关——这里只做包含比较，跨语言标题（中文原名 vs 罗马字转写）
 * 归一后仍不相等，属预期：那种情况应由人工在界面里填，不靠打分兜底。
 */
export function normalize(value) {
  return clean(value)
    .toLocaleLowerCase('zh-CN')
    .replace(/[（(].*?(现场|live|remaster|remastered|版本|版).*?[）)]/giu, '')
    .replace(/[&＋+]/gu, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** 从任意日期字符串取四位年份；取不到返回 null（不要把 0 当合法年份）。 */
export function safeYear(value) {
  const match = String(value ?? '').match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

/** MusicBrainz artist-credit 是分段数组（含链接关系），拼成 "A & B" 单串供落库。 */
export function artistCredit(credit) {
  return (Array.isArray(credit) ? credit : [])
    .map((part) => clean(part?.name || part?.artist?.name))
    .filter(Boolean)
    .join(' & ');
}

/** 缓存与报告都用这一把键：换文件或改标题即失效，不会把旧候选当真。 */
export function cacheKey(entry) {
  return `${entry.id}:${entry.file}:${entry.title}:${entry.artist || ''}`;
}

/**
 * 查询用本地画像：catalog 手填值优先、ID3 兜底，与后端 artist 的取值优先级同一口径。
 * 抽出来是为了让"界面里看到的生效值"和"送去匹配的输入"必然一致，否则打分依据与
 * 显示依据会分叉，用户无从判断候选为什么没命中。
 */
export function mergeLocalFields(entry, id3) {
  return {
    title: clean(entry.title),
    artist: clean(entry.artist) || clean(id3?.artist),
    album: clean(entry.album) || clean(id3?.album),
    year: entry.year || id3?.year || null,
    genre: clean(entry.genre) || clean(id3?.genre),
    durationMs: Number(id3?.durationMs) || 0,
  };
}

/**
 * 读 MP3 的 ID3 常用标签（艺术家/专辑/流派/年份/时长/内嵌封面）。
 * parseFile 由调用方注入（server/node_modules 的 music-metadata）：lib 自身保持零依赖、
 * 可离线单测；读失败按无标签处理，绝不抛——ID3 只是兜底参考，不该拖垮一次匹配。
 */
export async function readId3Tags(filePath, parseFile) {
  try {
    const meta = await parseFile(filePath, { duration: true });
    const c = meta.common;
    const picture = c.picture?.[0];
    return {
      artist: typeof c.artist === 'string' && c.artist.trim() ? c.artist.trim() : null,
      album: typeof c.album === 'string' && c.album.trim() ? c.album.trim() : null,
      genre: Array.isArray(c.genre) && c.genre[0] ? String(c.genre[0]).trim() : null,
      year: typeof c.year === 'number' && c.year > 0 ? c.year : null,
      durationMs: Math.round((meta.format.duration ?? 0) * 1000),
      cover: picture ? { mime: picture.format, data: Buffer.from(picture.data) } : null,
    };
  } catch {
    return { artist: null, album: null, genre: null, year: null, durationMs: 0, cover: null };
  }
}

/**
 * 查询串构造。MusicBrainz 的 query 语法里反斜杠与双引号是结构字符，
 * 标题/歌手来自曲库（可能是任意手填内容），故必须先剥掉再拼——
 * 否则 `歌名"` 会把查询语法打断，报 400 或被解析成别的条件。
 */
export function queryFor(local) {
  const title = clean(local.title).replace(/([\\"])/g, '');
  const artist = clean(local.artist).replace(/([\\"])/g, '');
  return artist ? `recording:"${title}" AND artist:"${artist}"` : `recording:"${title}"`;
}

/**
 * 候选打分（0–1）。分值构成是人为定的启发式，不是 MusicBrainz 的 score：
 * 官方 score 只反映检索相关度（词频/权重），对"是不是同一首歌"并不可靠，
 * 故只占 0.35 权重，其余给标题、艺术家、时长的实际一致性。总和封顶 1。
 */
export function scoreCandidate(local, candidate) {
  const localTitle = normalize(local.title);
  const candidateTitle = normalize(candidate.title);
  const localArtist = normalize(local.artist);
  const candidateArtist = normalize(candidate.artist);
  let score = Math.max(0, Math.min(1, Number(candidate.score || 0) / 100)) * 0.35;
  if (localTitle && localTitle === candidateTitle) score += 0.4;
  else if (localTitle && (candidateTitle.includes(localTitle) || localTitle.includes(candidateTitle))) score += 0.2;
  if (localArtist && localArtist === candidateArtist) score += 0.2;
  else if (localArtist && (candidateArtist.includes(localArtist) || localArtist.includes(candidateArtist))) score += 0.1;
  if (local.durationMs && candidate.durationMs) {
    const delta = Math.abs(local.durationMs - candidate.durationMs);
    if (delta <= 2000) score += 0.05;
    else if (delta <= 10000) score += 0.02;
  }
  return Math.min(1, score);
}

/** 搜索结果条目 → 内部候选形状（搜索态已带首个 release，够算分，不够权威）。 */
export function mapSearchCandidate(result) {
  const release = Array.isArray(result.releases) ? result.releases[0] : null;
  return {
    mbid: result.id || null,
    title: clean(result.title),
    artist: artistCredit(result['artist-credit']),
    album: clean(release?.title),
    year: safeYear(release?.date),
    durationMs: Number.isFinite(result.length) ? result.length : null,
    score: Number(result.score || 0),
    releaseId: release?.id || null,
    releaseGroupId: release?.['release-group']?.id || null,
  };
}

/**
 * 生效值映射：候选 → 本次可写入 catalog 的字段集合。
 * 默认只补缺失（手填值优先，与后端 artist 取值的优先级一致）；
 * force=true 才允许覆盖已有值——界面上对应"逐字段勾选后应用"，
 * 那时用户已经看过候选，覆盖是明确意图。空值一律不写，避免用候选的空串抹掉好数据。
 */
export function buildChanges(entry, candidate, force) {
  const fields = ['artist', 'album', 'year', 'genre'];
  const changes = {};
  for (const field of fields) {
    const next = candidate?.[field];
    if (next === null || next === undefined || next === '') continue;
    if (force || entry[field] === undefined || entry[field] === null || entry[field] === '') {
      changes[field] = next;
    }
  }
  return changes;
}

/** 封面候选只给地址、不下载：没有人工确认就把外部图片写进曲库是不可控的。 */
export function coverCandidate(candidate) {
  if (!candidate?.releaseId) return null;
  return `https://coverartarchive.org/release/${candidate.releaseId}/front-250`;
}

/**
 * QQ 音乐搜索条目 → 统一候选。原生字段：songname/singer[].name/albumname/albummid/
 * interval（秒）/pubtime（纪元秒）。一次搜索即拿全 artist/album/year/duration，
 * 不需再发详情请求（详情接口的 genre 是数字枚举，不是可读流派，故 genre 留空）。
 * 注意忽略 *_hilight 系列字段：那是平台拼好的 <span> 高亮 HTML，只用纯字段。
 */
export function mapQQCandidate(raw, index, total) {
  const mid = clean(raw?.songmid || raw?.mid);
  if (!mid) return null;
  const album = typeof raw.album === 'object' && raw.album ? raw.album : {};
  const albumMid = clean(raw.albummid || album.mid);
  const singers = (Array.isArray(raw.singer) ? raw.singer : [])
    .map((s) => clean(s?.name || s?.title))
    .filter(Boolean);
  return {
    source: 'qq',
    id: mid,
    title: clean(raw.songname || raw.title),
    artist: singers.join(' & '),
    album: clean(typeof raw.albumname === 'string' ? raw.albumname : album.name),
    year: epochYear(raw.pubtime),
    genre: '',
    durationMs: secondsToMs(raw.interval),
    score: rankScore(index, total),
    coverUrl: albumMid ? QQ_COVER.replace('{mid}', encodeURIComponent(albumMid)) : null,
  };
}

/**
 * 网易云搜索条目 → 统一候选。cloudsearch 用短键（name/ar/al/dt），旧接口用长键
 * （artists/album/duration），两套都要认——主接口失败时会退到旧接口。
 * dt 是毫秒；publishTime 经常缺失（0），此时 year 为 null 而非 1970。
 * 该平台头部结果常被翻唱/AI 翻唱占据且时长可能截短，靠打分卡住，不靠它自己的排序。
 */
export function mapNeteaseCandidate(raw, index, total) {
  const id = raw?.id ?? raw?.songId;
  if (id === undefined || id === null || id === '') return null;
  const ar = Array.isArray(raw.ar) ? raw.ar : (Array.isArray(raw.artists) ? raw.artists : []);
  const al = (raw.al && typeof raw.al === 'object') ? raw.al
    : ((raw.album && typeof raw.album === 'object') ? raw.album : {});
  const picUrl = clean(al.picUrl);
  return {
    source: 'netease',
    id: String(id),
    title: clean(raw.name),
    artist: ar.map((a) => clean(a?.name)).filter(Boolean).join(' & '),
    album: clean(al.name),
    year: epochYear(raw.publishTime ?? al.publishTime),
    genre: '',
    durationMs: millisToMs(raw.dt ?? raw.duration),
    score: rankScore(index, total),
    // 网易云的 picUrl 自带 ?param= 尺寸后缀，剥掉后原样给出；不代抓字节。
    coverUrl: picUrl ? picUrl.split('?')[0] : null,
  };
}

/**
 * 默认出网实现（三源共用）。失败行为：HTTP 非 2xx、超时、响应非 JSON 一律抛异常，
 * 异常信息里带上响应首段（截断到 160 字，避免整页 HTML 灌进日志），
 * 让调用方能把"被风控"与"这首歌真没有"区分开。
 */
async function defaultRequest(url, options = {}) {
  const { userAgent, referer, timeoutMs = DEFAULT_TIMEOUT_MS, method = 'GET', headers = {}, body } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      body,
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent,
        ...(referer ? { Referer: referer } : {}),
        ...headers,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`响应不是 JSON：${text.slice(0, 160)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 建一个 MusicBrainz 客户端。返回：
 *   findMetadata(local, {minScore}) → { source, query, candidate, score, lookedUp, coverUrl }
 *   lookupRecording(candidate)      → 取录音详情（专辑/年份/流派以此为准）
 * candidate 为 null 或 score < minScore 都表示"要人工看"，调用方不得自动落库。
 */
export function createMusicBrainz(options = {}) {
  const {
    root = DEFAULT_ROOT,
    userAgent = DEFAULT_USER_AGENT,
    delayMs = DEFAULT_DELAY_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    minScore = DEFAULT_MIN_SCORE,
    request = defaultRequest,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
  } = options;

  const get = createThrottler({
    delayMs, sleep, now,
    send: (url) => request(url, { userAgent, timeoutMs }),
  });

  async function search(url) {
    const json = await get(url);
    return (json.recordings || []).map(mapSearchCandidate);
  }

  async function lookupRecording(candidate) {
    if (!candidate.mbid) return candidate;
    const url = `${root}/recording/${encodeURIComponent(candidate.mbid)}?inc=artists+releases+genres&fmt=json`;
    const detail = await get(url);
    // 同一录音可能挂在多个发行版上；取日期最早的，语义是"最初发行"而非"最新再版"。
    // 无日期的条目必须排在有日期的之后：发行列表里常混着不带日期的推广版/精选，
    // 若让它们以空串胜出（字符串比较里空串最小），年份会变成 null、专辑会变成推广版名。
    const release = (detail.releases || [])
      .filter((item) => item?.title)
      .sort((a, b) => {
        if (!a.date && b.date) return 1;
        if (a.date && !b.date) return -1;
        return String(a.date || '').localeCompare(String(b.date || ''));
      })[0];
    const genres = Array.isArray(detail.genres) ? detail.genres : [];
    return {
      ...candidate,
      title: clean(detail.title) || candidate.title,
      artist: artistCredit(detail['artist-credit']) || candidate.artist,
      album: clean(release?.title) || candidate.album,
      year: safeYear(release?.date) || candidate.year,
      genre: clean(genres[0]?.name),
      releaseId: release?.id || candidate.releaseId,
      releaseGroupId: release?.['release-group']?.id || candidate.releaseGroupId,
    };
  }

  async function findMetadata(local, { minScore: override } = {}) {
    const threshold = Number.isFinite(override) ? override : minScore;
    const query = queryFor(local);
    const searchUrl = `${root}/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=5`;
    let candidates = await search(searchUrl);
    // 中文录音的 artist-credit 常不规范（缺字、变体写法）；带艺术家查不到时退回只按歌名查。
    if (!candidates.length && clean(local.artist)) {
      const fallback = `${root}/recording/?query=${encodeURIComponent(queryFor({ title: local.title }))}&fmt=json&limit=5`;
      candidates = await search(fallback);
    }
    if (!candidates.length) {
      return { source: 'musicbrainz', query, candidate: null, score: 0, lookedUp: false, coverUrl: null };
    }
    const ranked = candidates
      .map((candidate) => ({ candidate, score: scoreCandidate(local, candidate) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    // 低于阈值不值得再花一次详情请求（也省限速配额），原样回给调用方去人工复核。
    if (!best || best.score < threshold) {
      const candidate = best?.candidate || null;
      return {
        source: 'musicbrainz',
        query,
        candidate,
        score: best?.score || 0,
        lookedUp: false,
        coverUrl: coverCandidate(candidate),
      };
    }
    const detailed = await lookupRecording(best.candidate);
    return {
      source: 'musicbrainz',
      query,
      candidate: detailed,
      score: best.score,
      lookedUp: true,
      coverUrl: coverCandidate(detailed),
    };
  }

  return { name: 'musicbrainz', label: 'MusicBrainz', findMetadata, lookupRecording, search };
}

/** 平台通用外壳：把"发一次搜索 → mapper 归一 → 打分选优"这段三源同构的流程收在一处。 */
function pickBestCandidate(local, candidates) {
  const list = candidates.filter(Boolean);
  if (!list.length) return null;
  return list
    .map((candidate) => ({ candidate, score: scoreCandidate(local, candidate) }))
    .sort((a, b) => b.score - a.score)[0];
}

/**
 * QQ 音乐源。只需一次搜索请求即可拿到 artist/album/year/duration/封面地址。
 * 接口必须带 Referer: https://y.qq.com/，否则平台返回非 JSON；缺失字段直接抛，
 * 由管理器显示"该曲查询失败"，不降级成"没找到"。
 */
export function createQQMusic(options = {}) {
  const {
    userAgent = BROWSER_UA,
    referer = QQ_REFER,
    delayMs = CN_DELAY_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    minScore = DEFAULT_MIN_SCORE,
    limit = SEARCH_LIMIT,
    request = defaultRequest,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
  } = options;

  const call = createThrottler({
    delayMs, sleep, now,
    send: (url) => request(url, { userAgent, referer, timeoutMs }),
  });

  async function search(keyword) {
    const params = new URLSearchParams({
      w: keyword, p: '1', n: String(limit), format: 'json',
      cr: '1', new_json: '1', catZhida: '1', remoteplace: 'txt.yqq.center', type: '0', t: '0',
    });
    const json = await call(`${QQ_SEARCH}?${params}`, {});
    const list = json?.data?.song?.list;
    if (!Array.isArray(list)) {
      // 平台改版或被风控时会返回 HTML/空体：抛出来比静默"无候选"诚实。
      throw new Error('QQ 音乐响应缺少 data.song.list');
    }
    return list.slice(0, limit).map((raw, i) => mapQQCandidate(raw, i, list.length)).filter(Boolean);
  }

  async function findMetadata(local, { minScore: override } = {}) {
    const threshold = Number.isFinite(override) ? override : minScore;
    // QQ 的关键词检索直接吃"歌名 + 歌手"，不像 MB 那样需要字段级查询语法。
    const query = [clean(local.title), clean(local.artist)].filter(Boolean).join(' ');
    const candidates = await search(query);
    const best = pickBestCandidate(local, candidates);
    if (!best) return { source: 'qq', query, candidate: null, score: 0, lookedUp: false, coverUrl: null };
    return {
      source: 'qq',
      query,
      candidate: best.candidate,
      score: best.score,
      // 搜索态字段已够全（artist/album/year/duration），故本源没有 MB 那样的二次详情请求。
      lookedUp: false,
      coverUrl: best.score >= threshold ? best.candidate.coverUrl : null,
    };
  }

  return { name: 'qq', label: 'QQ 音乐', findMetadata, search };
}

/**
 * 网易云音乐源。主接口 cloudsearch（POST 表单）；实测 /api/search/get/web 已被
 * AES 加密不可用，故失败时退到旧版 /api/search/get，两条都不通才抛。
 */
export function createNetEase(options = {}) {
  const {
    userAgent = BROWSER_UA,
    referer = NETEASE_REFER,
    delayMs = CN_DELAY_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    minScore = DEFAULT_MIN_SCORE,
    limit = SEARCH_LIMIT,
    request = defaultRequest,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
  } = options;

  const call = createThrottler({
    delayMs, sleep, now,
    send: (url, opts) => request(url, {
      userAgent, referer, timeoutMs, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(opts.form).toString(),
    }),
  });

  async function searchOne(url, form) {
    const json = await call(url, { form });
    const list = json?.result?.songs;
    if (!Array.isArray(list)) throw new Error('网易云响应缺少 result.songs');
    return list.slice(0, limit).map((raw, i) => mapNeteaseCandidate(raw, i, list.length)).filter(Boolean);
  }

  async function search(keyword) {
    const form = { s: keyword, type: '1', limit: String(limit), offset: '0' };
    try {
      return await searchOne(NETEASE_SEARCH, { ...form, total: 'true' });
    } catch (primaryError) {
      // 只有主接口本身不通才退旧接口；两条都不通就把两个原因一起抛出，
      // 只报后者会把"cloudsearch 被风控"这一真实原因藏掉。
      try {
        return await searchOne(NETEASE_SEARCH_FALLBACK, form);
      } catch (fallbackError) {
        throw new Error(`网易云两个搜索接口均失败：主=${primaryError.message}；备=${fallbackError.message}`);
      }
    }
  }

  async function findMetadata(local, { minScore: override } = {}) {
    const threshold = Number.isFinite(override) ? override : minScore;
    const query = [clean(local.title), clean(local.artist)].filter(Boolean).join(' ');
    const candidates = await search(query);
    const best = pickBestCandidate(local, candidates);
    if (!best) return { source: 'netease', query, candidate: null, score: 0, lookedUp: false, coverUrl: null };
    return {
      source: 'netease',
      query,
      candidate: best.candidate,
      score: best.score,
      lookedUp: false,
      // 封面地址只随达阈值的候选给出：低于阈值时整条候选都待人工判断，
      // 此时还递一个"点一下就存图"的链接，等于在没确认身份前就催用户取图。
      coverUrl: best.score >= threshold ? best.candidate.coverUrl : null,
    };
  }

  return { name: 'netease', label: '网易云音乐', findMetadata, search };
}

/** 源注册表：管理器据此校验界面传来的 source 参数，新源在此登记即可出现在界面下拉里。 */
export const METADATA_SOURCES = [
  { name: 'higequ', label: 'Hi歌曲优先（未命中时尝试其他来源）', create: options => createHiGequ(scoreCandidate, options) },
  { name: 'qq', label: 'QQ 音乐（华语覆盖最好，一次请求拿全字段）', create: createQQMusic },
  { name: 'netease', label: '网易云音乐（翻唱/AI 版本多，靠阈值卡住）', create: createNetEase },
  { name: 'musicbrainz', label: 'MusicBrainz（有流派与权威专辑年份，中文条目偏弱）', create: createMusicBrainz },
];
export const DEFAULT_SOURCE = 'higequ';

export function createMetadataSource(name, options = {}) {
  const found = METADATA_SOURCES.find((s) => s.name === name);
  if (!found) throw new Error(`未知的元数据源：${name}`);
  return found.create(options);
}
