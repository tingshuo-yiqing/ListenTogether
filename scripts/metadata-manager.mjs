#!/usr/bin/env node
/**
 * 一起听歌 · 歌曲元信息管理器（本机工具，非服务端组件）
 *
 * 用法：
 *   node scripts/metadata-manager.mjs [--dir <曲库目录>] [--port <端口>]
 *   默认 --dir = 项目根 media/，--port = 3100；启动后浏览器打开 http://127.0.0.1:3100
 *
 * 职责：可视化查看/编辑 catalog.json 条目（歌名/艺术家/专辑/流派/年份/歌词路径）、
 *   上传新 MP3 入库、上传/替换/移除独立封面、删除曲目（条目走校验闸门，文件移进回收目录
 *   而非直接删除）、联网匹配外部元数据候选并按勾选受控写回。
 *   匹配源为 Hi歌曲 / QQ 音乐 / 网易云音乐 / MusicBrainz（默认 Hi歌曲优先，未命中再尝试既有三源），除匹配那一步
 *   出网（文字/歌词/封面）外，只做曲库文件读写，不接触运行中的后端。
 *
 * 出网边界：只调平台搜索/详情、LRCLIB公开歌词接口与受信图床，不取音源、不带任何登录态、
 *   不做批量爬取（一次界面动作对应若干首、每首 1–2 个请求）。平台接口属非公开实现，
 *   随时可能改；接口清单与失效记录集中在 lib/metadata-sources.mjs 顶部常量处。
 *
 * 复用而非重复实现（数据格式兼容的关键）：
 *   1. 每次写编目后调用 server 编译产物 dist/library/catalog.js 的 loadCatalog 做整库校验，
 *      校验失败立即回滚——能通过 loadCatalog 的 catalog.json 必然能被后端启动加载；
 *   2. ID3 读取用 server/node_modules 里的同一份 music-metadata，与服务端提取口径一致。
 *
 * 字段口径（与 docs/track-metadata-design.md 对齐）：
 *   - title/artist/lyrics：catalog.json 现有字段（artist 手填优先于 ID3）；
 *   - album：设计稿已定的可选字段（第三轮服务端才消费，当前落库被忽略，属前向兼容）；
 *   - genre/year：本工具扩展的预留字段，服务端 loadCatalog 忽略未知键，不破坏兼容；
 *   - 封面：优先使用 catalog 的 cover 相对路径（media/covers/ 下的 JPG/PNG/WebP），
 *     没有独立图片时再回退到 MP3 内嵌 ID3；图片上限 1MB。
 *
 * 注意：写编目后运行中的后端需重启才生效（重启清空内存房间，云端操作见
 *   docs/deployment.md 第 5/6 节）；本工具只改本地文件。
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { readFile, writeFile, rename, stat, unlink, mkdir, readdir, copyFile, appendFile } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// 联网匹配的唯一实现：原命令行同步器 scripts/fetch-metadata.mjs 并入界面后随它一起删掉，
// 打分与写入策略只留这一份，避免界面与脚本对同一候选给出不同结论。
import {
  createMetadataSource, METADATA_SOURCES, DEFAULT_SOURCE,
  buildChanges, cacheKey, mergeLocalFields, readId3Tags, DEFAULT_MIN_SCORE,
} from './lib/metadata-sources.mjs';

import { findLyrics, fetchLimited, allowedCoverUrl, allowedAudioUrl, AUDIO_LIMIT, imageExtension, COVER_LIMIT } from './lib/metadata-assets.mjs';
import { parseHiAudio, parseHiDetail, searchHi } from './lib/higequ.mjs';

/** MP3 魔数：ID3 头或 MPEG 帧同步（0xFFEx/Fx）。下载与导入共用。 */
function looksLikeMp3(bytes) {
  return bytes.length > 1024
    && ((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
}

/** Hi歌曲 player 页抓取：域 + 路径白名单（/s/<词>/ 与 /player/<rid>/），2MB 上限。 */
async function fetchHiPlayerPage(sourceUrl) {
  return (await fetchLimited(sourceUrl, 2 * 1024 * 1024, u => {
    const p = new URL(u);
    return p.origin === 'https://higequ.com' && /^\/(?:s\/[^/]+\/|player\/\d+\/)$/.test(p.pathname);
  })).toString('utf8');
}

import { listTrash, restoreTrash } from './lib/media-trash.mjs';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');

// ---- 参数解析（--dir/--port，均带默认值）----
const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const MEDIA_DIR = resolve(argValue('--dir', join(PROJECT_ROOT, 'media')));
const PORT = Number(argValue('--port', '3100'));
const HOST = '127.0.0.1'; // 仅本机回环，工具不暴露到局域网
const UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
const COVER_MAX_BYTES = 1024 * 1024;
const COVER_DIR = join(MEDIA_DIR, 'covers');
// 歌词：与 loadCatalog 同一套口径（库内 .lrc、≤256KB）；命名沿用曲库拼音 ASCII 约定。
const LYRICS_MAX_BYTES = 256 * 1024;
const LYRICS_DIR = join(MEDIA_DIR, 'lyrics');
const LYRICS_NAME_RULE = /^[A-Za-z0-9._-]{1,120}\.lrc$/; // 不含路径分隔符，杜绝穿越
const ID_RULE = /^[a-zA-Z0-9_-]{1,64}$/; // 与 server/src/library/catalog.ts 同一条规则
// 删除的落点：曲库文件一律不直接 unlink，而是移进回收目录（media/ 不在 git 里，删了没法找回）。
// 可用 --trash 挪进临时目录，验证驱动才不会把夹具文件塞进真实回收站。
const TRASH_DIR = resolve(argValue('--trash', join(PROJECT_ROOT, '.workbuddy', 'media-trash')));
const DELETE_KINDS = ['audio', 'cover', 'lyrics']; // 删除范围开关，与界面三个勾选框一一对应
const RUN_RULE = /^[A-Za-z0-9._-]{1,64}$/; // 回收目录的批次名（一次批量删除共用一批，界面或时间戳生成）

// 复用 server 编译产物：loadCatalog 是编目格式的唯一权威校验器。
// dist 与 server/node_modules 都不入库（.gitignore），干净克隆后必须先跑构建与安装；
// 直接 import 缺失模块只会抛裸 ERR_MODULE_NOT_FOUND，看不出"该去跑哪条命令"，所以先探再给指引。
const SERVER_DIR = resolve(SCRIPT_DIR, '..', 'server');
async function importRequired(relativePath, fixCommand) {
  const absolute = join(SERVER_DIR, ...relativePath.split('/'));
  if (!existsSync(absolute)) {
    console.error(`缺少依赖：${absolute}\n本工具复用它做编目校验/ID3 读取，请先执行：${fixCommand}`);
    process.exit(1);
  }
  return import(pathToFileURL(absolute).href);
}
const { loadCatalog } = await importRequired('dist/library/catalog.js', 'cd server && npm run build');
// 复用 server 的同一份 music-metadata（ESM，按绝对路径 import 绕开 scripts/ 下无 node_modules 的限制）。
const { parseFile } = await importRequired('node_modules/music-metadata/lib/index.js', 'cd server && npm ci');

const CATALOG_PATH = join(MEDIA_DIR, 'catalog.json');
const HTML_PATH = join(SCRIPT_DIR, 'metadata-manager.html');

function coverMime(data) {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function coverExtension(mime) {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
}

/** 只返回 media/covers 内的旧文件，避免清理动作跟随错误 catalog 路径越界。 */
function managedCoverPath(entry) {
  if (typeof entry?.cover !== 'string' || !entry.cover.trim()) return null;
  const path = resolve(MEDIA_DIR, entry.cover.trim());
  // 用 insideDir 而不是拼分隔符：目录比较必须走同一个跨平台口径，否则换到 POSIX 上
  // 反斜杠判断会永远不成立，表现为"独立封面明明在却认不出来"。
  return insideDir(COVER_DIR, path) ? path : null;
}

/** target 是否落在 root 之内（两侧都先绝对化，分隔符统一成 / 让 Windows 与 POSIX 同口径）。 */
function insideDir(root, target) {
  const r = resolve(root).replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  return resolve(target).replace(/\\/g, '/').startsWith(r);
}

/**
 * 除本条之外还有谁引用同一份文件（按库内相对路径解析后比对）。
 * catalog 手改或复用同一个文件名都会出现"两首共用一份文件"，此时移走文件会让另一首变成坏条目
 * （后端下次启动直接起不来），所以三类文件都要引用计数，不能只给歌词做。
 */
function otherReferrers(entries, entry, field) {
  const self = typeof entry[field] === 'string' ? entry[field].trim() : '';
  if (!self) return [];
  const canonical = value => {
    const path = resolve(MEDIA_DIR, value);
    try { return realpathSync(path); } catch { return path; }
  };
  const mine = canonical(self);
  return entries
    .filter(e => e.id !== entry.id && typeof e[field] === 'string' && e[field].trim()
      && canonical(e[field].trim()) === mine)
    .map(e => e.id);
}

/**
 * 算出"这一首要移走哪些文件、哪些必须留下"。三种范围各自独立判定，返回 { moved, skipped }：
 * moved 只含确实存在且确属本工具管辖的路径，skipped 一定带原因（界面原样显示，不静默吞掉）。
 * - audio：直接用 loadCatalog 已经 realpath 并确认在库内的绝对路径，不自己拼 entry.file；
 * - cover：只管 covers/ 下的独立图片（本工具放进去的），ID3 内嵌封面在 MP3 里随音频一起走；
 * - lyrics：与 audio/cover 同一套引用计数——闸门此刻校验的是"删掉本条之后的编目"，
 *   它看不见被留下的那条引用会不会因此指向空文件，所以这层只有这里能兜住。
 */
function planDeletion(entry, entries, track, kinds) {
  const moved = [];
  const skipped = [];
  const want = k => kinds.includes(k);

  if (want('audio')) {
    const others = otherReferrers(entries, entry, 'file');
    if (!track) skipped.push({ kind: 'audio', reason: '该条目未能通过编目加载，未动文件' });
    else if (others.length) skipped.push({ kind: 'audio', reason: `${others.join('、')} 仍指向同一个音频文件，文件保留` });
    else if (insideDir(MEDIA_DIR, track.path)) moved.push({ kind: 'audio', from: track.path });
    else skipped.push({ kind: 'audio', reason: '音频实际路径不在曲库目录内，只删条目不动文件' });
  }
  if (want('cover')) {
    const cover = managedCoverPath(entry);
    const others = otherReferrers(entries, entry, 'cover');
    if (!entry.cover) skipped.push({ kind: 'cover', reason: '没有独立封面文件' });
    else if (!cover) skipped.push({ kind: 'cover', reason: '封面不在 media/covers/ 下（不是本工具放入的），只删条目不动文件' });
    else if (others.length) skipped.push({ kind: 'cover', reason: `${others.join('、')} 仍引用同一份封面，文件保留` });
    else if (!existsSync(cover)) skipped.push({ kind: 'cover', reason: '封面文件已不在盘上' });
    else moved.push({ kind: 'cover', from: cover });
  }
  if (want('lyrics')) {
    const ref = typeof entry.lyrics === 'string' ? entry.lyrics.trim() : '';
    if (!ref) skipped.push({ kind: 'lyrics', reason: '这首歌没有歌词引用' });
    else {
      const path = resolve(MEDIA_DIR, ref);
      const others = otherReferrers(entries, entry, 'lyrics');
      if (!insideDir(MEDIA_DIR, path) || !path.toLowerCase().endsWith('.lrc')) {
        skipped.push({ kind: 'lyrics', reason: '歌词路径不在曲库内或不是 .lrc，不动文件' });
      } else if (others.length) {
        skipped.push({ kind: 'lyrics', reason: `${others.join('、')} 仍引用同一份歌词，文件保留` });
      } else if (!existsSync(path)) {
        skipped.push({ kind: 'lyrics', reason: '歌词文件已不在盘上' });
      } else moved.push({ kind: 'lyrics', from: path });
    }
  }
  return { moved, skipped };
}

/**
 * 移进回收目录，保留它在曲库里的相对路径（放回时一眼对得上，也避免 a/x.mp3 与 b/x.mp3 撞名）。
 * 失败行为：跨卷（--dir 指到别的盘符）时 rename 报 EXDEV/EPERM/EACCES，退成复制再删源；
 * 其余错误原样抛出，由调用方按"这一首的部分文件没挪走"如实上报，绝不静默。
 */
async function moveToTrash(fromPath, run) {
  const rel = relative(MEDIA_DIR, fromPath).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) throw new Error(`拒绝移动曲库外的文件：${fromPath}`);
  let to = join(TRASH_DIR, run, rel);
  // 同一批次重传再删同名音频时，不能覆盖之前回收的版本。
  if (existsSync(to)) to += '.' + randomUUID();
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(fromPath, to);
  } catch (err) {
    if (!['EXDEV', 'EPERM', 'EACCES'].includes(err.code)) throw err;
    await copyFile(fromPath, to);
    await unlink(fromPath);
  }
  return to;
}

/** 回收目录每批一份 manifest.jsonl：记下被删条目的完整内容和每个文件的来去，放回时照单操作。 */
async function appendTrashManifest(run, row) {
  const file = join(TRASH_DIR, run, 'manifest.jsonl');
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(row) + '\n', 'utf8');
}

