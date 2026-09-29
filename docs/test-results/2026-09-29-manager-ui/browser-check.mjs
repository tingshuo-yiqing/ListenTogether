/** 视图拆分与列表节点缓存的离线回归：真实 Chrome + 当前 HTML，HTTP 夹具不访问音乐平台。
 *  覆盖本轮三件事：①三视图互斥切换（body[data-view]）；②列表行节点缓存（筛选/排序/多选/删除后
 *  仍然正确，且筛不出结果时旧行必须从面板上消失）；③内联样式收编后布局未塌。
 *  其余路径（匹配/应用/批量/歌词/回收站）由 2026-09-28-higequ-manager/browser-check.mjs 覆盖。 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../../..');
const profile = await mkdtemp(join(tmpdir(), 'lt-views-assets-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const mk = (id, over = {}) => ({
  id, title: '歌曲 ' + id, artist: '歌手' + id, album: '专辑甲', genre: '流行', year: 2020,
  lyrics: null, hasCover: false, file: 'audio/' + id + '.mp3',
  effective: { artist: '歌手' + id, hasLyrics: false, size: 1024, durationMs: 200000 }, id3: {}, ...over,
});
let tracks = [mk('a'), mk('b', { album: '专辑乙' }), mk('c')];
let serviceVersion = '20260929-hi-aac';

const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(await readFile(join(root, 'scripts/metadata-manager.html')));
  }
  if (path.startsWith('/api/cover/')) { res.setHeader('Content-Type', 'image/png'); return res.end(png); }
  let value = {};
  if (path === '/api/tracks') value = { dir: '临时测试曲库', tracks };
  if (path === '/api/sources') value = { serviceVersion, sources: [{ name: 'higequ', label: 'Hi歌曲优先' }], default: 'higequ', minScore: 0.8 };
  if (path === '/api/trash') value = { items: [], errors: [] };
  if (path === '/api/lyrics-files') value = { files: [] };
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(value));
});

let browser; let ws;
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  browser = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
     '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(port, 'Chrome debugging ready');
  const tab = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl); await once(ws, 'open');
  let seq = 0; const pending = new Map(); const errors = [];
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(msg.error) : p.resolve(msg.result); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const wait = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 50)); }
    throw new Error('UI timeout ' + expression);
  };
  const visible = id => evaluate(`!!document.getElementById('${id}').offsetParent`);

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1050, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
  await wait('tracks.length === 3');

  // ① 三视图互斥：初始在浏览，另外两个视图不可见
  // 版本告警：服务端比页面新不得误报"旧版本"（09-29 就是这样误报的），比页面旧才该警告
  assert.equal(await evaluate("$('service-warning').hidden"), true, '同版本不应弹版本告警');
  serviceVersion = '20260930-xxx';
  await evaluate('loadSources()');
  assert.equal(await evaluate("$('service-warning').hidden"), true, '服务端比页面新时不得误报旧版本');
  serviceVersion = '20260928-1718';
  await evaluate('loadSources()');
  assert.equal(await evaluate("$('service-warning').hidden"), false, '服务端比页面旧时必须给出重启指引');
  serviceVersion = '20260929-hi-aac';
  await evaluate('loadSources()');
  assert.equal(await evaluate("$('service-warning').hidden"), true, '回到同版本应恢复无告警');

  assert.equal(await evaluate("document.body.dataset.view"), 'browse', '初始必须是浏览视图');
  assert.equal(await visible('view-browse'), true);
  assert.equal(await visible('view-batch'), false, '批量视图初始不可见');
  assert.equal(await visible('view-new'), false, '新增视图初始不可见');
  assert.equal(await evaluate("document.querySelector('#view-tabs .tab[aria-selected=\"true\"]').dataset.view"), 'browse');

  await evaluate("document.getElementById('btn-batch').click()");
  assert.equal(await evaluate('document.body.dataset.view'), 'batch');
  assert.equal(await visible('view-batch'), true, '切到批量视图后该视图必须可见');
  assert.equal(await visible('view-browse'), false, '视图互斥：浏览视图必须同时隐藏');
  assert.equal(await evaluate("document.getElementById('btn-batch').getAttribute('aria-selected')"), 'true');
  // 切进批量视图要立刻报"还差多少"，不必点开始匹配才发现没活可干
  assert.ok(await evaluate("$('batch-progress').textContent.includes('3 首存在空缺字段')"),
    '批量视图进入即提示缺字段数量，实测：' + await evaluate("$('batch-progress').textContent"));

  await evaluate("document.querySelector('#view-tabs .tab[data-view=\"new\"]').click()");
  assert.equal(await visible('view-new'), true, '新增视图必须可见');
  assert.equal(await visible('view-batch'), false);
  assert.equal(await visible('view-browse'), false);

  // 切视图不动数据：列表、选中态、表单都还在
  await evaluate("document.querySelector('#view-tabs .tab[data-view=\"browse\"]').click();select('b')");
  assert.equal(await evaluate('currentId'), 'b');
  assert.equal(await evaluate("$('f-title').value"), '歌曲 b');
  await evaluate("document.querySelector('#view-tabs .tab[data-view=\"batch\"]').click()");
  assert.equal(await evaluate('currentId'), 'b', '切到批量视图不应清掉当前选中');
  await evaluate("document.querySelector('#view-tabs .tab[data-view=\"browse\"]').click()");
  assert.equal(await evaluate("$('editor').style.display"), 'block', '切回浏览视图编辑区应仍在');

  // ② 列表节点缓存：同一批 DOM 节点复用，不因筛选重建
  const nodeId = "document.querySelectorAll('.track-item')[0].__id = 1";
  await evaluate(nodeId);
  await evaluate("$('f-filter').value='歌曲';renderList()");
  assert.equal(await evaluate("document.querySelectorAll('.track-item').length"), 3);
  assert.equal(await evaluate("document.querySelectorAll('.track-item')[0].__id"), 1, '筛选不得重建行节点');
  await evaluate("$('f-filter').value='专辑乙';renderList()");
  assert.equal(await evaluate("document.querySelectorAll('.track-item').length"), 1, '按专辑筛选命中 1 首');
  assert.equal(await evaluate("document.querySelector('.track-item .t-title').textContent"), '歌曲 b');
  await evaluate("$('f-filter').value='专辑';renderList()");
  assert.equal(await evaluate("document.querySelectorAll('.track-item').length"), 3, '专辑甲/乙都含"专辑"字样，三首都该命中');

  // 筛不出结果时旧行必须从面板消失，且给出空态
  await evaluate("$('f-filter').value='not-found';renderList()");
  assert.equal(await evaluate("document.querySelectorAll('.track-item').length"), 0, '筛不出结果时不得残留旧行');
  assert.equal(await evaluate("!!document.getElementById('list-empty')"), true, '应显示空态提示');
  // 筛回来时节点复用（缓存命中），不重新建
  await evaluate("$('f-filter').value='';renderList()");
  assert.equal(await evaluate("document.querySelectorAll('.track-item').length"), 3, '清空筛选后应恢复 3 行');
  assert.equal(await evaluate("document.querySelectorAll('.track-item')[0].__id"), 1, '缓存节点应被复用');

  // 排序：顺序可以变，节点不能换（先给所有行打标记，排序后标记应原封不动）
  await evaluate("document.querySelectorAll('.track-item').forEach(n=>n.__id=1)");
  tracks = [mk('a'), mk('b', { album: '专辑乙' }), mk('c')];
  tracks[0].lyrics = 'lyrics/a.lrc'; tracks[0].effective.hasLyrics = true;
  await evaluate('refresh(false)');
  await evaluate("$('f-sort').value='missing';renderList()");
  assert.equal(await evaluate("document.querySelectorAll('.track-item').length"), 3);
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.track-item')).every(n=>n.__id===1)"), true,
    '排序只应调整顺序，不应替换行节点');
  // 缺项最多的排前面：a 已被补上歌词，应落到最后
  assert.equal(await evaluate("document.querySelectorAll('.track-item')[2].__id"), 1);
  assert.equal(await evaluate("document.querySelectorAll('.track-item')[2].dataset.id"), 'a', '缺项最少的 a 应排在末位');

  // 多选：勾选框随多选模式出现/消失，勾选状态与按钮联动
  assert.equal(await evaluate("document.querySelector('.track-item').classList.contains('pickable')"), false);
  assert.equal(await evaluate("document.querySelector('.track-item input').hidden"), true, '非多选模式勾选框必须隐藏');
  await evaluate("document.getElementById('btn-pick').click()");
  assert.equal(await evaluate("document.querySelector('.track-item').classList.contains('pickable')"), true);
  assert.equal(await evaluate("document.querySelector('.track-item input').hidden"), false, '多选模式勾选框必须出现');
  await evaluate("document.querySelectorAll('.track-item input')[0].click()");
  assert.equal(await evaluate('picked.size'), 1, '点勾选框应进已选集合');
  assert.equal(await evaluate("$('btn-del-selected').disabled"), false, '有选中时删除按钮可点');
  // 勾选框不能冒泡成"选中编辑"
  assert.equal(await evaluate('currentId !== "a"'), true, '勾选框点击不应触发行点击');
  await evaluate("document.getElementById('btn-pick').click()");
  assert.equal(await evaluate("document.querySelector('.track-item input').hidden"), true, '退出多选后勾选框必须收起');
  assert.equal(await evaluate('picked.size'), 0, '退出多选应清空已选');

  // 删除后行节点与缓存都要清掉（曲库是夹具服务器持有的，refresh() 会重新拉回，
  // 所以要从驱动侧改这份数组，不能在页面上下文里改 tracks——那会被下一次 refresh 覆盖）
  await evaluate("document.getElementById('btn-pick').click();document.querySelectorAll('.track-item input')[0].click()");
  tracks = tracks.filter(t => t.id !== 'a');
  await evaluate('refresh(false)');
  assert.equal(await evaluate("document.querySelectorAll('.track-item').length"), 2, '删掉一首后应剩 2 行');
  assert.equal(await evaluate("rowCache.has('a')"), false, '被删曲目的行节点缓存必须一起清掉');
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.track-item')).every(n=>n.__id===1)"), true,
    '未受影响的行仍应复用原节点');

  // ③ 内联样式收编后布局没塌：歌词区可滚动、歌词文件行仍是横排
  await evaluate("select('b')");
  const layout = await evaluate(`(() => {
    const bar = document.getElementById('btn-lrc-upload').getBoundingClientRect();
    const inp = document.getElementById('f-lyrics').getBoundingClientRect();
    const pre = getComputedStyle(document.getElementById('current-lyrics-text'));
    return { sameRow: Math.abs(bar.top - inp.top) < 6, nowrap: pre.whiteSpace, lrcHidden: document.getElementById('f-lrc-file').offsetParent === null };
  })()`);
  assert.equal(layout.sameRow, true, '歌词输入框与上传按钮应同一行');
  assert.equal(layout.nowrap, 'pre-wrap', '歌词预览应保持 pre-wrap');
  assert.equal(layout.lrcHidden, true, '隐藏的 .lrc 文件选择器不应占位');

  for (const [w, h] of [[1280, 1050], [390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
    await new Promise(r => setTimeout(r, 150));
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(join(import.meta.dirname, `views-${w}.png`), Buffer.from(shot.data, 'base64'));
    assert.equal(await visible('view-browse'), true, w + 'px 下当前视图应仍可见');
  }
  // 窄屏下切视图仍互斥
  await evaluate("document.querySelector('#view-tabs .tab[data-view=\"batch\"]').click()");
  assert.equal(await visible('view-batch'), true, '390px 下切批量视图应可见');
  assert.equal(await visible('view-browse'), false);

  assert.deepEqual(errors.map(e => e.exceptionDetails?.exception?.description || e.params?.exceptionDetails?.exception?.description), [],
    '页面不应有未捕获 JS 异常');
  console.log('Chrome UI PASS: view switching (browse/batch/new, aria-selected, mutual exclusion), list node cache (filter/sort/pick/delete reuse, empty state), layout intact, 1280px + 390px, no JS exceptions');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  try { browser?.kill(); } catch {}
  server.close();
  // Chrome 退出与 profile 落盘之间有竞偶，等它真正放手再删，否则 Windows 上会 EBUSY
  await new Promise(r => setTimeout(r, 500));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
