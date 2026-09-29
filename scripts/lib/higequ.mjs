/** Hi歌曲公开HTML适配：只读搜索与详情；音频下载为 2026-09-29 用户决策新增（单曲手动触发、仅开发测试用途，见 parseHiAudio）。 */
import { fetchLimited, allowedCoverUrl, allowedAudioUrl, LYRICS_LIMIT } from './metadata-assets.mjs';
const ROOT = 'https://higequ.com';
const identity = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

/** 只解码文本实体；剥HTML在解实体之前，防止把转义文字误当成真实标签。 */
export function htmlText(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value || '').replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, key) => {
    if (key[0] !== '#') return entities[key.toLowerCase()];
    const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  }).replace(/\s+/g, ' ').trim();
}
function attr(tag, name) {
  return tag.match(new RegExp('\\b' + name + '=(["\'])([\\s\\S]*?)\\1', 'i'))?.[2] || '';
}
function field(block, name) {
  const hit = block.match(new RegExp('<(?:div|span)\\b[^>]*class=["\'][^"\']*\\b' + name + '\\b[^"\']*["\'][^>]*>([\\s\\S]*?)</(?:div|span)>', 'i'));
  return htmlText(hit?.[1]);
}

export function parseHiSearch(html) {
  const starts = [...html.matchAll(/<div\b[^>]*class=["'][^"']*\bresult-item\b[^"']*["'][^>]*>/gi)];
  if (!starts.length && !/暂无|没有找到|未找到|无搜索结果/.test(html)) throw new Error('Hi歌曲搜索页面结构变化，已跳过');
  return starts.slice(0, 10).map((hit, i) => {
    const id = attr(hit[0], 'data-rid');
    if (!/^\d{1,20}$/.test(id)) return null;
    const block = html.slice(hit.index + hit[0].length, starts[i + 1]?.index ?? html.length);
    const title = field(block, 'result-title'), artist = field(block, 'result-artist');
    if (!title || !artist) return null;
    return { source: 'higequ', id, title, artist, album: field(block, 'result-album').replace(/^专辑\s*[:：]\s*/, ''),
      year: null, genre: '', durationMs: null, score: Math.max(0, 100 - i * 5),
      sourceUrl: ROOT + '/player/' + id + '/' };
  }).filter(Boolean);
}

/** 不从最后一句歌词推断歌曲时长；页面没声明的年份/流派保持空值。
 *  verifyIdentity:false 供"从 Hi 导入新歌"用——导入哪条由人在搜索结果里挑，标题/歌手以页面为准。 */
export function parseHiDetail(html, candidate, local, { verifyIdentity = true } = {}) {
  const title = htmlText(html.match(/<span\b[^>]*id=["']music-title["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
  const artist = htmlText(html.match(/<span\b[^>]*id=["']music-artist["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
  if (!title || !artist || (verifyIdentity && (identity(title) !== identity(candidate.title) || identity(artist) !== identity(candidate.artist)))) {
    throw new Error('Hi歌曲详情身份不符或页面结构变化，跳过详情');
  }
  const image = [...html.matchAll(/<meta\b[^>]*>/gi)].find(m => attr(m[0], 'property') === 'og:image');
  const imageUrl = htmlText(attr(image?.[0] || '', 'content')).replace(/^http:/, 'https:');
  const coverUrl = allowedCoverUrl(imageUrl) ? imageUrl : null;
  const lines = [];
  let lastTime = -1, invalid = false;
  for (const m of html.matchAll(/<div\b([^>]*\bclass=["'][^"']*\blyric-line\b[^"']*["'][^>]*)>([\s\S]*?)<\/div>/gi)) {
    if (!attr(m[1], 'class').split(/\s+/).includes('lyric-line')) continue;
    const rawTime = attr(m[1], 'data-time'), time = Number(rawTime), text = htmlText(m[2]);
    if (!text) continue;
    if (!rawTime || !Number.isFinite(time) || time < 0 || time > 59999 || time < lastTime
        || (local.durationMs > 0 && time * 1000 > local.durationMs + 10000)) { invalid = true; break; }
    lastTime = time;
    const cs = Math.round(time * 100);
    lines.push('[' + String(Math.floor(cs / 6000)).padStart(2, '0') + ':' + String(Math.floor(cs / 100) % 60).padStart(2, '0') + '.' + String(cs % 100).padStart(2, '0') + ']' + text);
  }
  const text = lines.join('\n') + '\n';
  const lyrics = !invalid && lines.length && Buffer.byteLength(text) <= LYRICS_LIMIT
    ? { status: 'matched', kind: 'synced', source: 'Hi歌曲', text, sourceUrl: candidate.sourceUrl } : null;
  return { coverUrl, lyrics, title, artist };
}

/**
 * 从 player 页静态 HTML 提取音频直链：站点以 `let code = "<base64>"; let realUrl = atob(code)`
 * 服务端渲染地址（实测无需签名/Referer，2026-09-29 抓包验证）。2026-09-29 起放行 .mp3/.aac/.m4a
 * ——部分曲目站点交付 .aac（如 kw-bj.kuwo.cn/.../*.aac），由管理器本地转码为 MP3 后入库；
 * 解码后必须过 allowedAudioUrl 白名单，否则返回 null。本函数不做网络请求。
 */
export function parseHiAudio(html) {
  const code = html.match(/let\s+code\s*=\s*"([A-Za-z0-9+/=]+)"/)?.[1];
  if (!code) return null;
  let url;
  try { url = Buffer.from(code, 'base64').toString('utf8'); } catch { return null; }
  if (!/^https:\/\//.test(url) || !/^https:[^?#]+\.(?:mp3|aac|m4a)(?:[?#]|$)/i.test(url)) return null;
  return allowedAudioUrl(url) ? url : null;
}

/** 所有请求串行、至少间隔1秒（墙钟毫秒），12秒/2MB上限；失败由上层回退其他来源。 */
export function createHiGequ(scoreCandidate, options = {}) {
  const { request = globalThis.fetch, delayMs = 1000, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now } = options;
  let tail = Promise.resolve(), last = 0;
  function page(url) {
    const next = tail.then(async () => {
      await sleep(Math.max(0, last + delayMs - now())); last = now();
      return (await fetchLimited(url, 2 * 1024 * 1024, value => {
        const u = new URL(value);
        return u.origin === ROOT && !u.username && !u.password && /^\/(?:s\/[^/]+\/|player\/\d+\/)$/.test(u.pathname);
      }, request)).toString('utf8');
    });
    tail = next.catch(() => {}); return next;
  }
  async function findMetadata(local, { minScore = 0.8 } = {}) {
    // 站内搜索按歌名取前10条，再核对歌手；组合词在此站会漏掉已存在的歌曲。
    const query = String(local.title || '').trim();
    if (!query) return { source: 'higequ', query, candidate: null, score: 0 };
    const rows = parseHiSearch(await page(ROOT + '/s/' + encodeURIComponent(query) + '/'));
    const ranked = rows.map(candidate => {
      const exact = identity(local.title) === identity(candidate.title) && identity(local.artist) === identity(candidate.artist) && !!identity(local.artist);
      // 全局评分会剥括号版本；本站没有时长信号，必须额外卡住现场/翻唱/串烧身份。
      return { candidate, score: exact ? scoreCandidate(local, candidate) : Math.min(0.59, scoreCandidate(local, candidate)), exact };
    }).sort((a,b) => b.score - a.score);
    const best = ranked[0];
    if (!best) return { source: 'higequ', query, candidate: null, score: 0 };
    const result = { source: 'higequ', query, candidate: best.candidate, score: best.score, coverUrl: null, lyrics: null, lookedUp: false, identityAccepted: best.exact };
    if (!best.exact || best.score < minScore) return result;
    try {
      Object.assign(result, parseHiDetail(await page(best.candidate.sourceUrl), best.candidate, local), { lookedUp: true });
    } catch (err) { result.message = err.message; result.partial = true; }
    return result;
  }
  return { name: 'higequ', label: 'Hi歌曲', findMetadata };
}

/**
 * 手动导入用的自由搜索（2026-09-29 随"从 Hi 导入新歌"新增）：按关键词取前 10 条候选，
 * 不做身份核对——导入哪条由人挑。与 findMetadata 的匹配搜索不同：无 1 秒间隔、无缓存
 * （单曲手动触发）；传输上限与域校验和匹配搜索一致。request 可注入供离线测试。
 */
export async function searchHi(query, request = globalThis.fetch) {
  const q = String(query || '').trim();
  if (!q) throw new Error('搜索词不能为空');
  const html = (await fetchLimited(ROOT + '/s/' + encodeURIComponent(q) + '/', 2 * 1024 * 1024, value => {
    const u = new URL(value);
    return u.origin === ROOT && !u.username && !u.password && /^\/(?:s\/[^/]+\/|player\/\d+\/)$/.test(u.pathname);
  }, request)).toString('utf8');
  return parseHiSearch(html);
}