/** 读编目数组；文件不存在/不是数组时抛错（启动即失败，不静默建库）。 */
async function readCatalogEntries() {
  const entries = JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
  if (!Array.isArray(entries)) throw new Error('catalog.json 必须是数组');
  return entries;
}

/** 原子写编目（tmp + rename），格式与现有文件一致：2 空格缩进 + 末尾换行。 */
async function writeCatalogEntries(entries) {
  const tmp = CATALOG_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify(entries, null, 2) + '\n', 'utf8');
  await rename(tmp, CATALOG_PATH);
}

/**
 * 写入闸门：先写新编目 → loadCatalog 整库校验（与后端启动同一条路径）→
 * 失败则回滚为旧编目并抛错。调用方拿到 resolved tracks 作为"生效口径"回显。
 */
async function writeAndValidate(oldEntries, newEntries) {
  const original = await readFile(CATALOG_PATH);
  await writeCatalogEntries(newEntries);
  try {
    return await loadCatalog(MEDIA_DIR);
  } catch (err) {
    try {
      const tmp = CATALOG_PATH + '.tmp';
      await writeFile(tmp, original);
      await rename(tmp, CATALOG_PATH);
    } catch (rollbackError) {
      throw new Error(`校验失败且回滚失败，请停止编辑并恢复备份：${rollbackError.message}`);
    }
    throw new Error(`写入后校验未通过，已回滚：${err.message}`);
  }
}

/** 取 MP3 的 ID3 常用标签：实现收敛在 lib/metadata-sources.mjs（readId3Tags），界面与脚本共用一份。 */
async function readId3(filePath) {
  return readId3Tags(filePath, parseFile);
}

