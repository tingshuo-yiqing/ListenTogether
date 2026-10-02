import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { Rooms } from '../src/rooms/store.js';
import { AVATAR_IDS } from '../src/rooms/avatars.js';
import { buildApp } from '../src/app.js';

function fullRoom() {
  const store = new Rooms([]);
  const host = store.create('同名朋友');
  const room = store.get(host.code);
  for (let i = 1; i < 15; i++) store.add(room, '同名朋友');
  return { store, host, room };
}

test('动物头像：15 人同名满房全部不重复，超员拒绝且不改变已有头像', () => {
  const { store, room } = fullRoom();
  const before = room.members.map(m => m.avatarId);
  assert.equal(new Set(before).size, 15);
  assert.deepEqual([...before].sort(), [...AVATAR_IDS].sort());
  assert.throws(() => store.add(room, '第十六人'), (e: { statusCode?: number }) => e.statusCode === 409);
  assert.deepEqual(room.members.map(m => m.avatarId), before);
});

test('动物头像：断线仍占用、同令牌重连与房主转移保留分配', () => {
  const { store, host, room } = fullRoom();
  const before = store.snapshot(room).members;
  const offline = store.connect(host.code, host.token, () => {}, () => {});
  offline();
  assert.equal(store.snapshot(room).members[0].online, false);
  assert.throws(() => store.add(room, '插队'), (e: { statusCode?: number }) => e.statusCode === 409);
  store.connect(host.code, host.token, () => {}, () => {});
  const guest = room.members[1];
  store.connect(host.code, guest.token, () => {}, () => {});
  store.leave(host.code, host.token);
  assert.equal(room.hostId, guest.id);
  assert.equal(guest.avatarId, before[1].avatarId);
  for (const m of room.members) assert.equal(m.avatarId, before.find(v => v.id === m.id)!.avatarId);
});

test('动物头像：离房释放唯一空槽，历史聊天保持原发送者与头像', () => {
  const { store, room } = fullRoom();
  const leaving = room.members[5];
  const id = leaving.id, avatar = leaving.avatarId;
  store.chatSend(room, leaving, '离开前的消息');
  store.leave(room.code, leaving.token);
  const fresh = store.add(room, '新朋友');
  const newMember = room.members.find(m => m.id === fresh.memberId)!;
  assert.equal(newMember.avatarId, avatar);
  assert.notEqual(newMember.id, id);
  assert.equal(new Set(room.members.map(m => m.avatarId)).size, 15);
  assert.equal(store.chatSnapshot(room).messages[0].senderId, id);
  assert.equal(store.chatSnapshot(room).messages[0].senderAvatarId, avatar);
});

test('动物头像：离线宽限内保留，清扫后释放且其它在线成员不换头像', () => {
  let now = 1000;
  const store = new Rooms([], () => now);
  const host = store.create('房主'), room = store.get(host.code);
  for (let i = 1; i < 15; i++) store.add(room, '朋友');
  const callbacks = room.members.map(m => store.connect(room.code, m.token, () => {}, () => {}));
  const leaving = room.members[4], avatar = leaving.avatarId;
  const kept = room.members.filter(m => m !== leaving).map(m => [m.id, m.avatarId]);
  callbacks[4](); now += 59_999; store.tick();
  assert.equal(room.members.length, 15);
  now += 2; store.tick();
  assert.equal(room.members.length, 14);
  const fresh = store.add(room, '回来');
  assert.equal(room.members.find(m => m.id === fresh.memberId)!.avatarId, avatar);
  for (const [id, previous] of kept) assert.equal(room.members.find(m => m.id === id)!.avatarId, previous);
});

test('动物头像：分配按房间隔离，每房均可独立容纳 15 种头像', () => {
  const { store, room } = fullRoom();
  const other = store.get(store.create('另一房主').code);
  for (let i = 1; i < 15; i++) store.add(other, '另一朋友');
  assert.equal(new Set(other.members.map(m => m.avatarId)).size, 15);
  assert.deepEqual([...room.members.map(m => m.avatarId)].sort(), [...other.members.map(m => m.avatarId)].sort());
});

