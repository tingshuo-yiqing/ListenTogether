/** 本轮独立夹具与进程生命周期。端口动态分配，永不复用用户的 3000/3100 服务。 */
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

export const root = resolve(import.meta.dirname, '../../..');
export const evidence = import.meta.dirname;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const pause = ms => new Promise(r => setTimeout(r, ms));
export async function until(action, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const result = await action(); if (result) return result; } catch (error) { last = error; }
    await pause(100);
  }
  throw new Error('等待超时：' + (last?.message ?? action.toString()));
}
export async function port() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const value = server.address().port; await new Promise(r => server.close(r)); return value;
}
export async function fixture() {
  const work = await mkdtemp(join(root, '.workbuddy', 'desktop-fixture-'));
  const media = join(work, 'media');
  for (const dir of ['audio', 'covers', 'lyrics']) await mkdir(join(media, dir), { recursive: true });
  const audio = await readFile(join(root, 'server/test/fixtures/tone.mp3'));
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const entries = [];
  for (const id of ['a', 'b']) {
    await writeFile(join(media, 'audio', id + '.mp3'), audio);
    await writeFile(join(media, 'covers', id + '.png'), image);
    await writeFile(join(media, 'lyrics', id + '.lrc'), '[00:00.00]隔离合成测试音\n');
    entries.push({ id, title: '测试歌曲 ' + id.toUpperCase(), artist: '测试歌手', album: '测试专辑', file: 'audio/' + id + '.mp3', cover: 'covers/' + id + '.png', lyrics: 'lyrics/' + id + '.lrc' });
  }
  await writeFile(join(media, 'catalog.json'), JSON.stringify(entries, null, 2) + '\n');
  return { work, media, entries, trash: join(work, 'trash'), cache: join(work, 'cache.json'), cleanup: () => rm(work, { recursive: true, force: true }) };
}
export async function processAt(script, args, extraEnv = {}) {
  const child = spawn(process.execPath, [script, ...args], { cwd: root, windowsHide: true, env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  child.on('error', error => output += error.stack);
  return { child, output: () => output, async stop() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const done = once(child, 'exit'); child.kill();
    await Promise.race([done, pause(3000)]);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await done; }
  } };
}
export async function manager(data) {
  const value = await port(), url = 'http://127.0.0.1:' + value;
  const child = await processAt(join(root, 'scripts/metadata-manager.mjs'), ['--dir', data.media, '--port', String(value), '--cache', data.cache, '--trash', data.trash]);
  try {
    await until(async () => { if (child.child.exitCode !== null) throw new Error(child.output()); return (await fetch(url + '/api/tracks')).ok; });
    return { ...child, url };
  } catch (error) { await child.stop(); throw error; }
}
export async function backend(media) {
  const value = await port(), url = 'http://127.0.0.1:' + value;
  const child = await processAt(join(root, 'server/dist/index.js'), [], { HOST: '127.0.0.1', PORT: String(value), MEDIA_DIR: media });
  try { await until(async () => (await fetch(url + '/health')).ok); return { ...child, url }; }
  catch (error) { await child.stop(); throw new Error(error.message + '\n' + child.output()); }
}
export async function identity(url) {
  const response = await fetch(url + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-listentogether-protocol': '2' }, body: JSON.stringify({ nickname: '隔离验收' }) });
  if (!response.ok) throw new Error('建房失败：' + await response.text());
  const value = await response.json();
  return { ...value, headers: { authorization: 'Bearer ' + value.token, 'x-listentogether-protocol': '2' } };
}
