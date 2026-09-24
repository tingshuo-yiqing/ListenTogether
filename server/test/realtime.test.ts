import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { createSender, startHeartbeat, HANDSHAKE_LIMIT, HEARTBEAT_INTERVAL_MS, MAX_BUFFERED_BYTES } from '../src/realtime/socket.js';
import type { Track } from '../src/library/catalog.js';

const track = (id = 'one', durationMs = 10000): Track => ({ id, title: id, durationMs, path: '', size: 10 });
const createRoom = (app: FastifyInstance) => app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: 'host' } }).then(res => res.json());

async function until(predicate: () => Promise<boolean> | boolean) {
  const end = Date.now() + 5000;
  while (!(await predicate())) { if (Date.now() > end) throw new Error('WebSocket timeout'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
function open(address: string, code: string, token?: string, localAddress?: string) {
  const options = { headers: token ? { authorization: 'Bearer ' + token } : undefined, localAddress };
  return new WebSocket(address.replace('http', 'ws') + '/ws/' + code, options);
}
async function opened(ws: WebSocket) {
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
}
/** 用尽某来源 IP 的握手额度，返回该连接列表。 */
async function exhaust(address: string, code: string, token: string, sockets: WebSocket[], localAddress?: string) {
  for (let i = 0; i < HANDSHAKE_LIMIT.max; i++) {
    const ws = open(address, code, token, localAddress); sockets.push(ws);
    await opened(ws);
    await new Promise<void>(resolve => { ws.once('close', () => resolve()); ws.close(); });
  }
}
/** 发一次握手并取回被拒时的 HTTP 状态码；成功升级或长时间无响应都直接失败（避免用例挂死）。 */
function handshakeStatus(ws: WebSocket) {
  ws.on('error', () => {});
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('握手既未升级也未收到拒绝响应')), 3000);
    ws.once('open', () => { clearTimeout(timer); reject(new Error('握手意外成功')); });
    ws.on('unexpected-response', (_req, response) => { clearTimeout(timer); resolve(response.statusCode!); response.resume(); });
  });
}

// Q-4 ②：消息级限频是既有防线（每连接每秒 20 条），此前没有回归用例，改动传输层时容易被静默破坏。
test('message rate limit: 21st message within one second gets a 429 error frame', async t => {
  const { app } = await buildApp([track()], { timers: false });
  const messages: Array<Record<string, unknown>> = [];
  t.after(async () => { await app.close(); });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const host = await createRoom(app);
  const ws = open(address, host.code, host.token);
  t.after(() => ws.terminate());
  ws.on('message', data => messages.push(JSON.parse(data.toString())));
  await opened(ws);
  // 紧凑发送：21 条落在同一个 1 秒窗口内，前 20 条正常回 clock，第 21 条起只回 error 帧。
  for (let i = 0; i < 21; i++) ws.send(JSON.stringify({ type: 'sync', clientTimeMs: i }));
  await until(() => messages.some(m => m.type === 'error' && m.status === 429));
  assert.equal(messages.filter(m => m.type === 'clock').length, 20);
  const errors = messages.filter(m => m.type === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].status, 429);
});

// E-05：握手限连按 token + 来源 IP 组合计数，超出后拒绝升级。
test('handshake limit: same token and IP beyond the window quota is rejected before upgrade', async t => {
  const { app } = await buildApp([track()], { timers: false });
  const sockets: WebSocket[] = [];
  t.after(async () => { sockets.forEach(ws => ws.terminate()); await app.close(); });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const host = await createRoom(app);
  await exhaust(address, host.code, host.token, sockets);
  const rejected = open(address, host.code, host.token); sockets.push(rejected);
  assert.equal(await handshakeStatus(rejected), 429);
});

// 限流键必须含来源 IP：同一令牌换一个源地址不受已用尽的额度影响。
test('handshake limit: the same token from another source IP is not throttled', async t => {
  const { app } = await buildApp([track()], { timers: false });
  const sockets: WebSocket[] = [];
  t.after(async () => { sockets.forEach(ws => ws.terminate()); await app.close(); });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const host = await createRoom(app);
  await exhaust(address, host.code, host.token, sockets);
  const other = open(address, host.code, host.token, '127.0.0.2'); sockets.push(other);
  await opened(other);
  assert.equal(other.readyState, WebSocket.OPEN);
});

// 鉴权先于限连：无效令牌照旧 401，不会被限流遮成 429，也不占用有效额度的键空间。
test('handshake limit: invalid token still gets 401 after the quota is exhausted', async t => {
  const { app } = await buildApp([track()], { timers: false });
  const sockets: WebSocket[] = [];
  t.after(async () => { sockets.forEach(ws => ws.terminate()); await app.close(); });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const host = await createRoom(app);
  await exhaust(address, host.code, host.token, sockets);
  const wrongToken = open(address, host.code, 'not-a-token'); sockets.push(wrongToken);
  assert.equal(await handshakeStatus(wrongToken), 401);
});

// Q-4 ③：慢客户端 close(1013)，socket 面可注入，不必真把对端读缓冲塞满。
test('slow client: bufferedAmount over the threshold closes 1013, exactly at threshold still sends', () => {
  const closed: Array<[number, string]> = [], sent: string[] = [];
  const socket = { readyState: 1, bufferedAmount: MAX_BUFFERED_BYTES + 1, send: (data: string) => sent.push(data), close: (code: number, reason: string) => closed.push([code, reason]) };
  createSender(socket)({ type: 'state' });
  assert.deepEqual(closed, [[1013, 'slow client']]);
  assert.equal(sent.length, 0);

  const exact = { ...socket, bufferedAmount: MAX_BUFFERED_BYTES };
  createSender(exact)({ type: 'state' });
  assert.equal(sent.length, 1);
  assert.deepEqual(closed, [[1013, 'slow client']]);

  const closedSocket = { ...socket, readyState: 3 };
  createSender(closedSocket)({ type: 'state' });
  assert.equal(sent.length, 1);
});

// Q-4 ④：15 秒无 pong 才 terminate（两轮心跳），假 timer 驱动，不真等 15 秒。
test('heartbeat: pings every round, terminates only after a round without pong', () => {
  const events: string[] = [];
  let handler: (() => void) | undefined;
  const socket = { ping: () => events.push('ping'), terminate: () => events.push('terminate') };
  const heartbeat = startHeartbeat(socket, { setInterval: (fn: () => void, ms: number) => { assert.equal(ms, HEARTBEAT_INTERVAL_MS); handler = fn; return 1; }, clearInterval: () => { handler = undefined; } });

  handler!(); assert.deepEqual(events, ['ping']);
  heartbeat.pong();
  handler!(); assert.deepEqual(events, ['ping', 'ping']);   // 收到 pong 不终止，继续下一轮
  handler!(); assert.deepEqual(events, ['ping', 'ping', 'terminate']);
  heartbeat.stop(); assert.equal(handler, undefined);        // close 时必须能清掉定时器
});