/** 列表条目 = catalog 手填字段 + loadCatalog 生效口径 + ID3 参考值。 */
async function listTracks() {
  const entries = await readCatalogEntries();
  const tracks = await loadCatalog(MEDIA_DIR); // 启动/列表时复验，库坏了直接报错而非显示假数据
  const byId = new Map(tracks.map(t => [t.id, t]));
  const out = [];
  for (const e of entries) {
    const t = byId.get(e.id);
    if (!t) continue;
    const id3 = await readId3(t.path);
    out.push({
      id: e.id,
      title: e.title,
      file: e.file,
      artist: typeof e.artist === 'string' ? e.artist : null,
      album: typeof e.album === 'string' ? e.album : null,
      genre: typeof e.genre === 'string' ? e.genre : null,
      year: typeof e.year === 'number' ? e.year : null,
      lyrics: typeof e.lyrics === 'string' ? e.lyrics : null,
      effective: {
        artist: t.artist,               // 手填 > ID3 的最终生效值（服务端口径）
        durationMs: t.durationMs,
        hasLyrics: t.lyricsPath !== null,
        hasCover: t.cover !== null,
        coverVer: t.coverVer,
        size: t.size,
      },
      id3: { artist: id3.artist, album: id3.album, genre: id3.genre, year: id3.year },
      hasCover: t.cover !== null,
      coverSource: e.cover ? 'file' : (id3.cover ? 'id3' : null),
    });
  }
  return out;
}

// ---- 可编辑字段白名单：写编目前统一收口，空串 → 删除该可选键 ----
const OPTIONAL_STRING_FIELDS = ['artist', 'album', 'genre', 'lyrics'];
// 文字字段直接校验；封面和歌词只接受本进程签发且绑定曲目的资源候选票据。
const APPLICABLE_FIELDS = ['artist', 'album', 'genre', 'year', 'cover', 'lyrics'];
// 资源只接受本进程签发的候选票据，不接受客户端提供的任意下载地址或歌词正文。
const assetCandidates = new Map();
const ASSET_TTL_MS = 30 * 60 * 1000;
let lastLyricsRequest = 0;

function applyEdit(entry, body) {
  if (typeof body.title !== 'string' || !body.title.trim()) throw new Error('歌名不能为空');
  entry.title = body.title.trim();
  for (const f of OPTIONAL_STRING_FIELDS) {
    if (f in body) {
      const v = body[f];
      if (typeof v === 'string' && v.trim()) entry[f] = v.trim();
      else delete entry[f];
    }
  }
  if ('year' in body) {
    const y = body.year;
    if (typeof y === 'number' && Number.isInteger(y) && y > 0 && y < 10000) entry.year = y;
    else delete entry.year;
  }
}

// ---- 联网匹配元数据（QQ 音乐 / 网易云音乐 / MusicBrainz）----
// 边界：匹配是只读动作，不写任何曲库文件；要改 catalog 必须另走 apply 端点并过 writeAndValidate 闸门。
// 限速：每个源各建一个客户端实例，即一条串行队列（实例级队列，见 lib/metadata-sources.mjs 头注释）。
//   批量匹配由界面逐首调用本端点完成，而不是服务端开一个几十秒的长请求——每首独立成败，
//   中途关页面也不会留下半批写入。
// 缓存路径默认为项目内 .workbuddy/，但可用 --cache 覆盖：验证脚本必须能把缓存挪进临时目录，
// 否则一次夹具运行就会把假候选写进真实缓存，之后真机验收读到的是测试数据。
const CACHE_PATH = resolve(argValue('--cache', join(PROJECT_ROOT, '.workbuddy', 'metadata-cache.json')));
// 三个实例在启动时一次性建好：懒建会让首次匹配某源时才暴露注入错误。
const SOURCE_CLIENTS = Object.fromEntries(
  METADATA_SOURCES.map(({ name, label }) => [name, createMetadataSource(name)]),
);
const SOURCE_LABELS = Object.fromEntries(METADATA_SOURCES.map(({ name, label }) => [name, label]));

