import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { once } from 'node:events';
import { buildApp } from '../src/app.js';
import { loadCatalog } from '../src/library/catalog.js';
import { fileURLToPath } from 'node:url';

/** 用现有退房/离线清扫真正移除成员，无管理写接口、无伪造 HTTP401；真实 TCP WS 拒绝旧 token。 */
for (const reason of ['leave', 'offline-timeout'] as const) {
  test(`真实令牌作废：${reason} 后 HTTP/WS 拒绝旧身份，重新加入换新 token`, async t => {
    let now = 1000;
    const tracks = await loadCatalog(fileURLToPath(new URL('./fixtures', import.meta.url)));
    const { app, rooms } = await buildApp(tracks, { timers: false, now: () => now });
    const sockets: WebSocket[] = [];
    t.after(async () => { for (const ws of sockets) ws.terminate(); await app.close(); });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const host = rooms.create('保留房主'), room = rooms.get(host.code);
    // 持有房主身份保住房间，区分成员 token401 与房间404。
    const disconnect = rooms.connect(host.code, host.token, () => {});
    t.after(disconnect);
    const old = rooms.add(room, '成员');
    const headers = { authorization: 'Bearer ' + old.token, 'x-listentogether-protocol': '2' };
    const base = '/api/rooms/' + host.code;
    assert.equal((await app.inject({ url: base + '/catalog', headers })).statusCode, 200);
    if (reason === 'leave') {
      assert.equal((await app.inject({ method: 'DELETE', url: base + '/membership', headers })).statusCode, 200);
    } else {
      now += 59_999; rooms.tick(); // 协议规定离线宽限60秒，边界前旧身份仍可用。
      assert.equal((await app.inject({ url: base + '/catalog', headers })).statusCode, 200);
      now++; rooms.tick();
    }
    for (const route of ['/catalog', '/audio/tone', '/cover/tone', '/lyrics/tone']) {
      assert.equal((await app.inject({ url: base + route, headers })).statusCode, 401, route);
    }
    const rejected = new WebSocket(address.replace('http', 'ws') + '/ws/' + host.code, { headers });
    sockets.push(rejected); rejected.on('error', () => {});
    const rejection = await Promise.race([
      once(rejected, 'unexpected-response').then(([, response]) => { response.resume(); return response.statusCode; }),
      new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('旧 WS 令牌未在3秒内被拒')), 3000); timer.unref(); }),
    ]);
    assert.equal(rejection, 401);
    const renewed = (await app.inject({ method: 'POST', url: base + '/join', headers: { 'x-listentogether-protocol': '2' }, payload: { nickname: '成员' } })).json();
    assert.notEqual(renewed.token, old.token);
    const valid = new WebSocket(address.replace('http', 'ws') + '/ws/' + host.code, { headers: { ...headers, authorization: 'Bearer ' + renewed.token } });
    sockets.push(valid); await once(valid, 'open');
    assert.equal((await app.inject({ url: base + '/catalog', headers: { ...headers, authorization: 'Bearer ' + renewed.token } })).statusCode, 200);
    assert.equal(rooms.auth(host.code, host.token).member.id, host.memberId);
  });
}
