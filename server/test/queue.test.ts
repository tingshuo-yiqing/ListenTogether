import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { Rooms, QUEUE_LIMIT, MEMBER_QUEUE_LIMIT } from '../src/rooms/store.js';
import type { Track } from '../src/library/catalog.js';

const track = (id: string, durationMs = 10000): Track => ({ id, title: `曲${id}`, durationMs, path: '', size: 10, artist: id === 'one' ? '歌手甲' : null, cover: null, coverVer: null, lyricsPath: null, lyricsVer: null, album: null });

function setup(ids: string[], now = () => 1000) {
  const store = new Rooms(ids.map(id => track(id)), now);
  const host = store.create('房主');
  const room = store.get(host.code);
  const hostMember = room.members.find(m => m.token === host.token)!;
  return { store, host, room, hostMember };
}

test('并发点歌同曲：首人成功、后人 409 TRACK_ALREADY_QUEUED；当前曲同曲同样拒绝', () => {
  const { store, room, hostMember } = setup(['one', 'two']);
  const guest = store.add(room, '客人');
  const guestMember = room.members.find(m => m.token === guest.token)!;
  const first = store.queueAdd(room, hostMember, 'one'); // 首曲提升当前曲
  assert.equal(first.promoted, true);
  assert.throws(() => store.queueAdd(room, guestMember, 'one'), (e: { code?: string }) => e.code === 'TRACK_ALREADY_QUEUED');
  const second = store.queueAdd(room, guestMember, 'two');
  assert.equal(second.promoted, false);
  assert.throws(() => store.queueAdd(room, hostMember, 'two'), (e: { code?: string }) => e.code === 'TRACK_ALREADY_QUEUED');
  // 当前曲播完后允许再次点
  store.skipNext(room, hostMember); store.skipNext(room, hostMember);
  assert.equal(room.currentEntry, null);
  assert.doesNotThrow(() => store.queueAdd(room, hostMember, 'one'));
});

test('随机加歌：空房加 5 首时 1 首成为暂停的当前曲、其余待播；候选不足部分成功；重试返回同批', () => {
  const { store, room, hostMember } = setup(Array.from({ length: 7 }, (_, i) => `t${i}`));
  const first = store.queueAddRandom(room, hostMember, 5);
  assert.equal(first.addedCount, 5);
  assert.equal(first.promoted, true);
  assert.ok(room.currentEntry);
  assert.equal(room.playing, false, '随机加入不自动播放');
  assert.equal(room.queue.length, 4);
  // 重试同 requestId 返回同一批结果由 WS 层去重保证（见下方 WS 用例）；领域层直接调用视为新操作。
  // 候选只剩 2 首（当前 1 + 待播 4），加 5 → 部分成功 2
  const second = store.queueAddRandom(room, hostMember, 5);
  assert.equal(second.addedCount, 2);
  // 候选耗尽 → 明确原因
  assert.throws(() => store.queueAddRandom(room, hostMember, 1), (e: { code?: string }) => e.code === 'NO_RANDOM_CANDIDATES');
});

test('个人配额：普通成员 10 秒内最多 5 首待播，当前曲不计配额；房主不受限；降为普通成员后只禁添加', () => {
  const { store, room, hostMember } = setup(Array.from({ length: 12 }, (_, i) => `t${i}`));
  const guest = store.add(room, '客人');
  const guestMember = room.members.find(m => m.token === guest.token)!;
  // 房主先点首曲成为当前曲，客人的点歌全部进待播队列（配额只数待播）。
  store.queueAdd(room, hostMember, 't0');
  for (let i = 1; i <= MEMBER_QUEUE_LIMIT; i++) store.queueAdd(room, guestMember, `t${i}`);
  assert.equal(room.queue.length, MEMBER_QUEUE_LIMIT);
  assert.throws(() => store.queueAdd(room, guestMember, 't6'), (e: { code?: string }) => e.code === 'MEMBER_QUEUE_LIMIT');
  // 播放掉一首待播（跳过 seed，guest 的 t1 成为当前曲，不再计入个人待播），腾出配额
  store.skipNext(room, hostMember);
  assert.equal(room.queue.filter(e => e.requestedBy === guestMember.id).length, MEMBER_QUEUE_LIMIT - 1);
  store.queueAdd(room, guestMember, 't7');
  assert.throws(() => store.queueAdd(room, guestMember, 't8'), (e: { code?: string }) => e.code === 'MEMBER_QUEUE_LIMIT');
  // 房主不受个人上限（13 首中入队 12：1 当前 + 11 待播，剩 1 个候选）
  const { store: store2, room: room2, hostMember: host2 } = setup(Array.from({ length: 13 }, (_, i) => `t${i}`));
  for (let i = 0; i < 12; i++) store2.queueAdd(room2, host2, `t${i}`);
  assert.equal(room2.queue.length, 11);
  assert.ok(room2.currentEntry);
  // 房主降为普通成员（hostId 转移语义）：已有点歌保留，超过个人上限期间只禁止继续添加
  const g2 = store2.add(room2, '新客'); const g2Member = room2.members.find(m => m.token === g2.token)!;
  room2.hostId = g2Member.id;
  assert.throws(() => store2.queueAdd(room2, host2, 't12'), (e: { code?: string }) => e.code === 'MEMBER_QUEUE_LIMIT');
  assert.equal(room2.queue.length, 11, '降级不删已有点歌');
  store2.queueRemove(room2, host2, room2.queue[0].entryId); // 仍可撤回自己的
  assert.equal(room2.queue.length, 10);
});