/** 缓存读失败一律当空缓存：它是省时间的加速件而非事实源，坏了重查即可，不该拖垮启动或匹配。 */
async function readSyncCache() {
  try {
    const raw = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

async function writeSyncCache(cache) {
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  const tmp = CACHE_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify(cache, null, 2) + '\n', 'utf8');
  await rename(tmp, CACHE_PATH);
}

/**
 * 单曲匹配。返回里 candidate（外部说了什么）与 changes（我们准备写什么）分开：
 * 低于 minScore 的文字候选仍可由用户手动勾选应用，但不给 changes：不默认勾选，也不进入批量补缺。
 * changes 的口径由 onlyIfEmpty 决定：true＝只报可补的空缺（批量补缺用，已有值一律不进候选勾选）；
 * false（默认，单曲匹配）＝歌词匹配到就进勾选，已有歌词也报，替换由人工点"应用"确认。
 */
async function syncTrack(id, { source = DEFAULT_SOURCE, minScore = DEFAULT_MIN_SCORE, refresh = false, includeLyrics = false, onlyIfEmpty = false } = {}) {
  const entries = await readCatalogEntries();
  const entry = entries.find(e => e.id === id);
  if (!entry) return { id, status: 'not-found', message: '歌曲不存在' };
  const track = (await loadCatalog(MEDIA_DIR)).find(t => t.id === id);
  if (!track) return { id, status: 'local-error', message: '编目条目未能加载' };
  // 送去匹配的画像 = 界面上看到的生效值（手填 > ID3），两者必须同源，否则打分依据与显示依据会分叉。
  const local = mergeLocalFields(entry, await readId3(track.path));
  const cache = await readSyncCache();
  // 缓存键必须含源名：换源重查是常见动作（QQ 查不到就想试网易云），
  // 键里没源就会把"QQ 无候选"直接当成"网易云也无候选"返回。
  const requestedSource = source;
  const attempts = [];
  const order = source === 'higequ' ? ['higequ', 'qq', 'netease', 'musicbrainz'] : [source];
  let result = null, usedCache = false, lastError;
  for (const name of order) {
    const key = name + '|' + cacheKey(entry) + (name === 'higequ' ? '|' + JSON.stringify(local) : '');
    let found = !refresh ? cache[key] : null;
    // Hi歌曲页面缓存一天；未取详情/上次部分失败的结果不能阻止下一次重试。
    if (name === 'higequ' && found && (!found.lookedUp || !found.cachedAt || !(Date.now() - Date.parse(found.cachedAt) < 86400000))) found = null;
    const cached = Boolean(found);
    try {
      if (!found) {
        found = await SOURCE_CLIENTS[name].findMetadata(local, { minScore });
        if (!found.partial) {
          cache[key] = { ...found, cachedAt: new Date().toISOString() };
          await writeSyncCache(cache);
        }
      }
      const accepted = Boolean(found.candidate) && found.identityAccepted !== false && Number(found.score) >= minScore;
      attempts.push({ source: name, status: found.partial ? 'partial' : accepted ? 'matched' : 'missing', message: found.message });
      if (!result || Number(found.score) > Number(result.score)) { result = found; source = name; usedCache = cached; }
      if (accepted) { result = found; source = name; usedCache = cached; break; }
    } catch (err) {
      lastError = err;
      attempts.push({ source: name, status: 'unavailable', message: err.message });
    }
  }
  if (!result) {
    if (!includeLyrics && requestedSource !== 'higequ') throw lastError;
    result = { candidate: null, score: 0, message: '文字来源暂不可用，已跳过' };
    source = requestedSource;
  }
  const accepted = Boolean(result.candidate) && result.identityAccepted !== false && Number(result.score) >= minScore;
  const candidate = result.candidate || null;
  const changes = accepted ? buildChanges(entry, candidate, false) : {};
  // 国内平台有时返回HTTP图床链接；只尝试升级HTTPS，仍需通过固定来源白名单。
  const secureCover = typeof result.coverUrl === 'string' ? result.coverUrl.replace(/^http:/, 'https:') : null;
  const coverUrl = accepted && allowedCoverUrl(secureCover) ? secureCover : null;
  let lyrics = includeLyrics && accepted ? result.lyrics || null : null;
  if (includeLyrics && !lyrics) {
    const profile = { title: entry.title, artist: local.artist || (accepted ? candidate.artist : ''), durationMs: track.durationMs };
    const lyricsKey = 'lyrics-v1|' + JSON.stringify(profile);
    const cached = cache[lyricsKey];
    if (!refresh && cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) lyrics = cached.value;
    else {
      try {
        // 即使调用方绕开UI批量限速，也限制歌词请求间隔；失败不写缓存，下次可重试。
        await new Promise(r => setTimeout(r, Math.max(0, lastLyricsRequest + 1000 - Date.now())));
        lastLyricsRequest = Date.now();
        lyrics = await findLyrics(profile);
        cache[lyricsKey] = { at: Date.now(), value: lyrics };
        await writeSyncCache(cache);
      } catch (err) { lyrics = { status: 'unavailable', message: `歌词暂不可用，已跳过：${err.message}` }; }
    }
  }
  for (const [token, value] of assetCandidates) {
    if (Date.now() - value.at > ASSET_TTL_MS) assetCandidates.delete(token);
  }
  while (assetCandidates.size >= 500) assetCandidates.delete(assetCandidates.keys().next().value);
  const assetToken = coverUrl || lyrics?.status === 'matched' ? randomUUID() : null;
  if (assetToken) assetCandidates.set(assetToken, { id, at: Date.now(), snapshot: JSON.stringify(entry),
    coverUrl, lyrics: lyrics?.status === 'matched' ? lyrics : null });
  if (coverUrl && !track.cover) changes.cover = assetToken;
  // 封面已有值时一律不自动勾（换图必须人工确认）；歌词不同：单曲匹配下只要匹配到就默认勾上，
  // 哪怕本曲已引用歌词——依据是用户 2026-09-28 的明确要求「匹配到歌词后就可以替换掉旧的歌词」。
  // 批量走 onlyIfEmpty（补缺口径），已有歌词照旧不进 changes，界面"批量不会覆盖已有内容"仍是真话。
  // 替换只改 catalog 指针：新文本另起 lyrics/<id>-<uuid>.lrc，旧文件留在原地（见 apply 分支），
  // 因为同一份 .lrc 可能被别的曲目共用。
  if (lyrics?.status === 'matched' && (!entry.lyrics || !onlyIfEmpty)) changes.lyrics = assetToken;
  const status = Object.keys(changes).length ? 'matched-change' : (accepted ? 'matched-no-change' : 'needs-review');
  return {
    id,
    status,
    source,
    sourceLabel: SOURCE_LABELS[source] || source,
    requestedSource, attempts, sourceUrl: accepted ? candidate?.sourceUrl || null : null,
    metadataAccepted: accepted,
    message: result.message,
    assetToken,
    lyrics,
    hasCover: Boolean(track.cover),
    hasLyrics: Boolean(entry.lyrics),
    score: Number(result.score) || 0,
    minScore,
    query: result.query,
    usedCache,
    local,
    candidate,
    suggested: candidate ? {
      artist: candidate.artist || null,
      album: candidate.album || null,
      genre: candidate.genre || null,
      year: candidate.year || null,
    } : null,
    changes,
    // 封面地址必须按**本次请求的阈值**再闸一次：源层只在"当场查的那次"闸过，而缓存里的候选
    // 是按当时的阈值存下来的。界面可以把阈值调高重试，此时状态已判成 needs-review，
    // 若还递上封面地址就等于"这条候选没达标，但你可以一键把它的封面存进曲库"。
    coverUrl,
  };
}

function json(res, code, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

// 一个进程内的读写串行：多标签页不能基于旧快照覆盖另一请求，也不能读到待校验编目。
let requestTail = Promise.resolve();
const server = createServer(async (req, res) => {
  const previous = requestTail;
  let release;
  requestTail = new Promise(resolveQueue => { release = resolveQueue; });
  await previous;
  try {
    await handleRequest(req, res);
  } finally {
    release();
  }
});

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    // 回环监听之外再核验 Host/Origin，拒绝外站借浏览器向管理端写入。SSH 隧道仍用本机地址。
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host)
        || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
      return json(res, 403, { message: '只允许从本机管理页面访问' });
    }
    // 页面与静态
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await readFile(HTML_PATH);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/api/trash') {
      return json(res, 200, await listTrash(TRASH_DIR));
    }
    if (req.method === 'POST' && url.pathname === '/api/trash/restore') {
      const body = JSON.parse((await readBody(req, 4096)).toString('utf8'));
      if (typeof body.run !== 'string' || typeof body.key !== 'string') return json(res, 400, { message: '缺少回收记录' });
      try {
        const entries = await readCatalogEntries();
        return json(res, 200, await restoreTrash({ trashDir: TRASH_DIR, mediaDir: MEDIA_DIR, run: body.run, key: body.key,
          entries, validate: () => loadCatalog(MEDIA_DIR), commit: next => writeAndValidate(entries, next) }));
      } catch (err) { return json(res, 409, { message: err.message }); }
    }
    // 列表
    if (req.method === 'GET' && url.pathname === '/api/tracks') {
      return json(res, 200, { dir: MEDIA_DIR, tracks: await listTracks() });
    }
    // 仅预览编目已保存的歌词：请求只接收歌曲 ID，路径由 catalog 提供并校验 realpath。
    const lyricsMatch = url.pathname.match(/^\/api\/tracks\/([a-zA-Z0-9_-]{1,64})\/lyrics$/);
    if (req.method === 'GET' && lyricsMatch) {
      const entry = (await readCatalogEntries()).find(e => e.id === lyricsMatch[1]);
      if (!entry) return json(res, 404, { message: '歌曲不存在' });
      if (!entry.lyrics) return json(res, 404, { message: '当前歌曲尚未保存歌词' });
      try {
        const path = realpathSync(resolve(MEDIA_DIR, entry.lyrics));
        if (!insideDir(realpathSync(MEDIA_DIR), path) || !path.endsWith('.lrc')) {
          return json(res, 422, { message: '歌词路径无效，必须是曲库内的 .lrc 文件' });
        }
        const info = await stat(path);
        if (!info.isFile() || info.size > LYRICS_MAX_BYTES) return json(res, 422, { message: '歌词文件无效或超过 256KB' });
        const data = await readFile(path);
        if (data.length > LYRICS_MAX_BYTES) return json(res, 422, { message: '歌词文件超过 256KB' });
        return json(res, 200, { path: entry.lyrics, text: data.toString('utf8').replace(/^\uFEFF/, '') });
      } catch (err) {
        return json(res, err.code === 'ENOENT' ? 404 : 422, { message: err.code === 'ENOENT' ? '已保存的歌词文件不存在' : '无法读取当前歌词文件' });
      }
    }
    // 封面预览（独立图片优先，服务端 loadCatalog 已完成路径/格式/大小校验）
    const coverMatch = url.pathname.match(/^\/api\/cover\/([a-zA-Z0-9_-]{1,64})$/);
    if (req.method === 'GET' && coverMatch) {
      const tracks = await loadCatalog(MEDIA_DIR);
      const track = tracks.find(t => t.id === coverMatch[1]);
      if (!track) return json(res, 404, { message: '歌曲不存在' });
      if (!track.cover) return json(res, 404, { message: '该歌曲没有封面' });
      res.writeHead(200, { 'Content-Type': track.cover.mime, 'Cache-Control': 'no-store' });
      return res.end(track.cover.data);
    }
    // 上传/替换独立封面：原始图片字节流，catalog 只记录库内相对路径。
    const trackCoverMatch = url.pathname.match(/^\/api\/tracks\/([a-zA-Z0-9_-]{1,64})\/cover$/);
    if (req.method === 'POST' && trackCoverMatch) {
      const id = trackCoverMatch[1];
      const oldEntries = await readCatalogEntries();
      const oldEntry = oldEntries.find(e => e.id === id);
      if (!oldEntry) return json(res, 404, { message: '歌曲不存在' });
      const data = await readBody(req, COVER_MAX_BYTES);
      const mime = coverMime(data);
      if (!mime) return json(res, 415, { message: '封面必须是有效的 JPG、PNG 或 WebP 图片' });
      await mkdir(COVER_DIR, { recursive: true });
      const fileName = `${id}-${Date.now()}-${randomUUID().slice(0, 8)}.${coverExtension(mime)}`;
      const relative = `covers/${fileName}`;
      const filePath = join(MEDIA_DIR, relative);
      await writeFile(filePath, data);
      try {
        const newEntries = oldEntries.map(e => ({ ...e }));
        const entry = newEntries.find(e => e.id === id);
        entry.cover = relative;
        const loaded = await writeAndValidate(oldEntries, newEntries);
        const oldCover = managedCoverPath(oldEntry);
        if (oldCover && oldCover !== filePath && !otherReferrers(oldEntries, oldEntry, 'cover').length) {
          await unlink(oldCover).catch(() => {});
        }
        return json(res, 200, {
          ok: true,
          message: '封面已上传并保存',
          coverVer: loaded.find(t => t.id === id)?.coverVer ?? null,
        });
      } catch (err) {
        await unlink(filePath).catch(() => {});
        throw err;
      }
    }
    // 移除独立封面；若原来只有 ID3 内嵌封面，删除接口不会破坏 MP3，仍会回退显示它。
    if (req.method === 'DELETE' && trackCoverMatch) {
      const oldEntries = await readCatalogEntries();
      const oldEntry = oldEntries.find(e => e.id === trackCoverMatch[1]);
      if (!oldEntry) return json(res, 404, { message: '歌曲不存在' });
      const oldCover = managedCoverPath(oldEntry);
      if (!oldCover) return json(res, 200, { ok: true, message: '该歌曲没有独立封面' });
      const newEntries = oldEntries.map(e => ({ ...e }));
      const entry = newEntries.find(e => e.id === trackCoverMatch[1]);
      delete entry.cover;
      await writeAndValidate(oldEntries, newEntries);
      if (!otherReferrers(oldEntries, oldEntry, 'cover').length) await unlink(oldCover).catch(() => {});
      return json(res, 200, { ok: true, message: '独立封面已移除' });
    }
    // 单个条目的写入路径只有一条：PUT 改、DELETE 删，同一个正则匹配（避免两种写法的路径口径分叉）
    const editMatch = url.pathname.match(/^\/api\/tracks\/([a-zA-Z0-9_-]{1,64})$/);
    if (req.method === 'PUT' && editMatch) {
      const body = JSON.parse(await readBody(req, 1024 * 1024));
      const oldEntries = await readCatalogEntries();
      const newEntries = oldEntries.map(e => ({ ...e }));
      const entry = newEntries.find(e => e.id === editMatch[1]);
      if (!entry) return json(res, 404, { message: '歌曲不存在' });
      applyEdit(entry, body);
      await writeAndValidate(oldEntries, newEntries); // 含 lyrics 路径 realpath/.lrc/大小校验
      return json(res, 200, { ok: true, message: `已保存「${entry.title}」` });
    }
    // 删除一首歌：?files=audio,cover,lyrics 决定动哪些文件，不带 files 等于"只从曲库移除、文件留在原地"。
    // 顺序是硬要求——先删条目并过 writeAndValidate 闸门，成功后才移文件：反过来做的话，
    // 一次校验失败就会留下"编目还在、音频已经没了"的坏库（后端下次启动直接起不来）。
    if (req.method === 'DELETE' && editMatch) {
      const id = editMatch[1];
      const rawFiles = url.searchParams.get('files');
      const kinds = (rawFiles || '').split(',').map(s => s.trim()).filter(Boolean);
      const unknownKind = kinds.filter(k => !DELETE_KINDS.includes(k));
      if (unknownKind.length) {
        return json(res, 400, { message: `未知的删除范围：${unknownKind.join('、')}（可选 audio / cover / lyrics）` });
      }
      const run = url.searchParams.get('run')
        || new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      if (!RUN_RULE.test(run) || run === '.' || run === '..') return json(res, 400, { message: '回收批次名只允许字母/数字/._-（1-64 位）' });
      const oldEntries = await readCatalogEntries();
      const entry = oldEntries.find(e => e.id === id);
      if (!entry) return json(res, 404, { message: '歌曲不存在' });
      // 复验整库（与列表同一道校验）：库本身有问题时一口拒绝，别在坏库上做删除。
      // 这里必须是 409 而不是让它冒到兜底的 500：原因在盘上而不在请求里，答复要说清"什么都没动"。
      let loaded;
      try {
        loaded = await loadCatalog(MEDIA_DIR);
      } catch (err) {
        return json(res, 409, { message: `曲库当前校验不通过，未改动任何文件（请先修好曲库再删）：${err.message}` });
      }
      const { moved, skipped } = planDeletion(entry, oldEntries, loaded.find(t => t.id === id), kinds);
      await writeAndValidate(oldEntries, oldEntries.filter(e => e.id !== id));
      const done = [];
      const failed = [];
      for (const item of moved) {
        try {
          done.push({ kind: item.kind, from: item.from, to: await moveToTrash(item.from, run) });
        } catch (err) {
          failed.push({ kind: item.kind, path: item.from, message: err.message || '移动失败' });
        }
      }
      const trashDir = join(TRASH_DIR, run);
      await appendTrashManifest(run, {
        at: new Date().toISOString(), id, title: entry.title,
        catalogEntry: entry, moved: done, skipped, failed, // catalogEntry 整条留档：放回时不必凭记忆重填
      });
      const parts = [`已从曲库移除「${entry.title}」`];
      if (kinds.length) parts.push(done.length ? `${done.length} 个文件移入回收目录` : '没有文件需要移动');
      else parts.push('文件保留在原地（未指定删除范围）');
      if (skipped.length) parts.push(skipped.map(s => s.reason).join('；'));
      if (failed.length) parts.push(`${failed.length} 个文件移动失败，仍在曲库内`);
      return json(res, 200, {
        ok: true, id, title: entry.title, moved: done, skipped, failed, trashDir,
        message: parts.join('；'),
      });
    }
    // 歌词文件清单：编辑表单的 datalist 数据源（目录不存在按空列表，不挡主流程）。
    if (req.method === 'GET' && url.pathname === '/api/lyrics-files') {
      let files = [];
      try {
        files = (await readdir(LYRICS_DIR))
          .filter((n) => LYRICS_NAME_RULE.test(n))
          .sort()
          .map((n) => `lyrics/${n}`);
      } catch { /* 没有 lyrics 目录就返回空 */ }
      return json(res, 200, { files });
    }
    // 上传歌词文本：只落盘到 lyrics/，不改 catalog——是否引用由随后的保存动作决定，
    // 保持"写 catalog 只走 writeAndValidate 一条通道"。文件名走自定义头（URL 编码）。
    if (req.method === 'POST' && url.pathname === '/api/lyrics') {
      const name = decodeURIComponent(req.headers['x-file-name'] || '').trim();
      if (!LYRICS_NAME_RULE.test(name)) {
        return json(res, 400, { message: '文件名只允许字母/数字/._- 且以小写 .lrc 结尾（曲库约定为拼音名）' });
      }
      // 上限多收 1KB 再自己判 413：readBody 超限是 reject + destroy 连接，客户端只能看到连接重置，
      // 拿不到状态码。歌词上限小，多收一点换来明确的 413 语义；远超上限的仍走连接重置兜底。
      let data;
      try { data = await readBody(req, LYRICS_MAX_BYTES + 1024); }
      catch { return json(res, 413, { message: '歌词文件远超 256KB 上限' }); }
      if (data.length > LYRICS_MAX_BYTES) return json(res, 413, { message: '歌词文件超过 256KB 上限' });
      if (!data.length) return json(res, 400, { message: '文件内容为空' });
      // 与 media-manage.sh 同口径：剥 UTF-8 BOM，避免播放器端把 BOM 当首行文本
      if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) data = data.subarray(3);
      await mkdir(LYRICS_DIR, { recursive: true });
      const filePath = join(LYRICS_DIR, name);
      const relative = `lyrics/${name}`;
      try {
        const existing = await readFile(filePath);
        if (existing.equals(data)) {
          return json(res, 200, { ok: true, reused: true, path: relative, message: `已有同名同内容文件，直接复用：${relative}` });
        }
        return json(res, 409, { message: `已存在同名但内容不同的文件：${name}，请换个文件名再传` });
      } catch { /* 不存在才写 */ }
      await writeFile(filePath, data);
      return json(res, 200, { ok: true, path: relative, message: `歌词已保存：${relative}（点「保存修改」后引用生效）` });
    }
    // 可选元数据源清单：界面下拉据此渲染，新源只需在 lib 注册表里加一行。
    if (req.method === 'GET' && url.pathname === '/api/sources') {
      return json(res, 200, {
        serviceVersion: '20260929-hi-audio',
        default: DEFAULT_SOURCE,
        minScore: DEFAULT_MIN_SCORE,
        sources: METADATA_SOURCES.map(({ name, label }) => ({ name, label })),
      });
    }
    // 联网匹配（只读预览，不写盘）。阈值决定"能不能自动写"，所以非法值必须拒在入口，
    // 不能悄悄退化成默认值——那会让一次笔误把整个库的判定门槛挪低。
    const syncMatch = url.pathname.match(/^\/api\/tracks\/([a-zA-Z0-9_-]{1,64})\/sync$/);
    if (req.method === 'POST' && syncMatch) {
      const raw = (await readBody(req, 1024 * 1024)).toString('utf8');
      const body = raw.trim() ? JSON.parse(raw) : {};
      const minScore = body.minScore === undefined || body.minScore === null || body.minScore === ''
        ? DEFAULT_MIN_SCORE : Number(body.minScore);
      if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
        return json(res, 400, { message: '置信度阈值必须是 0 到 1 之间的数字' });
      }
      const source = body.source || DEFAULT_SOURCE;
      if (!SOURCE_CLIENTS[source]) {
        return json(res, 400, { message: `未知的元数据源：${source}` });
      }
      try {
        return json(res, 200, await syncTrack(syncMatch[1], {
          source, minScore, refresh: Boolean(body.refresh), includeLyrics: body.includeLyrics === true,
          onlyIfEmpty: body.onlyIfEmpty === true,
        }));
      } catch (err) {
        // 出网失败按"这一首失败"回 502，不抛 500：批量是界面逐首调用的，
        // 一行标红并能继续下一首，比整批请求失败重来一遍省得多。
        return json(res, 502, { id: syncMatch[1], status: 'network-error', message: err.message || '查询失败' });
      }
    }
    // 应用候选字段：走与手工编辑完全相同的写入路径（applyEdit 收口 + writeAndValidate 闸门）。
    const applyMatch = url.pathname.match(/^\/api\/tracks\/([a-zA-Z0-9_-]{1,64})\/apply$/);
    if (req.method === 'POST' && applyMatch) {
      const raw = (await readBody(req, 1024 * 1024)).toString('utf8');
      const body = raw.trim() ? JSON.parse(raw) : {};
      const picked = body.fields && typeof body.fields === 'object' ? body.fields : {};
      const unknown = Object.keys(picked).filter(k => !APPLICABLE_FIELDS.includes(k));
      if (unknown.length) return json(res, 400, { message: `不支持的字段：${unknown.join('、')}` });
      if (!Object.keys(picked).length) return json(res, 400, { message: '没有要应用的字段' });
      // 候选值必须是"能写的值"。applyEdit 对空串/非法年份的语义是清空该字段（手工编辑界面
      // 需要这个语义来抹掉歌词），但 apply 端点的语义只有"写入外部候选"，绝不含清空：
      // 若把垃圾值透传给 applyEdit，一次拼错字段类型就会把已填好的专辑/年份静默抹掉。
      for (const [k, v] of Object.entries(picked)) {
        if (k === 'year') {
          if (!Number.isInteger(v) || v < 1800 || v > 2100) {
            return json(res, 400, { message: `年份必须是 1800–2100 的整数，收到：${JSON.stringify(v)}` });
          }
        } else if (typeof v !== 'string' || !v.trim()) {
          return json(res, 400, { message: `${k} 必须是非空字符串，收到：${JSON.stringify(v)}` });
        }
      }
      const oldEntries = await readCatalogEntries();
      const newEntries = oldEntries.map(e => ({ ...e }));
      const entry = newEntries.find(e => e.id === applyMatch[1]);
      if (!entry) return json(res, 404, { message: '歌曲不存在' });
      const resources = {};
      for (const kind of ['cover', 'lyrics']) {
        if (!(kind in picked)) continue;
        const value = assetCandidates.get(picked[kind]);
        if (!value || value.id !== entry.id || Date.now() - value.at > ASSET_TTL_MS
            || value.snapshot !== JSON.stringify(oldEntries.find(e => e.id === entry.id))
            || !(kind === 'cover' ? value.coverUrl : value.lyrics)) {
          return json(res, 409, { message: '封面或歌词候选已过期或曲目已修改，请重新匹配' });
        }
        resources[kind] = value;
      }
      // 批量补缺模式（onlyIfEmpty）：候选可能取自旧缓存，落库前以当前编目为准再过滤一遍，
      // 已有值的字段一律跳过——让界面上"不会覆盖你已手填的内容"这句是真话。
      if (body.onlyIfEmpty) {
        for (const k of Object.keys(picked)) {
          const cur = entry[k];
          if (typeof cur === 'string' ? cur.trim() : cur) delete picked[k];
          if (k === 'cover' && !cur && (await loadCatalog(MEDIA_DIR)).find(t => t.id === entry.id)?.cover) delete picked[k];
        }
        if (!Object.keys(picked).length) {
          return json(res, 200, { ok: true, skipped: true, message: `${entry.id} 的候选字段已有值，已跳过` });
        }
      }
      // title 原样带上只为满足 applyEdit 的非空校验：候选标题不参与匹配写入（标题是我们自己填的）。
      const applied = [];
      const failed = [];
      const created = [];
      const textFields = Object.fromEntries(Object.entries(picked).filter(([k]) => !['cover', 'lyrics'].includes(k)));
      applyEdit(entry, { title: entry.title, ...textFields });
      applied.push(...Object.keys(textFields));
      try {
        for (const kind of ['cover', 'lyrics']) {
          if (!(kind in picked)) continue;
          let path;
          try {
            const resource = resources[kind];
            const data = kind === 'cover'
              ? await fetchLimited(resource.coverUrl, COVER_LIMIT, allowedCoverUrl)
              : Buffer.from(resource.lyrics.text, 'utf8');
            const ext = kind === 'cover' ? imageExtension(data) : 'lrc';
            const rel = `${kind === 'cover' ? 'covers' : 'lyrics'}/${entry.id}-${randomUUID()}.${ext}`;
            path = join(MEDIA_DIR, rel);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, data, { flag: 'wx' });
            created.push(path);
            entry[kind] = rel;
            applied.push(kind);
          } catch (err) {
            if (path) await unlink(path).catch(() => {});
            failed.push({ field: kind, message: err.message });
          }
        }
        if (applied.length) await writeAndValidate(oldEntries, newEntries);
      } catch (err) {
        // 回滚失败时保留文件供人工恢复，避免进一步破坏可能仍引用新文件的编目。
        if (!err.message?.includes('回滚失败')) for (const path of created) await unlink(path).catch(() => {});
        throw err;
      }
      // 旧资源保留原地，避免替换时误删共享文件，也方便管理员回退。
      return json(res, 200, { ok: failed.length === 0, applied, failed,
        message: (applied.length ? `已应用「${entry.title}」的 ${applied.join('、')}` : '没有字段写入')
          + (failed.length ? '；' + failed.map(f => `${f.field} 未应用：${f.message}`).join('；') : '') });
    }
    // 从 Hi歌曲整首替换（2026-09-29 用户决策，替代此前仅换音频的 /higequ-audio）：
    // 单曲手动触发、仅开发测试用途、不限速。一次动作替换 **音频 + 标题/歌手/专辑 + 歌词 + 封面**，
    // 不要求表单先保存（refresh() 会以服务端新值为准）。旧文件全部原地保留，可随时手工改回。
    const hiReplaceMatch = url.pathname.match(/^\/api\/tracks\/([a-zA-Z0-9_-]{1,64})\/higequ-replace$/);
    if (req.method === 'POST' && hiReplaceMatch) {
      const id = hiReplaceMatch[1];
      const entries = await readCatalogEntries();
      const entry = entries.find(e => e.id === id);
      if (!entry) return json(res, 404, { message: '歌曲不存在' });
      let sync;
      try {
        sync = await syncTrack(id, { source: 'higequ', includeLyrics: true });
      } catch (err) {
        return json(res, 502, { message: 'Hi歌曲查询失败：' + (err.message || '网络错误') });
      }
      if (sync.source !== 'higequ' || !sync.candidate) {
        return json(res, 404, { message: 'Hi歌曲没有匹配到候选（无结果或查询失败），未替换' });
      }
      if (sync.metadataAccepted !== true) {
        return json(res, 422, { message: 'Hi歌曲候选身份不符（同名翻唱/现场版）或低于阈值，拒绝替换' });
      }
      const pageHtml = await fetchHiPlayerPage(sync.candidate.sourceUrl);
      const audioUrl = parseHiAudio(pageHtml);
      if (!audioUrl) return json(res, 404, { message: '播放页没有可用的音频直链（页面结构变化或不在白名单域），已放弃' });
      const bytes = await fetchLimited(audioUrl, AUDIO_LIMIT, allowedAudioUrl);
      if (!looksLikeMp3(bytes)) return json(res, 422, { message: '下载内容不是 MP3（魔数不符），已放弃' });
      const created = [];
      const newEntry = { ...entry };
      try {
        // 音频：新文件 + 指针换新；文字字段按 Hi 候选直接覆盖（名字/歌手连名替换，Hi 没给的字段保留原值）。
        const audioRel = `audio/${id}-${randomUUID()}.mp3`;
        await mkdir(dirname(join(MEDIA_DIR, audioRel)), { recursive: true });
        await writeFile(join(MEDIA_DIR, audioRel), bytes, { flag: 'wx' });
        created.push(audioRel);
        newEntry.file = audioRel;
        newEntry.title = sync.candidate.title;
        newEntry.artist = sync.candidate.artist;
        if (sync.candidate.album) newEntry.album = sync.candidate.album;
        // 歌词：sync(includeLyrics) 已带 Hi 的 synced 文本，写新文件 + 指针。
        if (sync.lyrics?.status === 'matched' && sync.lyrics.text) {
          const lrcRel = `lyrics/${id}-${randomUUID()}.lrc`;
          await mkdir(dirname(join(MEDIA_DIR, lrcRel)), { recursive: true });
          await writeFile(join(MEDIA_DIR, lrcRel), sync.lyrics.text, { flag: 'wx' });
          created.push(lrcRel);
          newEntry.lyrics = lrcRel;
        }
        // 封面：sync.coverUrl 已过 allowedCoverUrl 白名单，下载后按魔数定扩展名。
        if (sync.coverUrl) {
          const img = await fetchLimited(sync.coverUrl, COVER_LIMIT, allowedCoverUrl);
          const covRel = `covers/${id}-${randomUUID()}.${imageExtension(img)}`;
          await mkdir(dirname(join(MEDIA_DIR, covRel)), { recursive: true });
          await writeFile(join(MEDIA_DIR, covRel), img, { flag: 'wx' });
          created.push(covRel);
          newEntry.cover = covRel;
        }
        await writeAndValidate(entries, entries.map(e => e.id === id ? newEntry : e));
      } catch (err) {
        // 失败时新建文件都还没有 catalog 引用，直接清掉（回滚失败则保留供人工恢复）。
        if (!err.message?.includes('回滚失败')) for (const rel of created) await unlink(join(MEDIA_DIR, rel)).catch(() => {});
        throw err;
      }
      return json(res, 200, { ok: true, file: newEntry.file, title: newEntry.title, artist: newEntry.artist,
        message: `已从 Hi歌曲整首替换：「${entry.title}」→「${newEntry.title}」（音频 ${(bytes.length / 1024 / 1024).toFixed(1)}MB`
          + `${sync.lyrics?.status === 'matched' ? ' + 歌词' : ''}${newEntry.cover && newEntry.cover !== entry.cover ? ' + 封面' : ''}）；旧文件原地保留` });
    }
    // Hi歌曲自由搜索（供"从 Hi 导入新歌"面板；单曲手动触发，不限速、无缓存）。
    if (req.method === 'POST' && url.pathname === '/api/higequ/search') {
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}');
      let rows;
      try {
        rows = await searchHi(body.query);
      } catch (err) {
        return json(res, 502, { message: 'Hi歌曲搜索失败：' + (err.message || '网络错误') });
      }
      return json(res, 200, { ok: true, results: rows.map(r => ({ rid: r.id, title: r.title, artist: r.artist, album: r.album, sourceUrl: r.sourceUrl })) });
    }
    // 从 Hi歌曲导入整首新歌：搜索结果里人工挑选（rid），音频/标题/歌手/歌词/封面一次到位。
    // 新 ID 默认 hi-<rid>，可自定义（过 ID 规则、不得与现有重复）；写库走同一道 writeAndValidate 闸门。
    if (req.method === 'POST' && url.pathname === '/api/higequ/import') {
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}');
      const rid = String(body.rid || '');
      if (!/^\d{1,20}$/.test(rid)) return json(res, 400, { message: 'rid 不合法（应为纯数字）' });
      const newId = String(body.id || 'hi-' + rid).trim();
      if (!ID_RULE.test(newId)) return json(res, 400, { message: 'ID 只允许 1-64 位字母/数字/下划线/连字符' });
      const entries = await readCatalogEntries();
      if (entries.some(e => e.id === newId)) return json(res, 409, { message: `ID 已存在：${newId}` });
      const pageHtml = await fetchHiPlayerPage(`https://higequ.com/player/${rid}/`);
      // 导入以页面为准，跳过与搜索行的身份核对（挑选动作本身就是人工确认）。
      const detail = parseHiDetail(pageHtml, { sourceUrl: `https://higequ.com/player/${rid}/` }, { title: '', artist: '', durationMs: 0 }, { verifyIdentity: false });
      const audioUrl = parseHiAudio(pageHtml);
      if (!audioUrl) return json(res, 404, { message: '播放页没有可用的音频直链（页面结构变化或不在白名单域），已放弃' });
      const bytes = await fetchLimited(audioUrl, AUDIO_LIMIT, allowedAudioUrl);
      if (!looksLikeMp3(bytes)) return json(res, 422, { message: '下载内容不是 MP3（魔数不符），已放弃' });
      const created = [];
      const entry = { id: newId, title: detail.title, artist: detail.artist, file: `audio/${newId}.mp3` };
      if (body.album && String(body.album).trim()) entry.album = String(body.album).trim();
      try {
        await mkdir(dirname(join(MEDIA_DIR, entry.file)), { recursive: true });
        await writeFile(join(MEDIA_DIR, entry.file), bytes, { flag: 'wx' });
        created.push(entry.file);
        if (detail.lyrics?.status === 'matched' && detail.lyrics.text) {
          const lrcRel = `lyrics/${newId}-${randomUUID()}.lrc`;
          await mkdir(dirname(join(MEDIA_DIR, lrcRel)), { recursive: true });
          await writeFile(join(MEDIA_DIR, lrcRel), detail.lyrics.text, { flag: 'wx' });
          created.push(lrcRel);
          entry.lyrics = lrcRel;
        }
        if (detail.coverUrl) {
          const img = await fetchLimited(detail.coverUrl, COVER_LIMIT, allowedCoverUrl);
          const covRel = `covers/${newId}-${randomUUID()}.${imageExtension(img)}`;
          await mkdir(dirname(join(MEDIA_DIR, covRel)), { recursive: true });
          await writeFile(join(MEDIA_DIR, covRel), img, { flag: 'wx' });
          created.push(covRel);
          entry.cover = covRel;
        }
        await writeAndValidate(entries, [...entries, entry]);
      } catch (err) {
        if (!err.message?.includes('回滚失败')) for (const rel of created) await unlink(join(MEDIA_DIR, rel)).catch(() => {});
        throw err;
      }
      return json(res, 200, { ok: true, id: newId, title: entry.title,
        message: `已从 Hi歌曲导入：「${entry.title} / ${entry.artist}」（${(bytes.length / 1024 / 1024).toFixed(1)}MB`
          + `${entry.lyrics ? ' + 歌词' : ''}${entry.cover ? ' + 封面' : ''}），ID = ${newId}` });
    }
    // 上传新歌曲（原始字节流，避免 multipart 解析；id/title 走自定义头，中文 URL 编码）
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const id = decodeURIComponent(req.headers['x-track-id'] || '');
      const title = decodeURIComponent(req.headers['x-track-title'] || '');
      if (!ID_RULE.test(id)) return json(res, 400, { message: 'ID 只允许 1-64 位字母/数字/下划线/连字符' });
      if (!title.trim()) return json(res, 400, { message: '歌名不能为空' });
      const oldEntries = await readCatalogEntries();
      if (oldEntries.some(e => e.id === id)) return json(res, 409, { message: `ID 已存在：${id}` });
      const data = await readBody(req, UPLOAD_MAX_BYTES);
      if (data.length === 0) return json(res, 400, { message: '文件内容为空' });
      // 音频统一收进 audio/ 子目录（2026-09-27 目录重构：audio/lyrics/covers 分区）
      await mkdir(join(MEDIA_DIR, 'audio'), { recursive: true });
      const fileName = `${id}.mp3`;
      const filePath = join(MEDIA_DIR, 'audio', fileName);
      try { await stat(filePath); return json(res, 409, { message: `文件已存在：${fileName}` }); }
      catch { /* 不存在才继续 */ }
      await writeFile(filePath, data);
      try {
        const id3 = await readId3(filePath);
        if (id3.durationMs <= 0) throw new Error('无法读取歌曲时长，文件可能不是有效 MP3');
        // ID3 读到的标签直接写进条目（设计稿第 7 节"编目条目自动生成"的本地实现）；
        // 上传表单里的手填值优先（界面在上传前已把表单值放进自定义头）。
        const entry = { id, title: title.trim(), file: `audio/${fileName}` };
        const h = k => decodeURIComponent(req.headers[k] || '').trim();
        const artist = h('x-track-artist') || id3.artist;
        const album = h('x-track-album') || id3.album;
        const genre = h('x-track-genre') || id3.genre;
        const year = Number(h('x-track-year')) || id3.year;
        if (artist) entry.artist = artist;
        if (album) entry.album = album;
        if (genre) entry.genre = genre;
        if (year) entry.year = year;
        await writeAndValidate(oldEntries, [...oldEntries, entry]);
        return json(res, 200, { ok: true, message: `上传成功：「${entry.title}」（${fileName}）`, id });
      } catch (err) {
        await unlink(filePath).catch(() => {}); // 校验不过连文件一起清掉，不留半成品
        throw err;
      }
    }
    json(res, 404, { message: '接口不存在' });
  } catch (err) {
    json(res, err.message?.startsWith('写入后校验') ? 422 : 500, { message: err.message || '服务器内部错误' });
  }
}

