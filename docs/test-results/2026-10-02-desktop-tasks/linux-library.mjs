/** 以原生 Linux 路径运行同一管理器；独立曲库验证共享引用、回收与恢复，不写在产 media。 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { fixture, manager, evidence, sha256 } from './support.mjs';

const data = await fixture(); let service;
try {
  // 两首共享三类资源；第一次删除不能回收仍有引用的文件。
  data.entries[1] = { ...data.entries[1], file: data.entries[0].file, cover: data.entries[0].cover, lyrics: data.entries[0].lyrics };
  await writeFile(join(data.media, 'catalog.json'), JSON.stringify(data.entries));
  const hashes = {};
  for (const key of ['file', 'cover', 'lyrics']) hashes[key] = sha256(await readFile(join(data.media, data.entries[0][key])));
  service = await manager(data);
  const checks = [];
  const remove = async id => {
    const response = await fetch(service.url + '/api/tracks/' + id + '?run=linux-drill&files=audio,cover,lyrics', { method: 'DELETE' });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
  };
  assert.equal((await remove('a')).moved.length, 0);
  checks.push('共享音频/封面/歌词均留在原地');
  assert.equal((await remove('b')).moved.length, 3);
  assert.deepEqual(JSON.parse(await readFile(join(data.media, 'catalog.json'), 'utf8')), []);
  checks.push('最后引用删除：三文件进回收，空库正常');
  let trash = await (await fetch(service.url + '/api/trash')).json();
  assert.equal(trash.items.length, 2); assert.deepEqual(trash.errors, []);
  // 后删除的一首拥有被移动文件，先恢复它，再恢复仍引用相同资源的第一首。
  for (const id of ['b', 'a']) {
    const item = trash.items.find(x => x.id === id);
    const response = await fetch(service.url + '/api/trash/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ run: item.run, key: item.key }) });
    assert.equal(response.status, 200, await response.text());
    trash = await (await fetch(service.url + '/api/trash')).json();
  }
  assert.equal(trash.items.length, 0);
  for (const key of ['file', 'cover', 'lyrics']) assert.equal(sha256(await readFile(join(data.media, data.entries[0][key]))), hashes[key]);
  const restored = JSON.parse(await readFile(join(data.media, 'catalog.json'), 'utf8')).sort((a,b) => a.id.localeCompare(b.id));
  assert.deepEqual(restored, data.entries);
  checks.push('原生Linux路径恢复：两条元数据与三共享文件字节一致');
  await writeFile(join(evidence, 'linux-library.json'), JSON.stringify({ node: process.version, platform: process.platform, passed: checks.length, checks, scope: '本机 WSL 隔离曲库，非云端在产下架' }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally { await service?.stop(); await data.cleanup(); }
