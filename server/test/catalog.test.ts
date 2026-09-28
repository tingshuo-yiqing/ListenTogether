import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/library/catalog.js';
test('real MP3 metadata is loaded from the file, without trusting declared duration', async () => {
  const tracks = await loadCatalog(fileURLToPath(new URL('./fixtures', import.meta.url)));
  assert.equal(tracks[0].id, 'tone');
  assert.ok(tracks[0].durationMs >= 1000 && tracks[0].durationMs < 1200);
  assert.ok(tracks[0].size > 1000);
});
test('manual artist field wins; missing ID3 yields null artist/cover/coverVer', async t => {
  const root = await mkdtemp(join(tmpdir(), 'listen-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = join(root, 'catalog.json');
  await writeFile(join(root, 'tone.mp3'), await readFile(fileURLToPath(new URL('./fixtures/tone.mp3', import.meta.url))));
  // ① 手填 artist（覆盖 ID3；tone.mp3 无 ID3 标签时即直接采用）。
  // tone.mp3 没有 ID3 封面，未配置独立 cover 时仍保持 null。
  await writeFile(manifest, JSON.stringify([{ id: 'tone', title: '手填', file: 'tone.mp3', artist: '  歌手 A  ' }]));
  const a = await loadCatalog(root);
  assert.equal(a[0].artist, '歌手 A');
  assert.equal(a[0].cover, null);
  assert.equal(a[0].coverVer, null);
  // ② 无手填且无 ID3：artist/cover/coverVer 全部为 null。
  await writeFile(manifest, JSON.stringify([{ id: 'tone', title: '无', file: 'tone.mp3' }]));
  const b = await loadCatalog(root);
  assert.equal(b[0].artist, null);
  assert.equal(b[0].cover, null);
  assert.equal(b[0].coverVer, null);
  // ③ 无效 artist 字段（数组）忽略，按 ID3（亦无）回退为 null。
  await writeFile(manifest, JSON.stringify([{ id: 'tone', title: '错', file: 'tone.mp3', artist: ['x'] }]));
  const c = await loadCatalog(root);
  assert.equal(c[0].artist, null);
  // ④ 文件引用同步复用，编目里只放 filename、不暴露 absolute path。
  assert.ok(a[0].path.endsWith('tone.mp3'));
});
test('catalog loads an independent cover and returns a content-based cache version', async t => {
  const root = await mkdtemp(join(tmpdir(), 'listen-catalog-cover-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tone = await readFile(fileURLToPath(new URL('./fixtures/tone.mp3', import.meta.url)));
  await writeFile(join(root, 'tone.mp3'), tone);
  await mkdir(join(root, 'covers'));
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  await writeFile(join(root, 'covers', 'tone.png'), png);
  await writeFile(join(root, 'catalog.json'), JSON.stringify([{
    id: 'tone', title: '独立封面', file: 'tone.mp3', cover: 'covers/tone.png'
  }]));
  const tracks = await loadCatalog(root);
  assert.equal(tracks[0].cover?.mime, 'image/png');
  assert.deepEqual(tracks[0].cover?.data, png);
  assert.equal(typeof tracks[0].coverVer, 'number');
  assert.notEqual(tracks[0].coverVer, null);
});
test('catalog rejects cover paths outside the library and invalid image bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'listen-catalog-cover-boundary-'));
  const outside = await mkdtemp(join(tmpdir(), 'listen-cover-outside-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  const tone = await readFile(fileURLToPath(new URL('./fixtures/tone.mp3', import.meta.url)));
  await writeFile(join(root, 'tone.mp3'), tone);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  await writeFile(join(outside, 'away.png'), png);
  await writeFile(join(root, 'catalog.json'), JSON.stringify([{
    id: 'tone', title: '越界', file: 'tone.mp3', cover: relative(root, join(outside, 'away.png'))
  }]));
  await assert.rejects(loadCatalog(root), /曲库内的封面图片/);
  await mkdir(join(root, 'covers'));
  await writeFile(join(root, 'covers', 'bad.jpg'), Buffer.from('not an image'));
  await writeFile(join(root, 'catalog.json'), JSON.stringify([{
    id: 'tone', title: '坏图', file: 'tone.mp3', cover: 'covers/bad.jpg'
  }]));
  await assert.rejects(loadCatalog(root), /不是有效的 JPG/);
});
test('catalog validates optional lyrics references at load time', async t => {
  const root = await mkdtemp(join(tmpdir(), 'listen-catalog-'));
  const outside = await mkdtemp(join(tmpdir(), 'listen-outside-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  const manifest = join(root, 'catalog.json');
  const tone = await readFile(fileURLToPath(new URL('./fixtures/tone.mp3', import.meta.url)));
  await writeFile(join(root, 'tone.mp3'), tone);
  await writeFile(join(root, 'tone.lrc'), '[00:01.00] 第一行\n');
  // ① 正常引用：解析为库内绝对路径。
  await writeFile(manifest, JSON.stringify([{ id: 'tone', title: '有词', file: 'tone.mp3', lyrics: 'tone.lrc' }]));
  const a = await loadCatalog(root);
  assert.ok(a[0].lyricsPath && a[0].lyricsPath.endsWith('tone.lrc'));
  // lyricsVer：内容哈希 + mtime，非空且数值稳定；换词（原地改写）后版本必变，客户端据此失效缓存。
  assert.equal(typeof a[0].lyricsVer, 'number');
  const verBefore = a[0].lyricsVer;
  const again = await loadCatalog(root);
  assert.equal(again[0].lyricsVer, verBefore);
  await writeFile(join(root, 'tone.lrc'), '[00:01.00] 换词后的第一行\n');
  assert.notEqual((await loadCatalog(root))[0].lyricsVer, verBefore);
  // ② 无 lyrics 字段 → null（lyricsVer 同步为 null）。
  await writeFile(manifest, JSON.stringify([{ id: 'tone', title: '无词', file: 'tone.mp3' }]));
  const noLyrics = (await loadCatalog(root))[0];
  assert.equal(noLyrics.lyricsPath, null);
  assert.equal(noLyrics.lyricsVer, null);
  // ③ ../ 逃逸与外部绝对路径都必须被 realpath+前缀比较拦下。
  await writeFile(join(outside, 'away.lrc'), 'x');
  await writeFile(manifest, JSON.stringify([{ id: 'tone', title: '逃', file: 'tone.mp3', lyrics: relative(root, join(outside, 'away.lrc')) }]));
  await assert.rejects(loadCatalog(root), /曲库内的 LRC/);
  // ④ 非 .lrc 后缀拒绝（哪怕内容是文本）。
  await writeFile(join(root, 'not-lyric.txt'), 'x');
  await writeFile(manifest, JSON.stringify([{ id: 'tone', title: '后缀', file: 'tone.mp3', lyrics: 'not-lyric.txt' }]));
  await assert.rejects(loadCatalog(root), /曲库内的 LRC/);
  // ⑤ 引用的文件不存在：realpath 直接失败，启动即报错而非运行期 404。
  await writeFile(manifest, JSON.stringify([{ id: 'tone', title: '缺失', file: 'tone.mp3', lyrics: 'none.lrc' }]));
  await assert.rejects(loadCatalog(root));
  // ⑥ 超过 256KB 拒绝上架（接口侧不再二次限制）。
  await writeFile(join(root, 'huge.lrc'), '字'.repeat(90_000)); // 约 270KB UTF-8
  await writeFile(manifest, JSON.stringify([{ id: 'tone', title: '超大', file: 'tone.mp3', lyrics: 'huge.lrc' }]));
  await assert.rejects(loadCatalog(root), /256KB/);
});
test('catalog rejects malformed structure, duplicate IDs, missing and invalid audio', async t => {
  const root = await mkdtemp(join(tmpdir(), 'listen-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = join(root, 'catalog.json');
  await writeFile(manifest, '{}');
  await assert.rejects(loadCatalog(root), /数组/);
  await writeFile(manifest, JSON.stringify([{ id: 'a', title: 'missing', file: 'none.mp3' }]));
  await assert.rejects(loadCatalog(root));
  await writeFile(join(root, 'bad.mp3'), 'not an audio file');
  await writeFile(manifest, JSON.stringify([{ id: 'a', title: 'bad', file: 'bad.mp3' }]));
  await assert.rejects(loadCatalog(root));
  await writeFile(manifest, JSON.stringify([{ id: 'a', title: 'a', file: 'bad.mp3' }, { id: 'a', title: 'b', file: 'bad.mp3' }]));
  await assert.rejects(loadCatalog(root));
});
// 曲库路径校验（src/library/catalog.ts 的 realpath + startsWith）是"文件路径不来自 HTTP 参数"的边界，
// 必须钉住：manifest 是运维写入的，但一次手滑就能让 /audio/:id 提供曲库外的任意 MP3（如私人曲库、系统文件）。
test('catalog rejects ../ escape and links pointing outside the library', async t => {
  const root = await mkdtemp(join(tmpdir(), 'listen-catalog-'));
  const outside = await mkdtemp(join(tmpdir(), 'listen-outside-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  const manifest = join(root, 'catalog.json');
  const outsideTrack = join(outside, 'tone.mp3');
  await writeFile(outsideTrack, await readFile(fileURLToPath(new URL('./fixtures/tone.mp3', import.meta.url))));

  // ① 相对路径穿越：真实存在的曲库外文件，必须被 realpath + 前缀比较拦下。
  await writeFile(manifest, JSON.stringify([{ id: 'a', title: 'escaped', file: relative(root, outsideTrack) }]));
  await assert.rejects(loadCatalog(root), /曲库内的 MP3/);

  // ② 目录符号链接指向曲库外：realpath 会解析到链接目标，同样必须被拒。
  // 用目录链接（Windows 走 junction，POSIX 同为目录符号链接）而非文件符号链接：
  // 本机 Windows 沙箱下 fs.symlink(文件) 会静默退化成普通文件（lstat.isSymbolicLink=false、nlink=1），
  // realpath 不再解析，拿它当证据会得到"防线似乎失效"的假象，见开发陷阱清单。
  await symlink(outside, join(root, 'outside-link'), 'junction');
  await writeFile(manifest, JSON.stringify([{ id: 'a', title: 'linked', file: 'outside-link/tone.mp3' }]));
  await assert.rejects(loadCatalog(root), /曲库内的 MP3/);

  // ③ 对照：指向曲库内的目录链接仍可正常加载，证明 ② 被拒不是因为"链接一律拒绝"。
  await mkdir(join(root, 'inside'));
  await writeFile(join(root, 'inside', 'tone.mp3'), await readFile(fileURLToPath(new URL('./fixtures/tone.mp3', import.meta.url))));
  await symlink(join(root, 'inside'), join(root, 'inside-link'), 'junction');
  await writeFile(manifest, JSON.stringify([{ id: 'tone', title: 'inside', file: 'inside-link/tone.mp3' }]));
  const tracks = await loadCatalog(root);
  assert.equal(tracks[0].id, 'tone');
  assert.ok(tracks[0].durationMs >= 1000);
});