test('队列容量 100：满后 409 QUEUE_FULL', () => {
  const tracks = Array.from({ length: QUEUE_LIMIT + 2 }, (_, i) => track(`t${String(i).padStart(3, '0')}`));
  const store = new Rooms(tracks, () => 1000);
  const host = store.create('房主');
  const room = store.get(host.code);
  const hostMember = room.members.find(m => m.token === host.token)!;
  for (let i = 0; i <= QUEUE_LIMIT; i++) store.queueAdd(room, hostMember, `t${String(i).padStart(3, '0')}`);
  assert.equal(room.queue.length, QUEUE_LIMIT); // 首曲成为当前曲 + 100 待播
  assert.throws(() => store.queueAdd(room, hostMember, 't101'), (e: { code?: string }) => e.code === 'QUEUE_FULL');
});

test('去重：过期 409 REQUEST_EXPIRED、同 ID 异参 409 IDEMPOTENCY_CONFLICT、超前 400、业务失败同样入缓存', () => {
  let now = 1000;
  const { store, room, hostMember } = setup(['one'], () => now);
  // 业务失败（队列满）也是确定性结果：同 ID 重试返回同一失败
  const fp = JSON.stringify(['queue.add', 1000, { trackId: 'one' }]);
  const ticket = store.dedupe.begin(room.code, hostMember.id, 'req-1', 1000, fp);
  assert.equal(ticket.replay, null);
  ticket.commit({ ok: false, status: 409, message: '该歌曲已在当前播放或待播队列中', code: 'TRACK_ALREADY_QUEUED' });
  const replay = store.dedupe.begin(room.code, hostMember.id, 'req-1', 1000, fp);
  assert.equal(replay.replay?.outcome.ok, false);
  // 同 ID 异参
  assert.throws(() => store.dedupe.begin(room.code, hostMember.id, 'req-1', 1000, JSON.stringify(['queue.add', 1000, { trackId: 'other' }])),
    (e: { code?: string }) => e.code === 'IDEMPOTENCY_CONFLICT');
  // 过期（10 分钟后）：不重新执行
  now += 10 * 60_000 + 1;
  assert.throws(() => store.dedupe.begin(room.code, hostMember.id, 'req-2', 1000, fp), (e: { code?: string }) => e.code === 'REQUEST_EXPIRED');
  // 超前 30 秒以上拒绝（时基已前进，用更新后的 now 计算）
  assert.throws(() => store.dedupe.begin(room.code, hostMember.id, 'req-3', now + 31_000, 'fp3'), (e: { statusCode?: number }) => e.statusCode === 400);
  // 服务端时间回拨：过期记录不复活（不倒退时基）
  const clock = { value: 180_000 };
  const store2 = new Rooms([track('one')], () => clock.value);
  const h2 = store2.create('h'); const r2 = store2.get(h2.code); const m2 = r2.members.find(x => x.token === h2.token)!;
  const t1 = store2.dedupe.begin(r2.code, m2.id, 'x', 180_000, 'fp1');
  t1.commit({ ok: true, result: {} });
  clock.value = 180_000 + 10 * 60_000 + 1; // 记录过期
  assert.throws(() => store2.dedupe.begin(r2.code, m2.id, 'x', 180_000, 'fp1'), (e: { code?: string }) => e.code === 'REQUEST_EXPIRED');
  clock.value = 180_000; // 时钟回拨：单调时基仍判过期，绝不重新执行
  assert.throws(() => store2.dedupe.begin(r2.code, m2.id, 'x', 180_000, 'fp1'), (e: { code?: string }) => e.code === 'REQUEST_EXPIRED');
});

