import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { Rooms, CHAT_HISTORY_LIMIT, CHAT_TEXT_MAX_CODEPOINTS } from '../src/rooms/store.js';
import type { Track } from '../src/library/catalog.js';

const track = (id: string): Track => ({ id, title: `曲${id}`, durationMs: 10000, path: '', size: 10, artist: null, cover: null, coverVer: null, lyricsPath: null, lyricsVer: null, album: null });

test('聊天领域：中文/emoji/换行通过；空白与超长拒绝；发送者取认证成员（不可伪造）；窗口截断与 gap', () => {
  let now = 1000;
  const store = new Rooms([track('one')], () => now);
  const host = store.create('房主');
  const room = store.get(host.code);
  const member = room.members.find(m => m.token === host.token)!;

  const ok = store.chatSend(room, member, '大家好 🎵\n第二行');
  assert.equal(ok.seq, 1);
  assert.equal(room.chat[0].senderName, '房主');
  assert.equal(room.chat[0].text, '大家好 🎵\n第二行');

  assert.throws(() => store.chatSend(room, member, '   '), (e: { statusCode?: number }) => e.statusCode === 400);
  assert.throws(() => store.chatSend(room, member, '好'.repeat(CHAT_TEXT_MAX_CODEPOINTS + 1)), (e: { statusCode?: number }) => e.statusCode === 400);
  // 500 码点的 4 字节 emoji = 2000 字节：码点未超、字节仍在界内，应通过（契约 500 码点 + 2048 字节双限）
  assert.doesNotThrow(() => store.chatSend(room, member, '🎵'.repeat(500)));

  // 窗口截断：超过 100 条后最旧侧移出，oldestSeq 相应前移
  for (let i = 0; i < CHAT_HISTORY_LIMIT + 3; i++) store.chatSend(room, member, `m${i}`);
  assert.equal(room.chat.length, CHAT_HISTORY_LIMIT);
  const snap = store.chatSnapshot(room);
  assert.equal(snap.messages.length, CHAT_HISTORY_LIMIT);
  assert.equal(snap.oldestSeq, room.chatSeq - CHAT_HISTORY_LIMIT + 1);
  assert.equal(snap.gap, false);
  // lastSeq 落后于窗口最旧 → 缺口不可恢复
  assert.equal(store.chatSnapshot(room, snap.oldestSeq! - 2).gap, true);
  assert.equal(store.chatSnapshot(room, snap.oldestSeq! - 1).gap, false);
  assert.equal(store.chatSnapshot(room, room.chatSeq).gap, false);
});

test('WS 聊天：隔房广播隔离、独立限频 10 秒 5 条、同 clientMessageId 重试回放同一 ack 不重发', async t => {
  const { app, rooms } = await buildApp([track('one')], { timers: false });
  t.after(async () => app.close());
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const V2 = { authorization: '', 'x-listentogether-protocol': '2' };

  // 隔离：两个房间各自的 WS
  const roomA = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: 'A' }, headers: { 'x-listentogether-protocol': '2' } })).json();
  const roomB = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: 'B' }, headers: { 'x-listentogether-protocol': '2' } })).json();
  const collectA: any[] = [], collectB: any[] = [];
  const wsA = new WebSocket(address.replace('http', 'ws') + '/ws/' + roomA.code, { headers: { ...V2, authorization: 'Bearer ' + roomA.token } });
  const wsB = new WebSocket(address.replace('http', 'ws') + '/ws/' + roomB.code, { headers: { ...V2, authorization: 'Bearer ' + roomB.token } });
  t.after(() => { wsA.terminate(); wsB.terminate(); });
  wsA.on('message', d => collectA.push(JSON.parse(d.toString())));
  wsB.on('message', d => collectB.push(JSON.parse(d.toString())));
  await Promise.all([wsA, wsB].map(ws => new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); })));
  await Promise.all([wsA, wsB].map(async ws => {
    const end = Date.now() + 3000;
    while (Date.now() < end) { if (collectA.some(m => m.type === 'chat.snapshot') && collectB.some(m => m.type === 'chat.snapshot')) return; await new Promise(r => setTimeout(r, 10)); }
  }));

  const clientMessageId = '7e59c0a2-0000-4000-8000-0000000000c1';
  const issuedAtMs = Date.now(); // 重试必须保留原 ID、时间与输入（协议「操作去重」）
  wsA.send(JSON.stringify({ type: 'chat.send', clientMessageId, issuedAtMs, text: 'A 房的话' }));
  await new Promise<void>(resolve => { const end = Date.now() + 3000; (function wait() { if (collectA.some(m => m.type === 'chat.message')) return resolve(); if (Date.now() > end) throw new Error('timeout'); setTimeout(wait, 10); })(); });
  // B 房收不到 A 房消息
  assert.equal(collectB.some(m => m.type === 'chat.message'), false);
  const chatMessage = collectA.find(m => m.type === 'chat.message');
  assert.equal(chatMessage.message.text, 'A 房的话');
  assert.equal(chatMessage.message.senderName, 'A'); // 身份来自认证成员

  // 确认丢失重试：同 clientMessageId 回放同一 ack，消息不重发
  const before = rooms.get(roomA.code).chat.length;
  wsA.send(JSON.stringify({ type: 'chat.send', clientMessageId, issuedAtMs, text: 'A 房的话' }));
  await new Promise<void>(resolve => { const end = Date.now() + 3000; (function wait() { if (collectA.filter(m => m.type === 'ack' && m.clientMessageId === clientMessageId).length >= 2) return resolve(); if (Date.now() > end) throw new Error('timeout'); setTimeout(wait, 10); })(); });
  assert.equal(rooms.get(roomA.code).chat.length, before, '重试不得产生第二条消息');
  const acks = collectA.filter(m => m.type === 'ack' && m.clientMessageId === clientMessageId);
  assert.deepEqual(acks[0], acks[1]);

  // 独立限频：聊天 10 秒 5 条，第 6 条 429；队列操作不受聊天限频影响
  for (let i = 0; i < 4; i++) wsA.send(JSON.stringify({ type: 'chat.send', clientMessageId: `7e59c0a2-0000-4000-8000-0000000000d${i}`, issuedAtMs: Date.now(), text: `刷屏${i}` }));
  await new Promise<void>(resolve => { const end = Date.now() + 3000; (function wait() { if (rooms.get(roomA.code).chat.length >= before + 4) return resolve(); if (Date.now() > end) throw new Error('timeout'); setTimeout(wait, 10); })(); });
  wsA.send(JSON.stringify({ type: 'chat.send', clientMessageId: '7e59c0a2-0000-4000-8000-0000000000e0', issuedAtMs: Date.now(), text: '第 6 条' }));
  await new Promise<void>(resolve => { const end = Date.now() + 3000; (function wait() { if (collectA.some(m => m.type === 'error' && m.status === 429)) return resolve(); if (Date.now() > end) throw new Error('timeout'); setTimeout(wait, 10); })(); });
  const error429 = collectA.find(m => m.type === 'error' && m.status === 429);
  assert.equal(typeof error429.retryAfterMs, 'number');
  wsA.send(JSON.stringify({ type: 'queue.add', requestId: '7e59c0a2-0000-4000-8000-0000000000e1', issuedAtMs: Date.now(), trackId: 'one' }));
  await new Promise<void>(resolve => { const end = Date.now() + 3000; (function wait() { if (collectA.some(m => m.type === 'ack' && m.requestId === '7e59c0a2-0000-4000-8000-0000000000e1')) return resolve(); if (Date.now() > end) throw new Error('timeout'); setTimeout(wait, 10); })(); });
  assert.ok(collectA.some(m => m.type === 'ack' && m.requestId === '7e59c0a2-0000-4000-8000-0000000000e1' && m.ok === true), '聊天限频不得影响队列操作');
});

