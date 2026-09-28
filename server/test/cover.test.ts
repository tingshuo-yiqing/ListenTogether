import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import type { Track } from '../src/library/catalog.js';
function track(id: string, overrides: Partial<Track> = {}): Track {
  return { id, title: id, durationMs: 10000, path: '', size: 100, artist: null, cover: null, coverVer: null, lyricsPath: null, ...overrides };
}
test('cover: authentication, missing track, missing cover and successful bytes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'listen-cover-'));
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // JPEG magic + 长度前缀
  const audioPath = join(directory, 'one.mp3'); await writeFile(audioPath, Buffer.from('0123456789'));
  const tracks: Track[] = [
    track('with-cover', { path: audioPath, cover: { mime: 'image/jpeg', data: jpegBytes }, coverVer: 12345 }),
    track('without-cover', { path: audioPath }),
    track('without-path')
  ];
  const { app } = await buildApp(tracks, { timers: false });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const host = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: 'host' } })).json();
  const headers = { authorization: 'Bearer ' + host.token };
  const base = '/api/rooms/' + host.code;
  // ① 鉴权：未带 token 直接 401。
  assert.equal((await app.inject({ url: base + '/cover/with-cover' })).statusCode, 401);
  // ② 歌曲不存在 → 404。
  const missing = await app.inject({ url: base + '/cover/missing', headers });
  assert.equal(missing.statusCode, 404); assert.equal(missing.json().message, '歌曲不存在');
  // ③ 无封面 → 404 + 业务错误体。
  const empty = await app.inject({ url: base + '/cover/without-cover', headers });
  assert.equal(empty.statusCode, 404); assert.equal(empty.json().message, '该歌曲没有封面');
  // ④ 无路径歌曲（异常 track）同样视为不存在。
  const orphan = await app.inject({ url: base + '/cover/without-path', headers });
  assert.equal(orphan.statusCode, 404);
  // ⑤ 有封面：200 + 原 mime + 缓存头 + 字节一致。
  const cover = await app.inject({ url: base + '/cover/with-cover', headers });
  assert.equal(cover.statusCode, 200);
  assert.equal(cover.headers['content-type'], 'image/jpeg');
  assert.equal(cover.headers['cache-control'], 'private, max-age=86400');
  assert.equal(cover.rawPayload.length, jpegBytes.length);
  for (let i = 0; i < jpegBytes.length; i++) assert.equal(cover.rawPayload[i], jpegBytes[i]);
});
test('catalog JSON includes artist/hasCover/coverVer/hasLyrics with null semantics', async t => {
  const { app } = await buildApp([
    track('with-art', { artist: '歌手' }),
    track('no-art'),
    track('with-cover', { cover: { mime: 'image/png', data: Buffer.from([1, 2, 3]) }, coverVer: 999 }),
    track('with-lyrics', { lyricsPath: '/library/lyrics/with-lyrics.lrc' })
  ], { timers: false });
  t.after(() => app.close());
  const host = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: 'h' } })).json();
  const list = (await app.inject({ url: '/api/rooms/' + host.code + '/catalog', headers: { authorization: 'Bearer ' + host.token } })).json();
  assert.deepEqual(list.find((x: Track) => x.id === 'with-art'), { id: 'with-art', title: 'with-art', durationMs: 10000, artist: '歌手', hasCover: false, coverVer: null, hasLyrics: false });
  assert.deepEqual(list.find((x: Track) => x.id === 'no-art'), { id: 'no-art', title: 'no-art', durationMs: 10000, artist: null, hasCover: false, coverVer: null, hasLyrics: false });
  assert.deepEqual(list.find((x: Track) => x.id === 'with-cover'), { id: 'with-cover', title: 'with-cover', durationMs: 10000, artist: null, hasCover: true, coverVer: 999, hasLyrics: false });
  const lyricsRow = list.find((x: Track) => x.id === 'with-lyrics');
  assert.equal(lyricsRow.hasLyrics, true);
  // 绝对文件路径绝不出服务端，只下发布尔位。
  assert.ok(!JSON.stringify(list).includes('/library/'));
});