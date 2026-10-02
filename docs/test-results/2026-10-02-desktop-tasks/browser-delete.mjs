/** 真实管理接口 + Chrome：删除取消、单曲、删空、回收站恢复与后端重载闭环；只用合成夹具。 */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { fixture, manager, backend, identity, until, pause, evidence, sha256 } from './support.mjs';

const data = await fixture(), profile = await mkdtemp(join(tmpdir(), 'lt-delete-chrome-'));
const results = []; let service, playback, browser, ws;
const original = new Map();
for (const entry of data.entries) for (const kind of ['file', 'cover', 'lyrics']) original.set(entry[kind], sha256(await readFile(join(data.media, entry[kind]))));
try {
  service = await manager(data); playback = await backend(data.media);
  browser = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'],
    { stdio: 'ignore', windowsHide: true });
  const debugPort = await until(async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
  const tab = await (await fetch('http://127.0.0.1:' + debugPort + '/json/new?about:blank', { method: 'PUT' })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl); await once(ws, 'open');
  let seq = 0; const pending = new Map(), errors = [];
  ws.addEventListener('message', event => {
    const response = JSON.parse(event.data);
    if (response.id) { const call = pending.get(response.id); if (call) { clearTimeout(call.timer); pending.delete(response.id); response.error ? call.reject(new Error(JSON.stringify(response.error))) : call.resolve(response.result); } }
    if (response.method === 'Runtime.exceptionThrown') errors.push(response.params);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
    return value.result.value;
  };
  const wait = expression => until(() => evaluate(expression));
  const screenshot = async (name, width = 1280, height = 1000) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await pause(200);
    const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(join(evidence, name + '.png'), Buffer.from(image.data, 'base64'));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: service.url }); await wait('tracks.length === 2');
  await evaluate("select('a');document.getElementById('btn-delete-track').click()");
  await wait("document.getElementById('del-mask').classList.contains('on')");
  await screenshot('delete-confirm');
  await evaluate("document.getElementById('del-cancel').click()");
  assert.equal(await evaluate('tracks.length'), 2); results.push('删除取消不改曲库');
  await evaluate("document.getElementById('btn-delete-track').click();document.getElementById('del-go').click()");
  await wait("tracks.length === 1 && !document.getElementById('del-mask').classList.contains('on')");
  assert.equal(await evaluate("document.querySelectorAll('.track-item').length"), 1);
  assert.equal(await evaluate("rowCache.has('a')"), false); results.push('真实单曲删除，旧行和缓存清除');
  await screenshot('after-single-delete');
  await evaluate("select('b');document.getElementById('btn-delete-track').click();document.getElementById('del-go').click()");
  await wait("tracks.length === 0 && !document.getElementById('del-mask').classList.contains('on')");
  assert.equal(await evaluate("document.querySelectorAll('.track-item').length"), 0);
  assert.equal(await evaluate('rowCache.size'), 0);
  assert.equal(await evaluate("document.getElementById('empty-tip').textContent.includes('新增歌曲') && document.getElementById('empty-tip').textContent.includes('回收站')"), true);
  assert.deepEqual(JSON.parse(await readFile(join(data.media, 'catalog.json'), 'utf8')), []);
  await pause(4500); // 成功提示淡出后再拍空态，保证顶栏入口清晰可见。
  await screenshot('empty-library-desktop'); await screenshot('empty-library-mobile', 390, 844);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  results.push('删空：catalog=[]、无残留行/节点、桌面与窄屏截图、无横向溢出');

  // 后端启动时加载；先证明未重启仍看到旧清单与音频404，再证明重启后真实空库。
  const oldHost = await identity(playback.url);
  const oldCatalog = await (await fetch(playback.url + '/api/rooms/' + oldHost.code + '/catalog', { headers: oldHost.headers })).json();
  assert.equal(oldCatalog.length, 2);
  assert.equal((await fetch(playback.url + '/api/rooms/' + oldHost.code + '/audio/a', { headers: oldHost.headers })).status, 404);
  results.push('未重启缓存仍2首、已移走音频404，证明维护需重启');
  await playback.stop(); playback = await backend(data.media);
  const emptyHost = await identity(playback.url);
  assert.deepEqual(await (await fetch(playback.url + '/api/rooms/' + emptyHost.code + '/catalog', { headers: emptyHost.headers })).json(), []);
  results.push('重启后后端空库正常加载、health正常');

  await evaluate("document.getElementById('btn-trash').click()");
  await wait("document.querySelectorAll('#trash-items button').length === 2");
  await screenshot('trash-before-restore', 1280, 1000);
  await evaluate("document.querySelector('#trash-items button').click()");
  await wait("tracks.length === 1 && document.querySelectorAll('#trash-items button').length === 1");
  await evaluate("document.querySelector('#trash-items button').click()");
  await wait("tracks.length === 2 && document.querySelectorAll('#trash-items button').length === 0");
  await evaluate("document.getElementById('trash-close').click()");
  await screenshot('restored-library');
  const restored = JSON.parse(await readFile(join(data.media, 'catalog.json'), 'utf8')).sort((a,b) => a.id.localeCompare(b.id));
  assert.deepEqual(restored, data.entries);
  for (const [path, hash] of original) assert.equal(sha256(await readFile(join(data.media, path))), hash);
  const trash = await (await fetch(service.url + '/api/trash')).json();
  assert.equal(trash.items.length, 0); assert.deepEqual(trash.errors, []);
  results.push('界面恢复两首，全部音频/封面/歌词及元数据逐字节一致');
  await playback.stop(); playback = await backend(data.media);
  const restoredHost = await identity(playback.url);
  const restoredCatalog = await (await fetch(playback.url + '/api/rooms/' + restoredHost.code + '/catalog', { headers: restoredHost.headers })).json();
  assert.equal(restoredCatalog.length, 2); assert.equal(restoredCatalog[0].album, '测试专辑');
  const audio = await fetch(playback.url + '/api/rooms/' + restoredHost.code + '/audio/a', { headers: { ...restoredHost.headers, Range: 'bytes=0-1023' } });
  assert.equal(audio.status, 206); assert.equal((await audio.arrayBuffer()).byteLength, 1024);
  results.push('恢复后重启：专辑下发，Range206/1024字节');
  assert.deepEqual(errors, []); results.push('Chrome零未捕捉异常');
  await writeFile(join(evidence, 'browser-delete.json'), JSON.stringify({ at: new Date().toISOString(), passed: results.length, checks: results, realMediaModified: false, scope: '真实管理接口与本机后端，独立合成曲库；不代表云端在产演练' }, null, 2));
  console.log(JSON.stringify({ passed: results.length, checks: results }));
} catch (error) {
  await writeFile(join(evidence, 'browser-delete-failure.json'), JSON.stringify({ checks: results, error: error.stack }, null, 2));
  throw error;
} finally {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: 1000000, method: 'Browser.close' }));
  await playback?.stop(); await service?.stop();
  if (browser && browser.exitCode === null) { const ended = once(browser, 'exit'); browser.kill(); await Promise.race([ended, pause(3000)]); }
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(error => console.error('Chrome profile cleanup:', error.message));
  await data.cleanup();
}
