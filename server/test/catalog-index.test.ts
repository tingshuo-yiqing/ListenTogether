import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogIndex, SearchError, normalizeText, toSummary } from '../src/library/catalog-index.js';
import type { Track } from '../src/library/catalog.js';

function fakeTrack(id: string, title: string, overrides: Partial<Track> = {}): Track {
  return {
    id, title, durationMs: 180_000, path: `D:/media/${id}.mp3`, size: 1024,
    artist: null, cover: null, coverVer: null, lyricsPath: null, lyricsVer: null, album: null, ...overrides,
  };
}

test('normalizeText：NFKC + 小写 + 合并空白', () => {
  assert.equal(normalizeText('ＡＢＣ  ＤＥ'), 'abc de');
  assert.equal(normalizeText('  红　日  '), '红 日');
});

test('revision：同内容恒定、封面/歌词版本变化即变', () => {
  const a = new CatalogIndex([fakeTrack('t1', '红日', { coverVer: 7, lyricsVer: 9 })]);
  const b = new CatalogIndex([fakeTrack('t1', '红日', { coverVer: 7, lyricsVer: 9 })]);
  assert.equal(a.revision, b.revision);
  const c = new CatalogIndex([fakeTrack('t1', '红日', { coverVer: 8, lyricsVer: 9 })]);
  assert.notEqual(a.revision, c.revision);
  const d = new CatalogIndex([fakeTrack('t1', '红日', { coverVer: 7, lyricsVer: 10 })]);
  assert.notEqual(a.revision, d.revision);
});

test('稳定排序：规范化歌名 → 歌手 → id', () => {
  const idx = new CatalogIndex([
    fakeTrack('b2', '遇见', { artist: '孙燕姿' }),
    fakeTrack('a1', '遇见', { artist: '孙燕姿' }),
    fakeTrack('c3', '红日', {}),
    fakeTrack('d4', 'ＡＢＣ', {}),
  ]);
  const ids = idx.search('', 0, 10).items.map(i => i.id);
  assert.deepEqual(ids, ['d4', 'c3', 'a1', 'b2']); // NFKC 后 ABC < 红日（小写字母码点靠前）
});

test('参数校验：非法 q/offset/limit 抛 SearchError 400', () => {
  const idx = new CatalogIndex([fakeTrack('t1', '遇见')]);
  for (const [q, o, l] of [['x'.repeat(101), 0, 30], ['ok', -1, 30], ['ok', 1.5, 30], ['ok', 0, 0], ['ok', 0, 51], ['ok', 0, 30.5]] as const) {
    assert.throws(() => idx.search(q, o, l), (e: unknown) => e instanceof SearchError && e.statusCode === 400, `${q}/${o}/${l}`);
  }
});

test('分页：空查询浏览全库，切片连续不重叠', () => {
  const tracks = Array.from({ length: 1000 }, (_, i) => fakeTrack(`t${String(i).padStart(4, '0')}`, `歌${i}`));
  const idx = new CatalogIndex(tracks);
  const p1 = idx.search('', 0, 30), p2 = idx.search('', 30, 30);
  assert.equal(p1.total, 1000);
  assert.equal(p1.items.length, 30);
  assert.ok(!p1.items.some(a => p2.items.some(b => b.id === a.id)));
  // offset 超出末尾返回空页且不越界
  const tail = idx.search('', 999, 30);
  assert.equal(tail.items.length, 1);
  const beyond = idx.search('', 1000, 30);
  assert.equal(beyond.items.length, 0);
});

test('千首夹具：中文子串命中跨页连续，无命中 total=0', () => {
  const tracks = Array.from({ length: 1000 }, (_, i) =>
    fakeTrack(`t${i}`, i % 2 ? `好听${i}` : `其他${i}`, { artist: i % 3 ? null : `歌手${i}` }));
  const idx = new CatalogIndex(tracks);
  const all = idx.search('好听', 0, 50);
  assert.equal(all.total, 500);
  const page2 = idx.search('好听', 50, 50);
  assert.equal(page2.items.length, 50);
  assert.ok(!all.items.some(a => page2.items.some(b => b.id === a.id)));
  // 歌手命中
  assert.equal(idx.search('歌手', 0, 50).total, 334);
  assert.equal(idx.search('不存在的词', 0, 30).total, 0);
  assert.equal(idx.search('', 0, 30).catalogRevision, all.catalogRevision);
});

test('track(id)：O(1) 查找，未命中 undefined；toSummary 不含路径与字节', () => {
  const idx = new CatalogIndex([fakeTrack('t1', '遇见', { coverVer: 3, lyricsPath: 'D:/x.lrc', lyricsVer: 4 })]);
  assert.equal(idx.track('t1')?.title, '遇见');
  assert.equal(idx.track('nope'), undefined);
  const s = toSummary(idx.track('t1')!);
  assert.deepEqual(s, { id: 't1', title: '遇见', durationMs: 180_000, artist: null, hasCover: false, coverVer: 3, hasLyrics: true, lyricsVer: 4, album: null });
  assert.ok(!JSON.stringify(s).includes('D:/'));
});
