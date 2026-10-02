import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import type { Track } from '../src/library/catalog.js';

const track = (id: string, title = id, artist: string | null = null): Track =>
  ({ id, title, durationMs: 10000, path: '', size: 10, artist, cover: null, coverVer: null, lyricsPath: null, lyricsVer: null, album: null });

test('HTTP catalog/search: 鉴权、分页、revision 冲突与参数校验', async t => {
  const tracks = Array.from({ length: 45 }, (_, i) => track(`t${String(i).padStart(2, '0')}`, `歌${i}`, i % 3 === 0 ? '歌手' : null));
  const { app } = await buildApp(tracks, { timers: false });
  t.after(() => app.close());
  const host = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: '房主' }, headers: { 'x-listentogether-protocol': '2' } })).json();
  const headers = { authorization: 'Bearer ' + host.token, 'x-listentogether-protocol': '2' };
  const base = '/api/rooms/' + host.code + '/catalog/search';

  // 协议校验先于鉴权：无协议头 426；带协议头但无令牌 401（与全量 catalog 同一口径）
  assert.equal((await app.inject(base)).statusCode, 426);
  assert.equal((await app.inject({ url: base, headers: { 'x-listentogether-protocol': '2' } })).statusCode, 401);

  // 空查询分页浏览：默认 limit 30
  const page1 = (await app.inject({ url: base, headers })).json();
  assert.equal(page1.total, 45);
  assert.equal(page1.items.length, 30);
  const page2 = (await app.inject({ url: `${base}?offset=30`, headers })).json();
  assert.equal(page2.items.length, 15);
  assert.ok(!page1.items.some((a: { id: string }) => page2.items.some((b: { id: string }) => b.id === a.id)));

  // 子串命中与歌手命中
  const hit = (await app.inject({ url: `${base}?q=${encodeURIComponent('歌1')}`, headers })).json();
  assert.equal(hit.total, 11); // 歌1、歌10–歌19（"歌1"前缀命中，"歌41"等不含）
  const byArtist = (await app.inject({ url: `${base}?q=${encodeURIComponent('歌手')}`, headers })).json();
  assert.equal(byArtist.total, 15);

  // revision 一致返回 200；不一致 409 CATALOG_CHANGED
  const rev = page1.catalogRevision;
  assert.equal((await app.inject({ url: `${base}?revision=${rev}`, headers })).statusCode, 200);
  const conflict = await app.inject({ url: `${base}?revision=deadbeef00000000`, headers });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, 'CATALOG_CHANGED');

  // 参数校验 400
  for (const url of [`${base}?limit=0`, `${base}?limit=51`, `${base}?offset=-1`, `${base}?q=${'x'.repeat(101)}`]) {
    assert.equal((await app.inject({ url, headers })).statusCode, 400, url);
  }
  // 无效房间 404
  assert.equal((await app.inject({ url: '/api/rooms/DEADC0DE/catalog/search', headers })).statusCode, 404);
});
