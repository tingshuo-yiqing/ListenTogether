import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { Rooms } from '../src/rooms/store.js';
import type { Track } from '../src/library/catalog.js';
const track = (id = 'one', durationMs = 10000): Track => ({ id, title: id, durationMs, path: '', size: 10 });
test('room state: authorization, pause, seek, auto advance, replay', () => {
  let now = 1000; const store = new Rooms([track(), track('two')], () => now);
  const host = store.create('房主'); const room = store.get(host.code);
  const guest = store.add(room, '好友');
  assert.throws(() => store.auth(room.code, 'bad'), /令牌/);
  assert.throws(() => store.command(room.code, guest.token, { action: 'play' }), /房主/);
  store.command(room.code, host.token, { action: 'play' });
  now += 2000; assert.equal(store.position(room), 2000);
  store.command(room.code, host.token, { action: 'pause' });
  now += 2000; assert.equal(store.position(room), 2000);
  assert.throws(() => store.command(room.code, host.token, { action: 'seek', positionMs: -1 }), /进度/);
  assert.throws(() => store.command(room.code, host.token, { action: 'select', trackId: 'missing' }), /不存在/);
  store.command(room.code, host.token, { action: 'seek', positionMs: 10000 });
  store.command(room.code, host.token, { action: 'play' });
  assert.equal(room.positionMs, 0);
  now += 10000; store.tick(); assert.equal(room.trackId, 'two'); assert.equal(room.playing, true);
  now += 10000; store.tick(); assert.equal(room.playing, false); assert.equal(room.positionMs, 10000);
});
test('host grace period, reconnect replacement, transfer, capacity cleanup and room expiry', () => {
  let now = 0; const store = new Rooms([track()], () => now);
  const host = store.create('host'); const room = store.get(host.code);
  const guest = store.add(room, 'guest');
  const closeOld = store.connect(room.code, host.token, () => {}, () => {});
  const closeNew = store.connect(room.code, host.token, () => {}, () => {});
  closeOld(); assert.equal(store.snapshot(room).members[0].online, true);
  const closeGuest = store.connect(room.code, guest.token, () => {}, () => {});
  closeNew(); now = 59999; store.tick(); assert.equal(room.hostId, host.memberId);
  now = 60000; store.tick(); assert.equal(room.hostId, guest.memberId);
  assert.throws(() => store.auth(room.code, host.token), /令牌/);
  closeGuest(); store.tick(); now += 300000; store.tick();
  assert.throws(() => store.get(room.code), /过期/);
});
test('explicit host leave transfers immediately; empty catalog and invalid nickname', () => {
  const store = new Rooms([]); assert.throws(() => store.create(' '), /昵称/);
  const host = store.create('host'), room = store.get(host.code), guest = store.add(room, 'guest');
  store.connect(room.code, guest.token, () => {}, () => {});
  assert.throws(() => store.command(room.code, host.token, { action: 'play' }), /曲库为空/);
  store.leave(room.code, host.token); assert.equal(room.hostId, guest.memberId);
});
test('HTTP: private catalog, byte ranges, missing file, bad JSON and rate limiting', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'listen-test-'));
  const path = join(directory, 'one.mp3'); await writeFile(path, Buffer.from('0123456789'));
  const { app } = await buildApp([{ ...track(), path }], { timers: false });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const host = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: 'test' } })).json();
  const headers = { authorization: 'Bearer ' + host.token };
  const url = '/api/rooms/' + host.code + '/audio/one';
  assert.equal((await app.inject('/health')).statusCode, 200);
  assert.equal((await app.inject('/api/rooms/' + host.code + '/catalog')).statusCode, 401);
  const catalog = (await app.inject({ url: '/api/rooms/' + host.code + '/catalog', headers })).json();
  assert.equal(catalog[0].path, undefined);
  const partial = await app.inject({ url, headers: { ...headers, range: 'bytes=2-5' } });
  assert.equal(partial.statusCode, 206); assert.equal(partial.body, '2345');
  assert.equal(partial.headers['content-range'], 'bytes 2-5/10');
  assert.equal((await app.inject({ url, headers: { ...headers, range: 'bytes=-3' } })).body, '789');
  assert.equal((await app.inject({ url, headers: { ...headers, range: 'bytes=8-' } })).body, '89');
  assert.equal((await app.inject({ url, headers })).body, '0123456789');
  for (const range of ['bytes=10-', 'bytes=-0', 'bytes=4-2', 'bytes=0-1,4-5', 'nonsense']) {
    assert.equal((await app.inject({ url, headers: { ...headers, range } })).statusCode, 416);
  }
  await rm(path);
  assert.equal((await app.inject({ url, headers })).statusCode, 404);
  const invalid = await app.inject({ method: 'POST', url: '/api/rooms', headers: { 'content-type': 'application/json' }, payload: '{' });
  assert.equal(invalid.statusCode, 400);
  let status = 0;
  for (let i = 0; i < 35; i++) status = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: 'limit' } })).statusCode;
  assert.equal(status, 429);
});
async function until(predicate: () => boolean) {
  const end = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > end) throw new Error('WebSocket timeout'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
test('15 real WebSockets: broadcast, clock sync, forbidden command, malformed message and 16th rejection', async t => {
  const { app } = await buildApp([track()]);
  const clients: WebSocket[] = [], messages: any[][] = [];
  t.after(async () => { clients.forEach(c => c.terminate()); await app.close(); });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const host = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: 'host' } })).json();
  const credentials = [host];
  for (let i = 1; i < 15; i++) credentials.push((await app.inject({ method: 'POST', url: '/api/rooms/' + host.code + '/join', payload: { nickname: 'guest' + i } })).json());
  for (const [i, credential] of credentials.entries()) {
    messages[i] = [];
    const ws = new WebSocket(address.replace('http', 'ws') + '/ws/' + host.code, { headers: { authorization: 'Bearer ' + credential.token } });
    clients.push(ws); ws.on('message', data => messages[i].push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  }
  const full = await app.inject({ method: 'POST', url: '/api/rooms/' + host.code + '/join', payload: { nickname: 'sixteen' } });
  assert.equal(full.statusCode, 409);
  clients[0].send(JSON.stringify({ type: 'command', action: 'play' }));
  await until(() => messages.every(list => list.some(m => m.type === 'state' && m.playing)));
  clients[1].send(JSON.stringify({ type: 'command', action: 'pause' }));
  await until(() => messages[1].some(m => m.status === 403));
  clients[2].send('{');
  await until(() => messages[2].some(m => m.status === 400));
  clients[14].send(JSON.stringify({ type: 'sync', clientTimeMs: 123 }));
  await until(() => messages[14].some(m => m.type === 'clock' && m.clientTimeMs === 123));
  assert.ok(messages[14].some(m => m.type === 'state' && m.members.length === 15));
  const unauthenticated = new WebSocket(address.replace('http', 'ws') + '/ws/' + host.code);
  unauthenticated.on('error', () => {});
  const status = await new Promise<number>(resolve => unauthenticated.on('unexpected-response', (_req, response) => { resolve(response.statusCode!); response.resume(); unauthenticated.terminate(); }));
  assert.equal(status, 401);
});
