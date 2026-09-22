import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