test('权限与重排：成员只能撤回自己的点歌；重排仅房主；版本冲突回 QUEUE_VERSION_CONFLICT；锚点重排生效', () => {
  const { store, room, hostMember } = setup(['one', 'two', 'three', 'four']);
  const guest = store.add(room, '客人');
  const guestMember = room.members.find(m => m.token === guest.token)!;
  store.queueAdd(room, hostMember, 'four'); // 房主 seed 占当前曲，其余点歌全进待播
  const a = store.queueAdd(room, guestMember, 'one');
  const b = store.queueAdd(room, hostMember, 'two');
  const c = store.queueAdd(room, guestMember, 'three');
  // 成员撤回别人的 → 403；撤回自己的 → ok
  assert.throws(() => store.queueRemove(room, guestMember, b.entryId), /只能撤回自己的点歌/);
  store.queueRemove(room, guestMember, a.entryId);
  assert.deepEqual(room.queue.map(e => e.entryId), [b.entryId, c.entryId]);
  // 重排权限：成员 → 403
  assert.throws(() => store.queueMove(room, guestMember, c.entryId, null, room.queueVersion), /只有房主/);
  // 版本冲突
  const stale = room.queueVersion;
  store.queueAdd(room, guestMember, 'one');
  assert.throws(() => store.queueMove(room, hostMember, c.entryId, null, stale), (e: { code?: string }) => e.code === 'QUEUE_VERSION_CONFLICT');
  // 正确重排：three 移到队尾；two 移到 three 之前（即队尾）
  store.queueMove(room, hostMember, c.entryId, null, room.queueVersion);
  assert.deepEqual(room.queue.map(e => e.trackId), ['two', 'one', 'three']);
  store.queueMove(room, hostMember, b.entryId, c.entryId, room.queueVersion);
  assert.deepEqual(room.queue.map(e => e.trackId), ['one', 'two', 'three']);
  // 锚点不存在 → 404
  assert.throws(() => store.queueMove(room, hostMember, c.entryId, 'nope', room.queueVersion), /锚点/);
});

test('曲终与跳过：跳过保留原 playing；无待播跳过清空并停止；无当前曲 skip/play → NO_CURRENT_TRACK', () => {
  const { store, room, hostMember } = setup(['one', 'two']);
  store.queueAdd(room, hostMember, 'one');
  store.command(room.code, hostMember.token, { action: 'pause' });
  store.queueAdd(room, hostMember, 'two');
  // 暂停中跳过：换曲但保持暂停、positionMs=0
  store.skipNext(room, hostMember);
  assert.equal(room.currentEntry?.trackId, 'two');
  assert.equal(room.playing, false);
  assert.equal(room.positionMs, 0);
  // 最后一首跳过：当前曲与待播清空、playing=false
  store.skipNext(room, hostMember);
  assert.equal(room.currentEntry, null);
  assert.equal(room.queue.length, 0);
  assert.equal(room.playing, false);
  assert.throws(() => store.skipNext(room, hostMember), (e: { code?: string }) => e.code === 'NO_CURRENT_TRACK');
  assert.throws(() => store.command(room.code, hostMember.token, { action: 'play' }), (e: { code?: string }) => e.code === 'NO_CURRENT_TRACK');
});

test('房主变化与离房：点歌人离房保留已点歌曲；房主转移不清队列', () => {
  const { store, room, hostMember } = setup(['one', 'two', 'seed']);
  const guest = store.add(room, '客人');
  const guestMember = room.members.find(m => m.token === guest.token)!;
  // 房主的 seed 占住当前曲，guest 的两首进待播
  store.queueAdd(room, hostMember, 'seed');
  store.queueAdd(room, guestMember, 'one');
  store.queueAdd(room, guestMember, 'two');
  store.leave(room.code, guest.token); // 点歌人离房：队列保留
  assert.equal(room.queue.length, 2);
  assert.equal(room.queue.every(e => e.requestedBy === guestMember.id), true);
  store.leave(room.code, hostMember.token); // 房主退出转移（无人在线则空缺）
  assert.equal(room.queue.length, 2, '房主变化不清队列');
});

