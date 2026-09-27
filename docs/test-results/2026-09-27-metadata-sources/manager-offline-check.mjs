/**
 * 元信息管理器的离线验证驱动（2026-09-27 元数据整合轮）
 *
 * 跑法：node docs/test-results/2026-09-27-metadata-sources/manager-offline-check.mjs
 * 退出码：0 = 全部断言通过；1 = 有失败（打印每条失败的实际收到的响应）
 *
 * 为什么存在：`scripts/lib/metadata-sources.test.mjs` 的 29 项单测覆盖的是**判定层**
 * （打分、归一、限速、阈值），它们用假客户端跑，碰不到管理器的 HTTP 写入闸门。
 * 本驱动起**真的管理器进程** + 临时曲库，把"勾选后落库"这条链当成一次交付验收跑完：
 * apply 的类型校验、onlyIfEmpty 的再过滤、loadCatalog 失败的回滚、三源缓存互不污染，
 * 以及 [7] 用第二个"fetch 必抛"实例把出网降级的契约（502 而非 500、不写缓存、不中断批量）钉住。
 * 2026-09-27 晚 UX 轮新增 [6]：歌词文件清单/上传接口（落盘、BOM 剥离、重名语义、超限 413、
 * 上传后可被 catalog 引用并通过 loadCatalog）。
 * 同日删除功能轮新增 [8]：删除一首歌的三条硬约束——整库校验不过就一口拒绝且一个文件都不动、
 * 回收目录保留库内相对路径、共用同一份 .lrc 时按引用计数保留文件。
 *
 * 边界：**全程不出网**。匹配结果一律来自预置的 `--cache` 缓存文件（管理器已支持把缓存
 * 挪到临时目录，夹具数据绝不写进真实 `.workbuddy/metadata-cache.json`）；[6] 要走过真出网
 * 分支，就把那个实例的 `globalThis.fetch` 整个换成必抛异常，仍然是零公网请求；曲库建在系统
 * 临时目录并在 finally 删除，不碰 `media/`。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cacheKey } from '../../../scripts/lib/metadata-sources.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../..');
const MANAGER = path.join(PROJECT_ROOT, 'scripts', 'metadata-manager.mjs');
const PORT = Number(process.env.LT_CHECK_PORT || 3177);
const BASE = `http://127.0.0.1:${PORT}`;
// 第二轮实例的端口：只用来跑"出网必失败"的降级契约（见 [6]）。
const DOWN_PORT = PORT + 1;
const DOWN_BASE = `http://127.0.0.1:${DOWN_PORT}`;

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
  }
}

// ---- 夹具曲库：三首真 MP3 的副本 + 手写 catalog ----
// 本机有真实曲库就用真实的（时长/标签都是真的），否则退回仓库内的合成测试音，保证干净克隆也能跑。
function sourceAudio(relName) {
  const real = path.join(PROJECT_ROOT, 'media', relName);
  if (fs.existsSync(real)) return real;
  const fallback = path.join(PROJECT_ROOT, 'demo-media', 'demo-soft.mp3');
  if (!fs.existsSync(fallback)) throw new Error(`夹具音频缺失：media/${relName} 且 demo-media/demo-soft.mp3 也不存在`);
  return fallback;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-meta-check-'));
const cacheFile = path.join(dir, 'cache.json');
// 回收目录同样必须在临时目录里、且**在曲库之外**：删除组（[8]）会把文件真的挪走，
// 指到项目内就会污染真实回收站；放在曲库内则分不清"哪些是被删的、哪些是曲库自带的"。
const trashDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-meta-trash-'));
const entries = [
  { id: 'track-a', title: '有何不可', file: 'a.mp3', artist: '许嵩' },
  { id: 'track-b', title: '单车', file: 'b.mp3' },
  { id: 'track-c', title: '痴心绝对', file: 'c.mp3', artist: '李圣杰', album: '痴心绝对', year: 2002, genre: '国语流行' },
];
const catalogPath = path.join(dir, 'catalog.json');

function seedCache() {
  // 三个源对同一首给三个可区分的假候选：谁返回了就说明缓存键里的源名真的起了作用。
  const mk = (entry, source, candidate, score, coverUrl) => [
    `${source}|${cacheKey(entry)}`,
    { source, query: `${source}-query`, candidate, score, lookedUp: false, coverUrl },
  ];
  const [a, b] = entries;
  const rows = [
    mk(a, 'qq', { title: '有何不可', artist: '许嵩', album: 'QQ-ALBUM', genre: '', year: 2009, durationMs: 242000 }, 1.0, 'https://example.invalid/qq.jpg'),
    mk(a, 'netease', { title: '有何不可', artist: '许嵩', album: 'NE-ALBUM', genre: '', year: 2011, durationMs: 242000 }, 0.95, 'https://example.invalid/ne.jpg'),
    mk(a, 'musicbrainz', { title: '有何不可', artist: '许嵩', album: 'MB-ALBUM', genre: 'MB-GENRE', year: 2009, durationMs: 242000, releaseId: 'rel-1' }, 0.9, null),
    // 低于阈值的缓存条目：候选照回，但不给 changes、也不给封面（"不给误写留通道"）
    mk(b, 'qq', { title: '单车', artist: '某翻唱', album: 'LOW-ALBUM', genre: '', year: 1999, durationMs: 0 }, 0.5, 'https://example.invalid/low.jpg'),
  ];
  fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(rows), null, 2), 'utf8');
}

function readCatalog() { return fs.readFileSync(catalogPath, 'utf8'); }
function writeCatalog(list) { fs.writeFileSync(catalogPath, JSON.stringify(list, null, 2) + '\n', 'utf8'); }

async function api(method, pathName, body, base = BASE) {
  const res = await fetch(base + pathName, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* 非 JSON 由断言自己判 */ }
  return { status: res.status, body: payload };
}

