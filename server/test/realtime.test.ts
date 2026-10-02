import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { createSender, startHeartbeat, HANDSHAKE_LIMIT, HEARTBEAT_INTERVAL_MS, MAX_BUFFERED_BYTES } from '../src/realtime/socket.js';
import type { Track } from '../src/library/catalog.js';

const track = (id = 'one', durationMs = 10000): Track => ({ id, title: id, durationMs, path: '', size: 10, artist: null, cover: null, coverVer: null, lyricsPath: null, lyricsVer: null, album: null });
const createRoom = (app: FastifyInstance) => app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: 'host' }, headers: { 'x-listentogether-protocol': '2' } }).then(res => res.json());

async function until(predicate: () => Promise<boolean> | boolean) {
  const end = Date.now() + 5000;
  while (!(await predicate())) { if (Date.now() > end) throw new Error('WebSocket timeout'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
function open(address: string, code: string, token?: string, localAddress?: string) {
  const headers = token ? { authorization: 'Bearer ' + token, 'x-listentogether-protocol': '2' } : undefined;
  return new WebSocket(address.replace('http', 'ws') + '/ws/' + code, { headers, localAddress });
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

// Q-4 ②：v2 分类配额——sync 每成员每秒 2 次，第 3 条起 429（错误帧不断连接）；
// queue.sync 配额独立，不受 sync 配额耗尽影响。
test('sync quota: 3rd sync within one second gets a 429 error frame, queue.sync quota is separate', async t => {
  const { app } = await buildApp([track()], { timers: false });
  const messages: Array<Record<string, unknown>> = [];
  t.after(async () => { await app.close(); });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const host = await createRoom(app);
  const ws = open(address, host.code, host.token);
  t.after(() => ws.terminate());
  ws.on('message', data => messages.push(JSON.parse(data.toString())));
  await opened(ws);
  for (let i = 0; i < 3; i++) ws.send(JSON.stringify({ type: 'sync', clientTimeMs: i }));
  await until(() => messages.some(m => m.type === 'error' && m.status === 429));
  assert.equal(messages.filter(m => m.type === 'clock').length, 2);
  const queueStates = messages.filter(m => m.type === 'queue.state').length;
  ws.send(JSON.stringify({ type: 'queue.sync' }));
  await until(() => messages.filter(m => m.type === 'queue.state').length === queueStates + 1);
  const errors = messages.filter(m => m.type === 'error');
  assert.equal(errors.length, 1);
  assert.ok(typeof (errors[0] as { retryAfterMs?: number }).retryAfterMs === 'number', '429 必须带 retryAfterMs');
});

// 每连接每秒 100 条输入消息的硬保护：超出以 1008 关闭（连接级滥用边界，与业务限流分开）。
test('input hard limit: 101st message within one second closes 1008', async t => {
  const { app } = await buildApp([track()], { timers: false });
  t.after(async () => { await app.close(); });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const host = await createRoom(app);
  const ws = open(address, host.code, host.token);
  t.after(() => ws.terminate());
  await opened(ws);
  for (let i = 0; i < 101; i++) ws.send(JSON.stringify({ type: 'nope' }));
  const closeCode = await new Promise<number>(resolve => ws.once('close', code => resolve(code)));
  assert.equal(closeCode, 1008);
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
test('slow client: bufferedAmount over the threshold closes 1013, projected overflow waits for drain', () => {
  const closed: Array<[number, string]> = [], sent: string[] = [];
  const socket = { readyState: 1, bufferedAmount: MAX_BUFFERED_BYTES + 1, send: (data: string) => sent.push(data), close: (code: number, reason: string) => closed.push([code, reason]) };
  createSender(socket)({ type: 'state' });
  assert.deepEqual(closed, [[1013, 'slow client']]);
  assert.equal(sent.length, 0);

  const exact = { ...socket, bufferedAmount: MAX_BUFFERED_BYTES };
  const sendExact = createSender(exact);
  sendExact({ type: 'state' });
  assert.equal(sent.length, 0);
  exact.bufferedAmount = 0; sendExact.flush();
  assert.equal(sent.length, 1);
  assert.deepEqual(closed, [[1013, 'slow client']]);

  const closedSocket = { ...socket, readyState: 3 };
  createSender(closedSocket)({ type: 'state' });
  assert.equal(sent.length, 1);
});

// QC-D：应用层待发记账——send 前计入本帧字节、send 回调完成后回落；超过每连接
// 512KiB 以 1013 关闭（只关本连接），回调正常完成的客户端永不触发。
test('slow client: application-level pending beyond the cap closes 1013, drained callbacks keep sending', () => {
  const closed: Array<[number, string]> = [];
  const stalled = { readyState: 1, bufferedAmount: 0, send: (_data: string, _cb?: (err?: Error | null) => void) => {}, close: (code: number, reason: string) => { closed.push([code, reason]); (stalled as { readyState: number }).readyState = 2; } };
  const sendStalled = createSender(stalled);
  const frame = { type: 'chat.message', message: { text: 'x'.repeat(2048) } }; // ≈2KiB/帧
  for (let i = 0; i < 300; i++) sendStalled(frame); // 300 × ≈2KiB ≫ 512KiB
  assert.deepEqual(closed, [[1013, 'slow client']]);

  const drained = { readyState: 1, bufferedAmount: 0, send: (data: string, cb?: (err?: Error | null) => void) => cb?.(null), close: (code: number, reason: string) => closed.push([code, reason]) };
  const sendDrained = createSender(drained);
  for (let i = 0; i < 600; i++) sendDrained(frame); // 回调同步完成：待发始终回落，不触发 1013
  assert.equal(closed.length, 1);
});

// QC-D：同类快照合并——同一事件循环批次内的重复 queue.sync/chat.sync 各只产生一次最新快照，
// 防止慢客户端在恢复期间被复制快照堆积拖垮（协议「限流、快照与恢复」5）。
test('snapshot coalescing: burst queue.sync/chat.sync produce one latest snapshot each', async t => {
  const { app } = await buildApp([track()], { timers: false });
  const messages: Array<Record<string, unknown>> = [];
  t.after(async () => { await app.close(); });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const host = await createRoom(app);
  const ws = open(address, host.code, host.token);
  t.after(() => ws.terminate());
  ws.on('message', data => messages.push(JSON.parse(data.toString())));
  await opened(ws);
  await until(() => messages.some(m => m.type === 'chat.snapshot')); // 握手快照就位
  const queueBefore = messages.filter(m => m.type === 'queue.state').length;
  const chatBefore = messages.filter(m => m.type === 'chat.snapshot').length;
  ws.send(JSON.stringify({ type: 'queue.sync' }));
  ws.send(JSON.stringify({ type: 'queue.sync' }));   // 同一批次第二条：并入第一次恢复
  ws.send(JSON.stringify({ type: 'chat.sync' }));
  ws.send(JSON.stringify({ type: 'chat.sync', lastSeq: 5 })); // 合并时以最后一次 lastSeq 判缺口
  await until(() => messages.filter(m => m.type === 'queue.state').length === queueBefore + 1
    && messages.filter(m => m.type === 'chat.snapshot').length === chatBefore + 1);
  await new Promise(resolve => setTimeout(resolve, 100)); // 再等一拍：确认没有多余快照跟随
  assert.equal(messages.filter(m => m.type === 'queue.state').length, queueBefore + 1);
  assert.equal(messages.filter(m => m.type === 'chat.snapshot').length, chatBefore + 1);
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