test('快照一致性：queueSnapshot 与实际队列逐条对应，含显示元数据与点歌人；旧连接迟到不污染新连接状态', () => {
  const { store, room, hostMember } = setup(['one', 'two', 'seed']);
  const guest = store.add(room, '客人');
  const guestMember = room.members.find(m => m.token === guest.token)!;
  store.queueAdd(room, hostMember, 'seed'); // 当前曲不在待播快照里
  store.queueAdd(room, guestMember, 'one');
  store.queueAdd(room, hostMember, 'two');
  const snap = store.queueSnapshot(room);
  assert.equal(snap.entries.length, 2);
  assert.deepEqual(snap.entries.map(e => e.trackId), ['one', 'two']);
  assert.equal(snap.entries[0].requestedByName, '客人');
  assert.equal(snap.entries[0].title, '曲one');
  assert.equal(snap.entries[0].artist, '歌手甲');
  assert.equal(JSON.stringify(snap).includes('path'), false, '队列快照不携带磁盘路径');
  // 旧连接迟到：先 connect 再被替换，旧 close 不把成员标记离线
  const oldClose = store.connect(room.code, guest.token, () => {}, () => {});
  const newClose = store.connect(room.code, guest.token, () => {}, () => {});
  oldClose();
  assert.equal(store.snapshot(room).members.find(m => m.id === guestMember.id)?.online, true);
  newClose();
  assert.equal(store.snapshot(room).members.find(m => m.id === guestMember.id)?.online, false);
});

// ---- WS 层：去重回放、426 门禁、队列配额 ----
async function until(predicate: () => boolean) {
  const end = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > end) throw new Error('WebSocket timeout'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test('WS：同 requestId 重试回放同一 ack；点歌 10 秒 5 次限流；缺协议头握手 426', async t => {
  const { app, rooms } = await buildApp(Array.from({ length: 8 }, (_, i) => track(`t${i}`)), { timers: false });
  t.after(async () => app.close());
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const host = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: '房主' }, headers: { 'x-listentogether-protocol': '2' } })).json();
  const V2 = { authorization: 'Bearer ' + host.token, 'x-listentogether-protocol': '2' };

  // 缺协议头 → 426（不进入 WS）
  const noHeader = new WebSocket(address.replace('http', 'ws') + '/ws/' + host.code, { headers: { authorization: V2.authorization } });
  noHeader.on('error', () => {});
  const status = await new Promise<number>(resolve => noHeader.on('unexpected-response', (_req, response) => { resolve(response.statusCode!); response.resume(); noHeader.terminate(); }));
  assert.equal(status, 426);

  const messages: Array<Record<string, unknown>> = [];
  const ws = new WebSocket(address.replace('http', 'ws') + '/ws/' + host.code, { headers: V2 });
  t.after(() => ws.terminate());
  ws.on('message', data => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await until(() => messages.some(m => m.type === 'queue.state'));

  // 第 1 次点歌成功；同 requestId 重试（网络丢确认场景）回放同一 ack，不产生第二条队列项
  const request = { type: 'queue.add', requestId: '7e59c0a2-0000-4000-8000-000000000001', issuedAtMs: Date.now(), trackId: 't0' };
  ws.send(JSON.stringify(request));
  await until(() => messages.some(m => m.type === 'ack' && m.requestId === request.requestId));
  const firstAck = messages.find(m => m.type === 'ack' && m.requestId === request.requestId)!;
  const queueLen = rooms.get(host.code).queue.length + (rooms.get(host.code).currentEntry ? 1 : 0);
  ws.send(JSON.stringify(request));
  await until(() => messages.filter(m => m.type === 'ack' && m.requestId === request.requestId).length >= 2);
  const secondAck = messages.filter(m => m.type === 'ack' && m.requestId === request.requestId)[1];
  assert.deepEqual(secondAck, firstAck);
  assert.equal(rooms.get(host.code).queue.length + (rooms.get(host.code).currentEntry ? 1 : 0), queueLen, '重试不得产生第二条队列项');

  // 连续 6 次队列操作：第 6 次被限流（429 error 帧 + retryAfterMs），不产生 ack
  for (let i = 0; i < 5; i++) ws.send(JSON.stringify({ type: 'queue.addRandom', requestId: `7e59c0a2-0000-4000-8000-00000000001${i}`, issuedAtMs: Date.now(), count: 1 }));
  await until(() => messages.filter(m => m.type === 'ack' && m.ok === true).length >= 5);
  ws.send(JSON.stringify({ type: 'queue.addRandom', requestId: '7e59c0a2-0000-4000-8000-000000000099', issuedAtMs: Date.now(), count: 1 }));
  await until(() => messages.some(m => m.type === 'error' && m.status === 429 && typeof m.retryAfterMs === 'number'));
});
