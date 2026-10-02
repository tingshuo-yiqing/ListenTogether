import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/library/catalog.js';
import { CatalogIndex } from '../src/library/catalog-index.js';
import { buildApp } from '../src/app.js';

/** 构造 ID3v2.4 UTF-8 专辑帧；离线真实解析，不借助公网或 ffmpeg。 */
function withAlbum(audio: Buffer, value: string) {
  const syncsafe = (n: number) => Buffer.from([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]);
  const payload = Buffer.concat([Buffer.from([3]), Buffer.from(value)]);
  const frame = Buffer.concat([Buffer.from('TALB'), syncsafe(payload.length), Buffer.alloc(2), payload]);
  return Buffer.concat([Buffer.from([73, 68, 51, 4, 0, 0]), syncsafe(frame.length), frame, audio]);
}

test('album: 非空手填优先，空/无效字段回退 ID3，无标签为 null', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'listen-album-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const audio = await readFile(new URL('./fixtures/tone.mp3', import.meta.url));
  await writeFile(join(dir, 'tagged.mp3'), withAlbum(audio, 'ID3 专辑'));
  await writeFile(join(dir, 'plain.mp3'), audio);
  const manifest = [
    { id: 'manual', title: '手填', file: 'tagged.mp3', album: ' 手填专辑 ' },
    { id: 'fallback', title: '回退', file: 'tagged.mp3', album: '  ' },
    { id: 'invalid', title: '无效', file: 'tagged.mp3', album: ['无效值'] },
    { id: 'unknown', title: '未知', file: 'plain.mp3' },
  ];
  await writeFile(join(dir, 'catalog.json'), JSON.stringify(manifest));
  const tracks = await loadCatalog(dir);
  assert.deepEqual(tracks.map(x => x.album), ['手填专辑', 'ID3 专辑', 'ID3 专辑', null]);
});

test('album: 曲库/搜索/当前曲一致，专辑变更刷新 revision，不泄露路径', async t => {
  const tracks = await loadCatalog(fileURLToPath(new URL('./fixtures', import.meta.url)));
  tracks[0].album = '测试专辑';
  const { app, rooms } = await buildApp(tracks, { timers: false });
  t.after(() => app.close());
  const host = rooms.create('房主');
  const headers = { authorization: 'Bearer ' + host.token, 'x-listentogether-protocol': '2' };
  const base = '/api/rooms/' + host.code;
  const catalog = (await app.inject({ url: base + '/catalog', headers })).json();
  const search = (await app.inject({ url: base + '/catalog/search', headers })).json();
  assert.equal(catalog[0].album, '测试专辑');
  assert.deepEqual(search.items[0], catalog[0]);
  const { room, member } = rooms.auth(host.code, host.token);
  rooms.queueAdd(room, member, tracks[0].id);
  const current = rooms.snapshot(rooms.get(host.code)).track;
  assert.deepEqual(current, catalog[0]);
  assert.equal(Object.keys(current!).length, 9);
  assert.equal('path' in current!, false);
  assert.equal('size' in current!, false);
  const changed = new CatalogIndex([{ ...tracks[0], album: '另一张专辑' }]);
  assert.notEqual(changed.revision, search.catalogRevision);
});
