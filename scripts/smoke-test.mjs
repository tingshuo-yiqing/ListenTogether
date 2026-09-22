import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const WebSocket = require('ws');
const base = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const credentials = [], sockets = [];
async function api(method, path, body, member) {
  const response = await fetch(base + path, {
    method, headers: { ...(body ? {'Content-Type':'application/json'} : {}), ...(member ? {Authorization:'Bearer ' + member.token} : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000)
  });
  const data = await response.json();
  assert.ok(response.ok, data.message ?? 'HTTP ' + response.status);
  return data;
}
async function connect(member) {
  const messages = [];
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws/' + member.code, {headers:{Authorization:'Bearer ' + member.token}});
  sockets.push(ws);
  ws.on('message', bytes => messages.push(JSON.parse(bytes.toString())));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 握手超时')), 10000);
    ws.once('open', () => {clearTimeout(timer); resolve();});
    ws.once('error', error => {clearTimeout(timer); reject(error);});
  });
  return {ws, messages};
}
async function until(predicate) {
  const end = Date.now() + 5000;
  while (!predicate()) { if (Date.now() >= end) throw new Error('未收到预期的广播'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
try {
  assert.equal((await api('GET','/health')).ok, true);
  const host = await api('POST','/api/rooms',{nickname:'联调房主'}); credentials.push(host);
  const guest = await api('POST','/api/rooms/' + host.code + '/join',{nickname:'联调成员'}); credentials.push(guest);
  const catalog = await api('GET','/api/rooms/' + host.code + '/catalog',undefined,host);
  assert.ok(catalog.length >= 1, '请先启动带曲库的演示后端');
  const first = await connect(host), second = await connect(guest);
  first.ws.send(JSON.stringify({type:'command',action:'play'}));
  await until(() => second.messages.some(m => m.type === 'state' && m.playing));
  second.ws.send(JSON.stringify({type:'command',action:'pause'}));
  await until(() => second.messages.some(m => m.type === 'error' && m.status === 403));
  first.ws.send(JSON.stringify({type:'command',action:'seek',positionMs:1000}));
  await until(() => second.messages.some(m => m.type === 'state' && m.positionMs === 1000));
  const audio = await fetch(base + '/api/rooms/' + host.code + '/audio/' + catalog[0].id, {
    headers: {Authorization:'Bearer ' + host.token, Range:'bytes=0-1023'}, signal:AbortSignal.timeout(10000)
  });
  assert.equal(audio.status, 206);
  assert.equal((await audio.arrayBuffer()).byteLength, 1024);
  console.log('PASS: HTTP 健康检查、两端 WebSocket 播放/跳转广播、权限拦截、真实 MP3 Range 读取');
} finally {
  sockets.forEach(ws => ws.terminate());
  for (const member of credentials.reverse()) {
    await api('DELETE','/api/rooms/' + member.code + '/membership',undefined,member).catch(() => {});
  }
}
