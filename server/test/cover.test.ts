import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { CoverCache } from '../src/library/cover-cache.js';
import type { Track } from '../src/library/catalog.js';

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x01, 0x02]); // JPEG 魔数 + 载荷
const PNG_A = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
const PNG_B = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 3, 4]);
const PNG_C = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 5, 6]);

function track(id: string, overrides: Partial<Track> = {}): Track {
  return { id, title: id, durationMs: 10000, path: '', size: 100, artist: null, cover: null, coverVer: null, lyricsPath: null, lyricsVer: null, album: null, ...overrides };
}

test('cover: authentication, missing track/cover, on-demand bytes and missing file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'listen-cover-'));
  const coverPath = join(directory, 'one.jpg'); await writeFile(coverPath, JPEG_BYTES);
  const audioPath = join(directory, 'one.mp3'); await writeFile(audioPath, Buffer.from('0123456789'));
  const tracks: Track[] = [
    track('with-cover', { path: audioPath, cover: { mime: 'image/jpeg', file: coverPath, embedded: false }, coverVer: 12345 }),
    track('without-cover', { path: audioPath }),
    track('without-path'),
    track('gone-file', { path: audioPath, cover: { mime: 'image/jpeg', file: join(directory, 'gone.jpg'), embedded: false }, coverVer: 1 })
  ];
  const { app, rooms } = await buildApp(tracks, { timers: false });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const host = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: 'host' }, headers: { 'x-listentogether-protocol': '2' } })).json();
  const headers = { authorization: 'Bearer ' + host.token };
  const base = '/api/rooms/' + host.code;
  // ① 鉴权：未带 token 直接 401。
  assert.equal((await app.inject({ url: base + '/cover/with-cover' })).statusCode, 401);
  // ② 歌曲不存在 → 404（byId O(1) 查找）。
  const missing = await app.inject({ url: base + '/cover/missing', headers });
  assert.equal(missing.statusCode, 404); assert.equal(missing.json().message, '歌曲不存在');
  // ③ 无封面 → 404 + 业务错误体。
  const empty = await app.inject({ url: base + '/cover/without-cover', headers });
  assert.equal(empty.statusCode, 404); assert.equal(empty.json().message, '该歌曲没有封面');
  // ④ 无路径歌曲（异常 track）同样视为不存在。
  const orphan = await app.inject({ url: base + '/cover/without-path', headers });
  assert.equal(orphan.statusCode, 404);
  // ⑤ 有封面：按需读盘 → 200 + 原 mime + 缓存头 + 字节一致。
  const cover = await app.inject({ url: base + '/cover/with-cover', headers });
  assert.equal(cover.statusCode, 200);
  assert.equal(cover.headers['content-type'], 'image/jpeg');
  assert.equal(cover.headers['cache-control'], 'private, max-age=86400');
  assert.equal(cover.rawPayload.length, JPEG_BYTES.length);
  for (let i = 0; i < JPEG_BYTES.length; i++) assert.equal(cover.rawPayload[i], JPEG_BYTES[i]);
  // ⑥ 封面文件缺失 → 404，失败不进缓存（文件恢复后无需重启即可再试）。
  const gone = await app.inject({ url: base + '/cover/gone-file', headers });
  assert.equal(gone.statusCode, 404); assert.equal(gone.json().message, '封面文件缺失，请联系管理员');
  assert.equal(rooms.covers.stats().entries, 1); // 只有成功那张进了 LRU
  // ⑦ 再次请求命中 LRU：仍 200 且字节一致。
  const again = await app.inject({ url: base + '/cover/with-cover', headers });
  assert.equal(again.statusCode, 200); assert.equal(again.rawPayload.length, JPEG_BYTES.length);
});

test('cover cache: byte-accounted LRU evicts least recent and re-reads on demand', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'listen-cover-lru-'));
  const mk = async (name: string, bytes: Buffer) => { const p = join(directory, name); await writeFile(p, bytes); return p; };
  const [fa, fb, fc] = await Promise.all([mk('a.png', PNG_A), mk('b.png', PNG_B), mk('c.png', PNG_C)]);
  const tracks = [
    track('a', { cover: { mime: 'image/png', file: fa, embedded: false }, coverVer: 1 }),
    track('b', { cover: { mime: 'image/png', file: fb, embedded: false }, coverVer: 1 }),
    track('c', { cover: { mime: 'image/png', file: fc, embedded: false }, coverVer: 1 })
  ];
  const { app, rooms } = await buildApp(tracks, { timers: false, coverCacheBytes: 25 });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const host = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: 'h' }, headers: { 'x-listentogether-protocol': '2' } })).json();
  const headers = { authorization: 'Bearer ' + host.token };
  const base = '/api/rooms/' + host.code;
  const fetchCover = async (id: string) => app.inject({ url: `${base}/cover/${id}`, headers });
  assert.equal((await fetchCover('a')).statusCode, 200);
  assert.equal((await fetchCover('b')).statusCode, 200);
  assert.equal((await fetchCover('c')).statusCode, 200);
  // 每张 10 字节、上限 25：插入 c 后必须淘汰最旧的 a，字节占用回落到 20。
  let stats = rooms.covers.stats();
  assert.deepEqual(stats.keys, ['b-1', 'c-1']);
  assert.equal(stats.bytes, 20);
  assert.equal(stats.peakBytes, 30); // 淘汰前的瞬时峰值如实记录
  // 触碰 a：重新读盘仍 200；此时最旧的 b 被淘汰（LRU 顺序而非 FIFO）。
  assert.equal((await fetchCover('a')).statusCode, 200);
  stats = rooms.covers.stats();
  assert.deepEqual(stats.keys, ['c-1', 'a-1']);
  assert.equal(stats.bytes, 20);
});