// 原始字节上传（歌词/封面类接口）：自定义头 + 任意请求体，不走 JSON 包装。
async function apiRaw(method, pathName, { headers = {}, body } = {}, base = BASE) {
  const res = await fetch(base + pathName, { method, headers, body });
  let payload = null;
  try { payload = await res.json(); } catch { /* 非 JSON 由断言自己判 */ }
  return { status: res.status, body: payload };
}

function startManager(port, nodeFlags) {
  // nodeFlags 必须排在脚本路径**之前**：`node a.mjs --import x` 里的 --import 会被当成脚本参数，
  // 悄悄不生效（本驱动第一版就这么把一次真实公网请求放了出去，断言表现为 200 而不是 502）。
  const proc = spawn(process.execPath, [
    ...nodeFlags, MANAGER, '--dir', dir, '--port', String(port), '--cache', cacheFile, '--trash', trashDir,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  // --trash 也指进临时目录：删除组会把文件真的挪走，默认位置是项目内的 .workbuddy/media-trash。
  const stderr = [];
  proc.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
  return { proc, stderr };
}

// 就绪探测：管理器要 import server 编译产物并自检曲库，给它 8 秒
async function waitReady(base, stderr) {
  for (let i = 0; i < 80; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      if ((await fetch(base + '/api/tracks')).ok) return;
    } catch { /* 还没起来 */ }
  }
  throw new Error(`管理器未就绪：${stderr.join('')}`);
}

let child = null;
let down = null;
let stderr = [];
try {
  seedCache();
  writeCatalog(entries);
  for (const entry of entries) {
    fs.copyFileSync(sourceAudio(entry.file), path.join(dir, entry.file));
  }

  ({ proc: child, stderr } = startManager(PORT, []));
  await waitReady(BASE, stderr);
  console.log('\n[1] 源清单与参数校验');
  const sources = await api('GET', '/api/sources');
  check('GET /api/sources 返回三个源且默认 qq',
    sources.status === 200 && sources.body.default === 'qq'
    && sources.body.sources.map((s) => s.name).join(',') === 'qq,netease,musicbrainz', sources.body);
  check('阈值默认值随源清单下发', Number(sources.body?.minScore) === 0.8, sources.body);

  const badSource = await api('POST', '/api/tracks/track-a/sync', { source: 'kuwo' });
  check('未知源直接 400（不接受注册表外的源名）', badSource.status === 400, badSource.body);
  const badThreshold = await api('POST', '/api/tracks/track-a/sync', { source: 'qq', minScore: 'abc' });
  check('非法阈值 400', badThreshold.status === 400, badThreshold.body);

  console.log('\n[2] 三源缓存互不污染（全程不出网）');
  const syncQQ = await api('POST', '/api/tracks/track-a/sync', { source: 'qq' });
  const syncNE = await api('POST', '/api/tracks/track-a/sync', { source: 'netease' });
  const syncMB = await api('POST', '/api/tracks/track-a/sync', { source: 'musicbrainz' });
  check('QQ 命中自己的缓存候选（QQ-ALBUM/2009）',
    syncQQ.body?.usedCache === true && syncQQ.body?.candidate?.album === 'QQ-ALBUM' && syncQQ.body?.candidate?.year === 2009,
    { usedCache: syncQQ.body?.usedCache, album: syncQQ.body?.candidate?.album });
  check('网易云命中自己的缓存候选（NE-ALBUM/2011）而不是 QQ 的',
    syncNE.body?.usedCache === true && syncNE.body?.candidate?.album === 'NE-ALBUM', syncNE.body?.candidate);
  check('MusicBrainz 命中自己的缓存候选（MB-ALBUM + 流派）',
    syncMB.body?.candidate?.album === 'MB-ALBUM' && syncMB.body?.candidate?.genre === 'MB-GENRE', syncMB.body?.candidate);
  check('缓存命中即不出网（三个响应都没有真的去查平台）',
    [syncQQ, syncNE, syncMB].every((r) => r.body?.usedCache === true), '见上三条');
  check('达标候选的 changes 只含缺失字段（album/year），不覆盖已有 artist',
    JSON.stringify(Object.keys(syncQQ.body?.changes || {}).sort()) === '["album","year"]', syncQQ.body?.changes);
  check('QQ 封面地址透传给界面', syncQQ.body?.coverUrl === 'https://example.invalid/qq.jpg', syncQQ.body?.coverUrl);

  const low = await api('POST', '/api/tracks/track-b/sync', { source: 'qq' });
  check('低于阈值 → needs-review 且 changes 为空（不给误写留通道）',
    low.body?.status === 'needs-review' && Object.keys(low.body?.changes || {}).length === 0, low.body?.status);
  check('低于阈值时不给封面地址', low.body?.coverUrl == null, low.body?.coverUrl);

  console.log('\n[3] apply 的值校验（"应用"绝不含清空）');
  const unknownField = await api('POST', '/api/tracks/track-a/apply', { fields: { file: 'x.mp3' } });
  check('白名单外字段 400', unknownField.status === 400, unknownField.body);
  const garbageYear = await api('POST', '/api/tracks/track-a/apply', { fields: { year: '不是数字' } });
  check('垃圾年份 400（而不是被当成清空把字段删掉）', garbageYear.status === 400, garbageYear.body);
  const zeroYear = await api('POST', '/api/tracks/track-a/apply', { fields: { year: 0 } });
  check('year=0 被拒（纪元退化不得写进曲库）', zeroYear.status === 400, zeroYear.body);
  const oldYear = await api('POST', '/api/tracks/track-a/apply', { fields: { year: 1700 } });
  check('year=1700 被拒（超出 1800–2100）', oldYear.status === 400, oldYear.body);
  const stringYear = await api('POST', '/api/tracks/track-a/apply', { fields: { year: '2003' } });
  check('year 为字符串被拒（必须整数）', stringYear.status === 400, stringYear.body);
  const emptyArtist = await api('POST', '/api/tracks/track-a/apply', { fields: { artist: '' } });
  check('空串 artist 被拒（清空只属于手工编辑那条路径）', emptyArtist.status === 400, emptyArtist.body);
  const noFields = await api('POST', '/api/tracks/track-a/apply', { fields: {} });
  check('空 fields 被拒', noFields.status === 400, noFields.body);
  check('值校验失败期间曲库一字节未变', readCatalog() === JSON.stringify(entries, null, 2) + '\n');

  console.log('\n[4] 写入 · onlyIfEmpty · 覆盖 · 回滚');
  const write = await api('POST', '/api/tracks/track-a/apply', { fields: { album: '自定义', year: 2009 } });
  const afterWrite = JSON.parse(readCatalog());
  const trackA = afterWrite.find((e) => e.id === 'track-a');
  check('勾选字段落库成功且过了 loadCatalog', write.status === 200 && trackA.album === '自定义' && trackA.year === 2009, trackA);
  check('落库保留原有 artist 且未新增未知键', trackA.artist === '许嵩' && Object.keys(trackA).sort().join(',') === 'album,artist,file,id,title,year', Object.keys(trackA));

  const again = await api('POST', '/api/tracks/track-a/apply', { fields: { album: '第二次', year: 2020 }, onlyIfEmpty: true });
  const afterSkip = JSON.parse(readCatalog()).find((e) => e.id === 'track-a');
  check('onlyIfEmpty 对已有值一律跳过', again.body?.skipped === true && afterSkip.album === '自定义' && afterSkip.year === 2009, { status: again.body?.skipped, album: afterSkip.album });

  const partial = await api('POST', '/api/tracks/track-a/apply', { fields: { album: '已有值', genre: '流行' }, onlyIfEmpty: true });
  const afterPartial = JSON.parse(readCatalog()).find((e) => e.id === 'track-a');
  check('onlyIfEmpty 只补真正空缺的字段（genre 写入、album 不动）',
    partial.status === 200 && afterPartial.genre === '流行' && afterPartial.album === '自定义', afterPartial);

  const forceOverwrite = await api('POST', '/api/tracks/track-a/apply', { fields: { album: '显式覆盖' } });
  const afterForce = JSON.parse(readCatalog()).find((e) => e.id === 'track-a');
  check('不带 onlyIfEmpty 时按勾选覆盖（人工确认过的覆盖是明确意图）',
    forceOverwrite.status === 200 && afterForce.album === '显式覆盖', afterForce.album);

  const legit1970 = await api('POST', '/api/tracks/track-b/apply', { fields: { year: 1970 } });
  check('1970 是合法年份，可以写（不是所有小年份都是纪元垃圾）',
    legit1970.status === 200 && JSON.parse(readCatalog()).find((e) => e.id === 'track-b').year === 1970, legit1970.body);

  // 回滚：把 b.mp3 从盘上删掉，让整库校验必然失败，看 apply 是否 422 且逐字节复原
  const beforeBad = readCatalog();
  fs.unlinkSync(path.join(dir, 'b.mp3'));
  const badWrite = await api('POST', '/api/tracks/track-c/apply', { fields: { album: '不该留下' } });
  check('整库校验失败回 422（不是 500）', badWrite.status === 422, badWrite.body);
  check('失败后 catalog 逐字节回滚', readCatalog() === beforeBad, badWrite.body?.message);
  check('回滚后写入值确实没进文件', JSON.parse(readCatalog()).find((e) => e.id === 'track-c').album === '痴心绝对');
  fs.copyFileSync(sourceAudio('b.mp3'), path.join(dir, 'b.mp3'));

  const aliveAfterRollback = await api('GET', '/api/tracks');
  check('一次失败写入不影响管理器继续服务', aliveAfterRollback.status === 200 && aliveAfterRollback.body?.tracks?.length === 3, aliveAfterRollback.status);

  console.log('\n[5] 界面读到的生效值口径');
  const list = await api('GET', '/api/tracks');
  const listedA = list.body?.tracks?.find((t) => t.id === 'track-a');
  check('列表回的是 catalog 生效值（手填优先于 ID3）',
    listedA?.artist === '许嵩' && listedA?.album === '显式覆盖' && listedA?.year === 2009, listedA);

  console.log('\n[6] 歌词清单与上传（2026-09-27 晚 UX 轮新增接口）');
  const noLyricsYet = await api('GET', '/api/lyrics-files');
  check('lyrics 目录不存在时清单返回空数组（不报错）',
    noLyricsYet.status === 200 && Array.isArray(noLyricsYet.body?.files) && noLyricsYet.body.files.length === 0,
    noLyricsYet.body);

  const lrcText = '[00:01.00]第一句\n[00:05.00]第二句\n';
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lrcText, 'utf8')]);
  const upOk = await apiRaw('POST', '/api/lyrics', {
    headers: { 'Content-Type': 'text/plain', 'X-File-Name': encodeURIComponent('test-song.lrc') },
    body: withBom,
  });
  const lrcPath = path.join(dir, 'lyrics', 'test-song.lrc');
  check('合法 .lrc 上传成功并返回库内相对路径',
    upOk.status === 200 && upOk.body?.path === 'lyrics/test-song.lrc' && fs.existsSync(lrcPath), upOk.body);
  check('落盘内容已剥 BOM 且文本原样',
    fs.existsSync(lrcPath) && fs.readFileSync(lrcPath, 'utf8') === lrcText,
    fs.existsSync(lrcPath) ? fs.readFileSync(lrcPath).subarray(0, 3) : '文件不存在');

  const listed = await api('GET', '/api/lyrics-files');
  check('上传后清单能列出该文件', listed.body?.files?.includes('lyrics/test-song.lrc'), listed.body);

  const upSame = await apiRaw('POST', '/api/lyrics', {
    headers: { 'X-File-Name': encodeURIComponent('test-song.lrc') }, body: Buffer.from(lrcText, 'utf8'),
  });
  check('同名同内容 → 复用而非报错', upSame.status === 200 && upSame.body?.reused === true, upSame.body);
  const upConflict = await apiRaw('POST', '/api/lyrics', {
    headers: { 'X-File-Name': encodeURIComponent('test-song.lrc') }, body: Buffer.from('[00:09.00]别的内容\n', 'utf8'),
  });
  check('同名不同内容 → 409（不静默覆盖）', upConflict.status === 409, upConflict);

  for (const badName of ['歌词.lrc', '../evil.lrc', 'a/b.lrc', 'noext', 'UPPER.LRC']) {
    const bad = await apiRaw('POST', '/api/lyrics', {
      headers: { 'X-File-Name': encodeURIComponent(badName) }, body: Buffer.from(lrcText, 'utf8'),
    });
    check(`非法文件名 ${JSON.stringify(badName)} → 400（防穿越、守曲库拼音命名约定）`, bad.status === 400, { status: bad.status });
  }
  const empty = await apiRaw('POST', '/api/lyrics', {
    headers: { 'X-File-Name': encodeURIComponent('empty.lrc') }, body: Buffer.alloc(0),
  });
  check('空文件 → 400', empty.status === 400, empty);
  const oversized = await apiRaw('POST', '/api/lyrics', {
    headers: { 'X-File-Name': encodeURIComponent('big.lrc') }, body: Buffer.alloc(256 * 1024 + 1, 0x61),
  });
  check('超过 256KB → 413（与 loadCatalog 上限同口径）', oversized.status === 413, oversized);
  check('被拒的上传一个都没落盘',
    !fs.existsSync(path.join(dir, 'lyrics', 'evil.lrc')) && !fs.existsSync(path.join(dir, 'lyrics', 'big.lrc'))
    && !fs.existsSync(path.join(dir, 'lyrics', 'empty.lrc')) && !fs.existsSync(path.join(dir, 'evil.lrc')));

  const refEdit = await api('PUT', '/api/tracks/track-b', { title: '单车', lyrics: 'lyrics/test-song.lrc' });
  const afterRef = (await api('GET', '/api/tracks')).body?.tracks?.find((t) => t.id === 'track-b');
  check('上传的歌词可被 catalog 引用并过 loadCatalog（hasLyrics 生效）',
    refEdit.status === 200 && afterRef?.effective?.hasLyrics === true && afterRef?.lyrics === 'lyrics/test-song.lrc',
    { status: refEdit.status, hasLyrics: afterRef?.effective?.hasLyrics });

  console.log('\n[7] 出网失败的降级契约（第二轮实例：globalThis.fetch 被换成必抛）');
  // 为什么单独起一个实例：降级路径只有在"缓存未命中、真去查平台"时才会走到，而本驱动其余各组
  // 全靠缓存保持零出网。预加载模块在管理器代码之前把 fetch 换成必然抛异常，出网这条路就只剩
  // 降级行为可测；不在这个驱动进程里改全局，是因为驱动自己要用 fetch 打管理器的本地接口。
  const offlinePreload = path.join(dir, 'no-network.mjs');
  fs.writeFileSync(offlinePreload,
    "globalThis.fetch = async (input) => { throw new Error('离线验证：拒绝出网 ' + String(input)); };\n", 'utf8');
  down = startManager(DOWN_PORT, ['--import', pathToFileURL(offlinePreload).href]);
  await waitReady(DOWN_BASE, down.stderr);

  const keysBefore = Object.keys(JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
  const dead = await api('POST', '/api/tracks/track-c/sync', { source: 'qq' }, DOWN_BASE);
  check('出网失败回 502 而不是 500（批量里这一首标红就能继续下一首）', dead.status === 502,
    { status: dead.status, body: dead.body });
  check('降级响应带 network-error 状态与真实失败原因',
    dead.body?.status === 'network-error' && /拒绝出网/.test(String(dead.body?.message || '')), dead.body);
  check('降级响应回显是哪一首失败（界面按行标红的依据）', dead.body?.id === 'track-c', dead.body?.id);
  const keysAfter = Object.keys(JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
  check('失败不写缓存（否则一次断网会把"查不到"钉成永久结论）',
    keysAfter.length === keysBefore.length, { before: keysBefore.length, after: keysAfter.length });
  const cachedStillWorks = await api('POST', '/api/tracks/track-a/sync', { source: 'qq' }, DOWN_BASE);
  check('一次出网失败不影响别的曲目（缓存命中的照常给候选）',
    cachedStillWorks.status === 200 && cachedStillWorks.body?.candidate?.album === 'QQ-ALBUM',
    { status: cachedStillWorks.status });
  const aliveAfterNetwork = await api('GET', '/api/tracks', undefined, DOWN_BASE);
  check('出网失败后管理器继续服务', aliveAfterNetwork.status === 200 && aliveAfterNetwork.body?.tracks?.length === 3,
    aliveAfterNetwork.status);
  down.proc.kill();
  down = null;

  console.log('\n[8] 删除曲目（闸门先行 · 回收目录 · 文件引用计数）');
  // 夹具补种（放在本组内，前面的组看不到这些字段）——三种"共用/越界"形态一次凑齐：
  // - track-a 与 track-b 共用同一份 .lrc；
  // - track-a 上传一张独立封面（落 covers/），再手写让 track-c 引用同一个路径（共用封面）；
  // - 新种 track-d：音频故意复用 c.mp3（共用音频）、封面指向库根的 stray.png（covers/ 之外）。
  const lrcRel = 'lyrics/test-song.lrc';
  const sharedLrc = path.join(dir, 'lyrics', 'test-song.lrc');
  const png1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const shareLrc = await api('PUT', '/api/tracks/track-a', {
    title: '有何不可', artist: '许嵩', album: '显式覆盖', genre: '流行', year: 2009, lyrics: lrcRel,
  });
  check('夹具：track-a 挂上同一份歌词（与 track-b 共用）',
    shareLrc.status === 200 && fs.existsSync(sharedLrc), shareLrc.body);
  const seedCover = await apiRaw('POST', '/api/tracks/track-a/cover',
    { headers: { 'Content-Type': 'image/png' }, body: png1x1 });
  const coverRel = JSON.parse(readCatalog()).find((e) => e.id === 'track-a')?.cover;
  check('夹具：track-a 有独立封面且落在 covers/ 内',
    seedCover.status === 200 && typeof coverRel === 'string' && coverRel.startsWith('covers/')
    && fs.existsSync(path.join(dir, coverRel)), seedCover.body);
  fs.writeFileSync(path.join(dir, 'stray.png'), png1x1);
  const seeded = JSON.parse(readCatalog());
  seeded.find((e) => e.id === 'track-c').cover = coverRel;
  seeded.push({ id: 'track-d', title: '共用文件', file: 'c.mp3', cover: 'stray.png' });
  writeCatalog(seeded);

  const badKind = await api('DELETE', '/api/tracks/track-a?files=audio,master');
  check('白名单外的删除范围 400（不接受 audio/cover/lyrics 之外的 kind）', badKind.status === 400, badKind.body);
  const badRun = await api('DELETE', '/api/tracks/track-a?files=audio&run=..%2Fescape');
  check('回收批次名带路径穿越 400', badRun.status === 400, badRun.body);
  check('参数校验失败期间没有任何条目被移除', JSON.parse(readCatalog()).length === 4, JSON.parse(readCatalog()).length);
  const noSuch = await api('DELETE', '/api/tracks/track-zz?files=audio');
  check('不存在的歌曲 404', noSuch.status === 404, noSuch.body);

  // 闸门先于移文件：曲库坏到整库校验不过时，删除必须一口拒绝、一个文件都不许动。
  const beforeGate = readCatalog();
  fs.unlinkSync(path.join(dir, 'b.mp3'));
  const gated = await api('DELETE', '/api/tracks/track-c?run=gated&files=audio,cover,lyrics');
  check('整库校验失败时回 409 拒绝删除（不是先移文件再报错）', gated.status === 409, gated);
  check('拒绝删除时 catalog 逐字节不变', readCatalog() === beforeGate, gated.body?.message);
  check('拒绝删除的答复说清楚"没动文件"', /未改动任何文件/.test(String(gated.body?.message)), gated.body?.message);
  check('拒绝删除时音频/封面/歌词都还在原地',
    fs.existsSync(path.join(dir, 'c.mp3')) && fs.existsSync(path.join(dir, coverRel)) && fs.existsSync(sharedLrc));
  check('拒绝删除时不建回收批次目录（没动文件就不该留空批次）', !fs.existsSync(path.join(trashDir, 'gated')));
  fs.copyFileSync(sourceAudio('b.mp3'), path.join(dir, 'b.mp3'));

  const delD = await api('DELETE', '/api/tracks/track-d?run=shared&files=audio,cover');
  check('共用同一个音频文件时只删条目、不动文件（否则另一首当场变坏条目）',
    delD.status === 200 && delD.body?.moved?.length === 0
    && delD.body?.skipped?.some((s) => s.kind === 'audio' && /track-c 仍指向同一个音频文件/.test(String(s.reason)))
    && fs.existsSync(path.join(dir, 'c.mp3')), delD.body);
  check('covers/ 之外的封面只删条目、不动文件（只回收本工具放进去的）',
    delD.body?.skipped?.some((s) => s.kind === 'cover' && /不是本工具放入的/.test(String(s.reason)))
    && fs.existsSync(path.join(dir, 'stray.png')), delD.body?.skipped);

  const run1 = 'ui-batch1';
  const beforeA = JSON.parse(readCatalog());
  const delA = await api('DELETE', `/api/tracks/track-a?run=${run1}&files=audio,cover,lyrics`);
  check('整首删除：只有独占的音频进回收目录，两处共用都留在原地',
    delA.status === 200 && delA.body?.moved?.length === 1 && delA.body.moved[0].kind === 'audio'
    && delA.body?.skipped?.length === 2, delA.body);
  check('删除后 catalog 逐字节等于"原库减去这一条"',
    readCatalog() === JSON.stringify(beforeA.filter((e) => e.id !== 'track-a'), null, 2) + '\n',
    JSON.parse(readCatalog()).map((e) => e.id));
  check('共用同一份封面时文件保留并说明是谁还在引用',
    delA.body?.skipped?.some((s) => s.kind === 'cover' && /track-c 仍引用同一份封面/.test(String(s.reason)))
    && fs.existsSync(path.join(dir, coverRel)), delA.body?.skipped);
  check('共用同一份歌词时文件保留并说明是谁还在引用',
    delA.body?.skipped?.some((s) => s.kind === 'lyrics' && /track-b 仍引用同一份歌词/.test(String(s.reason)))
    && fs.existsSync(sharedLrc), delA.body?.skipped);
  check('回报的回收路径落在 --trash 的临时根（夹具不写真实回收目录）',
    path.resolve(String(delA.body?.trashDir)).startsWith(path.resolve(trashDir)), delA.body?.trashDir);
  check('移走的音频原位置不再留文件', !fs.existsSync(path.join(dir, 'a.mp3'))
    && fs.existsSync(path.join(trashDir, run1, 'a.mp3')), delA.body?.moved);

  const delC = await api('DELETE', `/api/tracks/track-c?run=${run1}&files=cover`);
  check('最后一份封面引用消失后，图片才随曲目进回收目录并保留库内相对路径',
    delC.status === 200 && delC.body?.moved?.some((m) => m.kind === 'cover')
    && !fs.existsSync(path.join(dir, coverRel)) && fs.existsSync(path.join(trashDir, run1, coverRel)), delC.body);

  const delB = await api('DELETE', '/api/tracks/track-b?run=ui-batch2&files=audio,cover,lyrics');
  check('最后一份歌词引用消失后 .lrc 才随曲目进回收目录',
    delB.status === 200 && delB.body?.moved?.some((m) => m.kind === 'lyrics')
    && !fs.existsSync(sharedLrc) && fs.existsSync(path.join(trashDir, 'ui-batch2', lrcRel)), delB.body);
  check('未挂独立封面的曲目如实回报"没有独立封面文件"而非静默',
    delB.body?.skipped?.some((s) => s.kind === 'cover' && /没有独立封面/.test(String(s.reason))), delB.body?.skipped);

  const manifest = path.join(trashDir, run1, 'manifest.jsonl');
  const rows = fs.existsSync(manifest)
    ? fs.readFileSync(manifest, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  check('同一批次的两次删除共用一个批次目录与一份 manifest.jsonl',
    rows.map((r) => r.id).join(',') === 'track-a,track-c', rows.map((r) => r.id));
  check('manifest 记下被删条目原文与每个文件的来去（放回不必凭记忆重填）',
    rows[0]?.id === 'track-a' && rows[0]?.catalogEntry?.title === '有何不可'
    && rows[0]?.catalogEntry?.cover === coverRel
    && rows[0]?.moved?.length === 1 && rows[0]?.moved?.[0]?.to === path.join(trashDir, run1, 'a.mp3')
    && rows[0]?.skipped?.length === 2 && rows[0]?.failed?.length === 0, rows[0]);

  const emptied = await api('GET', '/api/tracks');
  check('全部删除后空编目仍正常服务（不是错误状态）',
    emptied.status === 200 && emptied.body?.tracks?.length === 0, emptied.body?.tracks?.map((t) => t.id));

  console.log('\n[9] 发布审查回归：上传、共享封面、多请求、原文回滚与来源边界');
  const audioBytes = fs.readFileSync(sourceAudio('a.mp3'));
  const upload = id => apiRaw('POST', '/api/upload', {
    headers: { 'X-Track-Id': id, 'X-Track-Title': id }, body: audioBytes,
  });
  const uploads = await Promise.all([upload('upload-a'), upload('upload-b')]);
  check('同时上传两首都成功，清单不丢更新', uploads.every(r => r.status === 200)
    && JSON.parse(readCatalog()).length === 2, uploads);
  check('音频子目录与 catalog 引用一致', JSON.parse(readCatalog()).every(e => e.file === `audio/${e.id}.mp3`
    && fs.existsSync(path.join(dir, e.file))));
  const edits = await Promise.all([
    api('PUT', '/api/tracks/upload-a', { title: 'A', artist: 'artist-A' }),
    api('PUT', '/api/tracks/upload-b', { title: 'B', artist: 'artist-B' }),
  ]);
  check('并发编辑不同歌曲各自保留', edits.every(r => r.status === 200)
    && JSON.parse(readCatalog()).every(e => e.artist === (e.id === 'upload-a' ? 'artist-A' : 'artist-B')), edits);
  // 非标准缩进与 CRLF：回滚必须恢复原字节，而非重新序列化同一个对象。
  fs.writeFileSync(catalogPath, JSON.stringify(JSON.parse(readCatalog())) + '\r\n');
  const rawBefore = readCatalog();
  const rejected = await api('PUT', '/api/tracks/upload-a', { title: 'bad', lyrics: 'missing.lrc' });
  check('校验失败逐字节还原紧凑 JSON 与 CRLF', rejected.status === 422 && readCatalog() === rawBefore, rejected);
  await apiRaw('POST', '/api/tracks/upload-a/cover', { body: png1x1 });
  const withCover = JSON.parse(readCatalog());
  const sharedCover = withCover.find(e => e.id === 'upload-a').cover;
  withCover.find(e => e.id === 'upload-b').cover = sharedCover;
  writeCatalog(withCover);
  const replaced = await apiRaw('POST', '/api/tracks/upload-a/cover', { body: png1x1 });
  check('替换共享封面保留另一首文件且整库可读', replaced.status === 200
    && fs.existsSync(path.join(dir, sharedCover)) && (await api('GET', '/api/tracks')).status === 200, replaced);
  const sharedAgain = JSON.parse(readCatalog());
  sharedAgain.find(e => e.id === 'upload-a').cover = sharedCover;
  writeCatalog(sharedAgain);
  const removed = await api('DELETE', '/api/tracks/upload-a/cover');
  check('移除共享封面保留另一首文件且整库可读', removed.status === 200
    && fs.existsSync(path.join(dir, sharedCover)) && (await api('GET', '/api/tracks')).status === 200, removed);
  const dotRun = await api('DELETE', '/api/tracks/upload-a?run=..');
  check('点目录批次名不能逃出回收根', dotRun.status === 400, dotRun);
  const external = await apiRaw('PUT', '/api/tracks/upload-a', {
    headers: { Origin: 'https://example.invalid' }, body: JSON.stringify({ title: 'external' }),
  });
  check('外站 Origin 写请求被拒绝', external.status === 403, external);

  console.log(`\n结果：${passed}/${passed + failures.length} 通过`);  if (failures.length) {
    console.log(`失败项：\n- ${failures.join('\n- ')}`);
    console.log(`管理器 stderr：\n${stderr.join('')}`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`验证驱动自身出错：${err.message}`);
  if (stderr && stderr.length) console.error(`管理器 stderr：\n${stderr.join('')}`);
  process.exitCode = 1;
} finally {
  if (child) child.kill();
  if (down?.proc) down.proc.kill();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(trashDir, { recursive: true, force: true }); // 回收目录是独立临时目录，一起清掉
}
