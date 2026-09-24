import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { Rooms, IP_ROOM_QUOTA } from '../src/rooms/store.js';
import type { ServerEvent } from '../src/events.js';
import type { Track } from '../src/library/catalog.js';

const track = (id = 'one', durationMs = 10000): Track => ({ id, title: id, durationMs, path: '', size: 10 });
async function until(predicate: () => Promise<boolean> | boolean) {
  const end = Date.now() + 5000;
  while (!(await predicate())) { if (Date.now() > end) throw new Error('timeout'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
const health = async (app: FastifyInstance) => (await app.inject('/health')).json();

// E-09：建房路由有 per-IP 限速（30 次/分钟）但不限量，单 IP 仍可留存大量空房占内存。
test('per-IP room quota: 4th active room rejected, released after empty rooms expire', () => {
  let now = 0; const store = new Rooms([track()], () => now);
  for (const name of ['a', 'b', 'c']) store.create(name, '203.0.113.7');
  assert.equal(store.roomsOf('203.0.113.7'), IP_ROOM_QUOTA);
  assert.throws(() => store.create('d', '203.0.113.7'), /最多同时创建 3 个房间/);
  assert.equal(store.roomsOf('203.0.113.7'), IP_ROOM_QUOTA);            // 被拒的请求不占额度
  assert.ok(store.create('other', '198.51.100.9').code);                // 配额按 IP 隔离
  // 空房 5 分钟回收的语义不变，回收后额度自动释放（不按历史累计）。
  now += 300_000; store.tick();
  assert.equal(store.roomsOf('203.0.113.7'), 0);
  assert.ok(store.create('later', '203.0.113.7').code);
});

test('HTTP room quota is keyed by the request IP', async t => {
  const { app } = await buildApp([track()], { timers: false });
  t.after(async () => { await app.close(); });
  const create = (remoteAddress: string) => app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: 'quota' }, remoteAddress });
  for (let i = 0; i < IP_ROOM_QUOTA; i++) assert.equal((await create('203.0.113.7')).statusCode, 200);
  const rejected = await create('203.0.113.7');
  assert.equal(rejected.statusCode, 429);
  assert.match(rejected.json().message, /最多同时创建 3 个房间/);
  assert.equal((await create('198.51.100.9')).statusCode, 200);
});

// Q-3：排障事件必须覆盖房间/成员/房主全生命周期，且红线是不能带令牌或昵称。
test('structured events cover room lifecycle without leaking tokens or nicknames', () => {
  let now = 0; const events: ServerEvent[] = [];
  const store = new Rooms([track()], () => now, event => events.push(event));
  const host = store.create('NickAlpha', '203.0.113.7');
  const room = store.get(host.code);
  const guest = store.add(room, 'NickBeta');
  const closeHost = store.connect(room.code, host.token, () => {}, () => {});
  closeHost();
  const closeGuest = store.connect(room.code, guest.token, () => {}, () => {});
  store.leave(room.code, host.token);          // 房主退出 → 立即转移给在线成员
  closeGuest();
  now = 70_000; store.tick();                  // 成员离线满 60 秒 → 清理
  now += 300_000; store.tick();                // 无人在线满 5 分钟 → 房间过期删除

  const names = events.map(event => event.event);
  for (const expected of ['room.created', 'member.joined', 'member.online', 'member.offline', 'member.left', 'host.transferred', 'member.removed', 'room.deleted']) {
    assert.ok(names.includes(expected), `缺少排障事件 ${expected}`);
  }
  const transfer = events.find(event => event.event === 'host.transferred')!;
  assert.equal(transfer.from, host.memberId);
  assert.equal(transfer.to, guest.memberId);
  assert.equal(events.find(event => event.event === 'room.deleted')!.reason, 'empty-timeout');
  const serialized = JSON.stringify(events);
  for (const secret of [host.token, guest.token, 'NickAlpha', 'NickBeta']) assert.ok(!serialized.includes(secret), '事件日志泄漏了令牌或昵称');
  assert.doesNotMatch(serialized, /token|authorization|bearer/i);
});

test('health keeps ok:true and exposes room, member and connection counters', async t => {
  const { app } = await buildApp([track()], { timers: false });
  const sockets: WebSocket[] = [];
  t.after(async () => { sockets.forEach(ws => ws.terminate()); await app.close(); });
  const empty = await health(app);
  assert.deepEqual(empty, { ok: true, rooms: 0, onlineMembers: 0, wsConnections: 0 });
  const host = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: 'health' } })).json();
  const created = await health(app);
  assert.equal(created.ok, true);
  assert.equal(created.rooms, 1);
  assert.equal(created.onlineMembers, 0);      // 建房只写 HTTP，成员还没建立 WS
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const ws = new WebSocket(address.replace('http', 'ws') + '/ws/' + host.code, { headers: { authorization: 'Bearer ' + host.token } });
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await until(async () => (await health(app)).wsConnections === 1);
  const online = await health(app);
  assert.equal(online.onlineMembers, 1);
  await new Promise<void>(resolve => { ws.once('close', () => resolve()); ws.close(); });
  await until(async () => (await health(app)).wsConnections === 0);
  assert.equal((await health(app)).onlineMembers, 0);
});
