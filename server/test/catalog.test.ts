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

