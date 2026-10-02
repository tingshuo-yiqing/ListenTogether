import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoverCache } from '../src/library/cover-cache.js';
import type { Track } from '../src/library/catalog.js';

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x09, 0x0a]);

function track(id: string, overrides: Partial<Track> = {}): Track {
  return { id, title: id, durationMs: 10000, path: '', size: 100, artist: null, cover: null, coverVer: null, lyricsPath: null, lyricsVer: null, album: null, ...overrides };
}

/** 最小 ID3v2.3 + APIC 帧 + 一个 MPEG 帧：让 music-metadata 能解析出内嵌封面。 */
function id3v2ApicMp3(image: Buffer, mime = 'image/jpeg'): Buffer {
  const frameBody = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from(mime + '\0', 'latin1'),
    Buffer.from([0x03]), // picture type: front cover
    Buffer.from([0x00]), // 空 description 终止符
    image
  ]);
  const frame = Buffer.concat([
    Buffer.from('APIC', 'latin1'),
    Buffer.from([(frameBody.length >>> 24) & 0xff, (frameBody.length >>> 16) & 0xff, (frameBody.length >>> 8) & 0xff, frameBody.length & 0xff]),
    Buffer.from([0, 0]),
    frameBody
  ]);
  const size = frame.length;
  const header = Buffer.concat([
    Buffer.from('ID3', 'latin1'), Buffer.from([0x03, 0x00, 0x00]),
    Buffer.from([(size >>> 21) & 0x7f, (size >>> 14) & 0x7f, (size >>> 7) & 0x7f, size & 0x7f]) // syncsafe
  ]);
  const mpegFrame = Buffer.alloc(417); // 128kbps/44.1kHz/mono 单帧，music-metadata 不解码音频内容
  mpegFrame[0] = 0xff; mpegFrame[1] = 0xfb; mpegFrame[2] = 0x90; mpegFrame[3] = 0xc0;
  return Buffer.concat([header, frame, mpegFrame]);
}

test('cover cache: concurrent reads of the same resource merge into one read', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'listen-cover-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // ① 内嵌 APIC：按需重解析 MP3 取图。
  const mp3Path = join(directory, 'embedded.mp3');
  await writeFile(mp3Path, id3v2ApicMp3(JPEG_BYTES));
  const cache = new CoverCache();
  const embedded = track('e1', { path: mp3Path, cover: { mime: 'image/jpeg', file: null, embedded: true }, coverVer: 7 });
  const [a1, a2] = await Promise.all([cache.get(embedded), cache.get(embedded)]);
  assert.deepEqual(a1, { mime: 'image/jpeg', data: JPEG_BYTES });
  assert.deepEqual(a2, a1);
  // 同资源在途合并：两次并发 get 只发生一次受限于并发的读取（无合并时并发读取会推高 peak）。
  const stats = cache.stats();
  assert.equal(stats.peak, 1);
  assert.equal(stats.inflight, 0); // 完成后在途表清理
  assert.deepEqual(stats.keys, ['e1-7']);
  // ② 无内嵌封面的 MP3 → null（路由层 404），失败不进缓存。
  const plainPath = join(directory, 'plain.mp3');
  await writeFile(plainPath, Buffer.alloc(1024, 0x00));
  const plain = track('e2', { path: plainPath, cover: { mime: 'image/jpeg', file: null, embedded: true }, coverVer: 3 });
  assert.equal(await cache.get(plain), null);
  assert.deepEqual(cache.stats().keys, ['e1-7']);
  // ③ 无封面引用直接短路，不发起任何读取。
  assert.equal(await cache.get(track('e3')), null);
});