/** 收集请求体，超限即断（上传 200MB / JSON 1MB 由调用方给）。 */
function readBody(req, limit) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体超过大小限制')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 启动前整库自检：库坏了直接退出并打印原因，不开一个会返回假数据的界面。
try {
  const tracks = await loadCatalog(MEDIA_DIR);
  console.log(`曲库自检通过：${MEDIA_DIR}（${tracks.length} 首）`);
} catch (err) {
  console.error(`曲库自检失败：${err.message}`);
  process.exit(1);
}
server.listen(PORT, HOST, () => {
  console.log(`元信息管理器：http://${HOST}:${server.address().port}（Ctrl+C 停止）`);
  console.log('保存即写 catalog.json；运行中的后端需重启才会重新加载（重启清空内存房间）。');
  console.log(`「联网匹配」按所选源出网（Hi歌曲优先 / QQ 音乐 / 网易云音乐 / MusicBrainz，各自限速见 lib/metadata-sources.mjs），候选只读，勾选后才写库；缓存见 CACHE_PATH。`);
  console.log(`「删除」把曲目移出 catalog 并把文件移进回收目录：${TRASH_DIR}\\<批次>\\<库内相对路径>（同批一份 manifest.jsonl 记录被删条目与文件去向，可手工放回）。`);
});