test('聊天快照分块：>32KiB 窗口按块发送且 latestSeq 一致、收齐可拼回', async t => {
  const { app, rooms } = await buildApp([track('one')], { timers: false });
  t.after(async () => app.close());
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const host = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: '房主' }, headers: { 'x-listentogether-protocol': '2' } })).json();
  // 直接灌满窗口的长消息（每条 ~600 字符），使快照超 32KiB
  const room = rooms.get(host.code);
  const member = room.members.find((m: { token: string }) => m.token === host.token);
  for (let i = 0; i < 100; i++) rooms.chatSend(room, member, '很长的消息'.repeat(80) + i);
  const received: any[] = [];
  const ws = new WebSocket(address.replace('http', 'ws') + '/ws/' + host.code, { headers: { authorization: 'Bearer ' + host.token, 'x-listentogether-protocol': '2' } });
  t.after(() => ws.terminate());
  ws.on('message', d => received.push(JSON.parse(d.toString())));
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const end = Date.now() + 3000;
  // 等收齐整份快照（所有块拼回 ≥100 条）再断言，不能只等第一块。
  while (Date.now() < end) {
    if (received.filter(m => m.type === 'chat.snapshot').flatMap(m => m.messages).length >= 100) break;
    await new Promise(r => setTimeout(r, 10));
  }
  const connect = received.filter(m => m.type === 'chat.snapshot');
  assert.ok(connect.length > 1, `长窗口必须分块（实收 ${connect.length} 块）`);
  assert.equal(new Set(connect.map(m => m.snapshotId)).size, 1, '同一快照同一 snapshotId');
  assert.equal(new Set(connect.map(m => m.latestSeq)).size, 1);
  const joined = connect.flatMap(m => m.messages);
  assert.equal(joined.length, 100, '收齐后拼回完整窗口');
  assert.equal(connect[0].chunkIndex, 0);
  assert.equal(connect[connect.length - 1].chunkIndex, connect.length - 1);

  // chat.sync 再取一次完整窗口（每块仍 ≤32KiB）
  ws.send(JSON.stringify({ type: 'chat.sync' }));
  const end2 = Date.now() + 3000;
  while (Date.now() < end2) { if (received.filter(m => m.type === 'chat.snapshot').length >= connect.length + 1) break; await new Promise(r => setTimeout(r, 10)); }
  const connectId = connect[0].snapshotId;
  const syncChunks = received.filter(m => m.type === 'chat.snapshot' && m.snapshotId !== connectId);
  assert.ok(syncChunks.length >= 1);
  assert.equal(new Set(syncChunks.map(m => m.snapshotId)).size, 1);
  assert.equal(syncChunks.flatMap((m: { messages: unknown[] }) => m.messages).length, 100);
});
