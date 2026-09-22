// M4 隧道联调：本机经 SSH 隧道对云端后端做 health/建房/曲库/音频 Range/WS 全链路验证。
// 用法（本机）：LT_BASE=http://127.0.0.1:3000 node scripts/tunnel-verify.mjs
// 依赖 server/node_modules 的 ws（WebSocket 需要 Authorization 头，全局 WebSocket 不支持自定义头）。
import { createRequire } from 'node:module';
const req = createRequire(new URL('../server/package.json', import.meta.url));
const WebSocket = req('ws');
const BASE = process.env.LT_BASE ?? 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = m => { console.log('PASS: ' + m); pass++; };
const bad = m => { console.log('FAIL: ' + m); fail++; };

const h = await (await fetch(BASE + '/health')).json();
h?.ok === true ? ok('health=' + JSON.stringify(h)) : bad('health=' + JSON.stringify(h));

const resp = await fetch(BASE + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'tunnel-check' }) });
const r = await resp.json();
resp.status === 200 && r.code && r.token ? ok(`room=${r.code} created, token length=${r.token.length}`) : bad(`create room status=${resp.status} body=${JSON.stringify(r)}`);
const auth = { authorization: 'Bearer ' + r.token };

const cat = await (await fetch(`${BASE}/api/rooms/${r.code}/catalog`, { headers: auth })).json();
cat?.length === 5 ? ok('catalog 200, 5 tracks: ' + cat.map(t => t.id).join(',')) : bad('catalog ' + JSON.stringify(cat)?.slice(0, 80));

const audio = `${BASE}/api/rooms/${r.code}/audio/demo-soft`;
const head = await fetch(audio, { headers: { ...auth, range: 'bytes=0-1023' } });
const hbuf = Buffer.from(await head.arrayBuffer());
head.status === 206 && hbuf.length === 1024 && head.headers.get('content-range') === 'bytes 0-1023/481114'
  ? ok(`Range 0-1023 -> 206 ${hbuf.length}B, content-range=${head.headers.get('content-range')}`)
  : bad(`range head status=${head.status} len=${hbuf.length} cr=${head.headers.get('content-range')}`);
const suf = await fetch(audio, { headers: { ...auth, range: 'bytes=-500' } });
const sbuf = Buffer.from(await suf.arrayBuffer());
suf.status === 206 && sbuf.length === 500 ? ok(`suffix -500 -> 206 ${sbuf.length}B`) : bad(`suffix status=${suf.status} len=${sbuf.length}`);
const full = await fetch(audio, { headers: auth });
const fbuf = Buffer.from(await full.arrayBuffer());
full.status === 200 && fbuf.length === 481114 ? ok(`full GET -> 200, ${fbuf.length}B`) : bad(`full status=${full.status} len=${fbuf.length}`);
const un = await fetch(audio);
un.status === 401 ? ok('audio without token -> 401') : bad(`no-token status=${un.status}`);

const wsResult = await new Promise(resolve => {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/' + r.code, { headers: auth });
  const seen = [];
  const timer = setTimeout(() => { ws.terminate(); resolve('WS-TIMEOUT seen=' + seen.join(',')); }, 8000);
  ws.on('open', () => { console.log('WS-OPEN'); ws.send(JSON.stringify({ type: 'sync', clientTimeMs: Date.now() })); });
  ws.on('message', d => {
    const msg = JSON.parse(String(d)); seen.push(msg.type);
    console.log(`WS-MSG type=${msg.type} ${String(d).slice(0, 80)}`);
    if (seen.includes('clock') && seen.includes('state')) { clearTimeout(timer); ws.close(); resolve('WS-OK ' + seen.join(',')); }
  });
  ws.on('error', e => { clearTimeout(timer); resolve('WS-ERROR ' + e.message); });
});
wsResult.startsWith('WS-OK') ? ok('WS handshake + sync reply: ' + wsResult) : bad('WS: ' + wsResult);

const leave = await fetch(`${BASE}/api/rooms/${r.code}/membership`, { method: 'DELETE', headers: auth });
(leave.status === 200) ? ok('temporary member left (cleanup)') : bad(`leave status=${leave.status}`);

console.log(`RESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