test('动物头像契约：协议枚举、安卓资源映射与 15 个图片文件一致', async () => {
  const md = await readFile(new URL('../../docs/protocol.md', import.meta.url), 'utf8');
  const schema = JSON.parse(md.split('## JSON Schema')[1].split('```json')[1].split('```')[0]);
  assert.deepEqual(schema.$defs.avatarId.enum, [...AVATAR_IDS]);
  const android = new URL('../../android/app/src/main/', import.meta.url);
  const mapping = await readFile(new URL('java/com/listentogether/app/ui/AnimalAvatars.kt', android), 'utf8');
  const mapped = [...mapping.matchAll(/"([a-z_]+)" -> R\.drawable\.avatar_([a-z_]+)/g)];
  assert.deepEqual(mapped.map(m => m[1]).sort(), [...AVATAR_IDS].sort());
  for (const m of mapped) assert.equal(m[1], m[2]);
  const assets = (await readdir(new URL('res/drawable-nodpi/', android))).filter(f => f.startsWith('avatar_')).sort();
  assert.deepEqual(assets, AVATAR_IDS.map(id => `avatar_${id}.webp`).sort());
});

test('动物头像真实 WS：两名成员看到相同分配，聊天广播及恢复携带发送时头像', async t => {
  const { app, rooms } = await buildApp([], { timers: false });
  const sockets: WebSocket[] = [];
  t.after(async () => { sockets.forEach(ws => ws.terminate()); await app.close(); });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const v2 = { 'x-listentogether-protocol': '2' };
  const host = (await app.inject({ method: 'POST', url: '/api/rooms', headers: v2, payload: { nickname: '房主' } })).json();
  const guest = (await app.inject({ method: 'POST', url: `/api/rooms/${host.code}/join`, headers: v2, payload: { nickname: '朋友' } })).json();
  const seen: any[][] = [[], []];
  for (const [index, credential] of [host, guest].entries()) {
    const socket = new WebSocket(address.replace('http', 'ws') + '/ws/' + host.code,
      { headers: { ...v2, authorization: 'Bearer ' + credential.token } });
    sockets.push(socket);
    socket.on('message', data => seen[index].push(JSON.parse(data.toString())));
  }
  const waitFor = async (predicate: () => boolean) => {
    const end = Date.now() + 5000;
    while (!predicate()) { if (Date.now() > end) throw new Error('头像 WS 等待超时'); await new Promise(r => setTimeout(r, 10)); }
  };
  await waitFor(() => seen.every(messages => messages.some(m => m.type === 'state' && m.members.every((v: any) => v.online))));
  const states = seen.map(messages => messages.filter(m => m.type === 'state').at(-1));
  assert.deepEqual(states[0].members, states[1].members);
  assert.equal(new Set(states[0].members.map((m: any) => m.avatarId)).size, 2);
  const avatar = rooms.get(host.code).members.find(m => m.id === guest.memberId)!.avatarId;
  sockets[1].send(JSON.stringify({ type: 'chat.send', clientMessageId: randomUUID(), issuedAtMs: Date.now(), text: '你好' }));
  await waitFor(() => seen.every(messages => messages.some(m => m.type === 'chat.message')));
  for (const messages of seen) assert.equal(messages.find(m => m.type === 'chat.message').message.senderAvatarId, avatar);
  seen[0].length = 0;
  sockets[0].send(JSON.stringify({ type: 'chat.sync', lastSeq: 0 }));
  await waitFor(() => seen[0].some(m => m.type === 'chat.snapshot' && m.messages.length === 1));
  assert.equal(seen[0].find(m => m.type === 'chat.snapshot').messages[0].senderAvatarId, avatar);
});
