import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, cp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { allowedCoverUrl, fetchLimited, pickLyrics, findLyrics, imageExtension } from './metadata-assets.mjs';

const local = { title: 'Test Song', artist: 'Artist', durationMs: 200000 };
const row = { trackName: local.title, artistName: local.artist, duration: 200,
  syncedLyrics: '[00:00.00]fixture line', plainLyrics: 'fixture plain' };

test('歌词选择：拒绝错歌手/错曲名/超时长版本，优先时间轴', () => {
  assert.equal(pickLyrics([{ ...row, artistName: 'Cover Artist' }], local), null);
  assert.equal(pickLyrics([{ ...row, trackName: 'Other' }], local), null);
  assert.equal(pickLyrics([{ ...row, duration: 220 }], local), null);
  assert.equal(pickLyrics([{ ...row, syncedLyrics: '' }, row], local).kind, 'synced');
  assert.equal(pickLyrics([row], { ...local, artist: '' }), null);
});
test('歌词降级纯文本、拒绝空/超限文本与畸形响应', () => {
  assert.equal(pickLyrics([{ ...row, syncedLyrics: '' }], local).kind, 'plain');
  assert.equal(pickLyrics([{ ...row, syncedLyrics: '', plainLyrics: '' }], local), null);
  assert.equal(pickLyrics([{ ...row, syncedLyrics: '', plainLyrics: 'x'.repeat(262145) }], local), null);
  assert.throws(() => pickLyrics({}, local));
});
test('歌词使用官方搜索参数；网络失败上抛给调用方降级', async () => {
  const result = await findLyrics(local, async (url) => {
    assert.equal(new URL(url).searchParams.get('artist_name'), local.artist);
    return Response.json([row]);
  });
  assert.equal(result.status, 'matched');
  await assert.rejects(findLyrics(local, async () => { throw new Error('offline'); }), /offline/);
});
test('封面白名单拒绝本机、凭据、伪装域名、非HTTPS与异常端口', () => {
  for (const u of ['http://y.gtimg.cn/x', 'https://127.0.0.1/x', 'https://y.gtimg.cn.evil.test/x',
    'https://user:pass@y.gtimg.cn/x', 'https://y.gtimg.cn:444/x']) assert.equal(allowedCoverUrl(u), false);
  for (const u of ['https://y.gtimg.cn/a', 'https://p2.music.126.net/a', 'https://coverartarchive.org/a',
    'https://ia800100.us.archive.org/a']) {
    assert.equal(allowedCoverUrl(u), true);
  }
});
test('封面拒绝跳往内网；流式限制不能靠伪造Content-Length绕过', async () => {
  let calls = 0;
  await assert.rejects(fetchLimited('https://y.gtimg.cn/a', 10, allowedCoverUrl, async () => {
    calls++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
  }), /允许/);
  assert.equal(calls, 1);
  await assert.rejects(fetchLimited('https://y.gtimg.cn/a', 3, allowedCoverUrl, async () => new Response('1234')), /大小/);
  assert.throws(() => imageExtension(Buffer.from('<html>error</html>')), /图片/);
});

test('真实管理器：封面与歌词一键落库、失败隔离、票据绑定、补缺、歌词替换和回滚', { timeout: 45000 }, async () => {
  const root = resolve(import.meta.dirname, '../..');
  const temp = await mkdtemp(join(tmpdir(), 'lt-assets-'));
  let child;
  try {
    await cp(join(root, 'demo-media/demo-soft.mp3'), join(temp, 'a.mp3'));
    const catalog = join(temp, 'catalog.json');
    const entries = [{ id: 'a', title: 'Test Song', artist: 'Artist', file: 'a.mp3' },
      { id: 'b', title: 'Test Song', artist: 'Artist', file: 'a.mp3' }];
    await writeFile(catalog, JSON.stringify(entries));
    const { loadCatalog } = await import(pathToFileURL(join(root, 'server/dist/library/catalog.js')));
    const duration = (await loadCatalog(temp))[0].durationMs / 1000;
    const modeFile = join(temp, 'mode.json');
    await writeFile(modeFile, '{}');
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const preload = join(temp, 'fetch-fixture.mjs');
    await writeFile(preload, `import { readFileSync } from 'node:fs';
      globalThis.fetch = async (value) => {
        const u = new URL(value); const mode = JSON.parse(readFileSync(${JSON.stringify(modeFile)}, 'utf8'));
        if (u.hostname === 'lrclib.net') {
          if (mode.lyricsFail) throw new Error('lyrics offline');
          return Response.json(mode.missing ? [] : [{trackName:'Test Song',artistName:'Artist',duration:${duration},syncedLyrics:mode.plain?'':'[00:00.00]fixture lyrics',plainLyrics:'fixture plain'}]);
        }
        if (u.hostname === 'y.gtimg.cn') {
          if (mode.coverFail) throw new Error('cover offline');
          return new Response(Buffer.from('${png}', 'base64'));
        }
        throw new Error('fixture denies network ' + u.hostname);
      };`);
    const cacheFile = join(temp, 'cache.json');
    const cache = Object.fromEntries(entries.map(e => ['qq|' + [e.id, e.file, e.title, e.artist].join(':'),
      { candidate: { title: e.title, artist: e.artist, album: 'Candidate Album', year: 2000 }, score: 1,
        coverUrl: 'https://y.gtimg.cn/fixture.png' }]));
    const resetCache = () => writeFile(cacheFile, JSON.stringify(cache));
    await resetCache();
    child = spawn(process.execPath, ['--import', pathToFileURL(preload).href,
      join(root, 'scripts/metadata-manager.mjs'), '--dir', temp, '--port', '0', '--cache', cacheFile],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; });
    for (let i = 0; i < 100 && !stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/); i++) await new Promise(r => setTimeout(r, 50));
    const port = stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[1];
    assert.ok(port && port !== '0', stderr || stdout);
    const base = 'http://127.0.0.1:' + port;
    async function api(path, body, method = 'POST') {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { code: response.status, value: await response.json() };
    }
    const sync = async (id = 'a', onlyIfEmpty = false) =>
      (await api('/api/tracks/' + id + '/sync', { source: 'qq', includeLyrics: true, onlyIfEmpty })).value;
    const snapshot = () => readFile(catalog, 'utf8');
    const matched = await sync();
    assert.equal(matched.lyrics.kind, 'synced');
    assert.ok(matched.changes.cover && matched.changes.lyrics);
    assert.equal((await snapshot()), JSON.stringify(entries), '匹配不改曲库');
    const foreign = await api('/api/tracks/b/apply', { fields: { cover: matched.assetToken } });
    assert.equal(foreign.code, 409, '票据不能跨曲目');
    const forged = await api('/api/tracks/a/apply', { fields: { cover: 'http://127.0.0.1/secret' } });
    assert.equal(forged.code, 409, '不接受任意URL');
    const applied = await api('/api/tracks/a/apply', { fields: matched.changes, onlyIfEmpty: true });
    assert.equal(applied.code, 200); assert.equal(applied.value.failed.length, 0);
    const saved = JSON.parse(await snapshot())[0];
    assert.match(saved.cover, /^covers\//); assert.match(saved.lyrics, /^lyrics\//);
    assert.match(await readFile(join(temp, saved.lyrics), 'utf8'), /fixture lyrics/);
    assert.deepEqual(await readFile(join(temp, saved.cover)), Buffer.from(png, 'base64'));
    assert.equal((await loadCatalog(temp)).length, 2);
    const existing = await sync();
    // 单曲口径（用户 2026-09-28 要求）：已有歌词照样给出替换候选并默认勾选；已有封面仍不自动勾。
    assert.equal(existing.changes.cover, undefined);
    assert.equal(existing.changes.lyrics, existing.assetToken);
    // 批量口径：onlyIfEmpty 下已有歌词不得被报成"可补"，否则一键补缺会换掉整库歌词。
    assert.equal((await sync('a', true)).changes.lyrics, undefined);
    const beforeSkip = await snapshot();
    assert.equal((await api('/api/tracks/a/apply', { fields: { cover: existing.assetToken, lyrics: existing.assetToken }, onlyIfEmpty: true })).value.skipped, true);
    assert.equal(await snapshot(), beforeSkip);
    // 不带 onlyIfEmpty 才真替换：另起新文件、只改 catalog 指针，旧 .lrc 原样留在盘上。
    const replaced = await api('/api/tracks/a/apply', { fields: { lyrics: existing.assetToken } });
    assert.equal(replaced.code, 200);
    assert.deepEqual(replaced.value.applied, ['lyrics']);
    assert.deepEqual(replaced.value.failed, []);
    const afterReplace = JSON.parse(await snapshot())[0];
    assert.match(afterReplace.lyrics, /^lyrics\//);
    assert.notEqual(afterReplace.lyrics, saved.lyrics, '替换要另起文件，不能覆盖旧歌词内容');
    assert.match(await readFile(join(temp, saved.lyrics), 'utf8'), /fixture lyrics/, '旧 .lrc 必须留在原地供回退');
    await api('/api/tracks/a', { title: 'Changed' }, 'PUT');
    assert.equal((await api('/api/tracks/a/apply', { fields: { lyrics: existing.assetToken } })).code, 409);
    await writeFile(catalog, JSON.stringify(entries));
    await resetCache(); await writeFile(modeFile, JSON.stringify({ lyricsFail: true }));
    const lyricsDown = await sync();
    assert.equal(lyricsDown.lyrics.status, 'unavailable'); assert.ok(lyricsDown.coverUrl);
    assert.equal(Object.keys(JSON.parse(await readFile(cacheFile, 'utf8'))).some(k => k.startsWith('lyrics-v1|')), false);
    await resetCache(); await writeFile(modeFile, JSON.stringify({ coverFail: true }));
    const coverDown = await sync();
    const partial = await api('/api/tracks/a/apply', { fields: coverDown.changes });
    assert.equal(partial.code, 200); assert.deepEqual(partial.value.failed.map(x => x.field), ['cover']);
    assert.ok(JSON.parse(await snapshot())[0].lyrics); assert.equal(JSON.parse(await snapshot())[0].album, 'Candidate Album');
    assert.equal(JSON.parse(await snapshot())[0].cover, undefined);
    await writeFile(catalog, JSON.stringify(entries)); await resetCache();
    await writeFile(modeFile, JSON.stringify({ missing: true }));
    assert.equal((await sync()).lyrics.status, 'missing');
    await resetCache(); await writeFile(modeFile, JSON.stringify({ plain: true }));
    assert.equal((await sync()).lyrics.kind, 'plain');
    await resetCache(); await writeFile(modeFile, '{}');
    await writeFile(cacheFile, '{}');
    const metadataDown = await sync();
    assert.equal(metadataDown.metadataAccepted, false);
    assert.equal(metadataDown.lyrics.status, 'matched', '文字源失败也继续独立找歌词');
    await resetCache();
    const rollback = await sync();
    const filesBefore = (await readdir(join(temp, 'covers'))).sort();
    const lyricsBefore = (await readdir(join(temp, 'lyrics'))).sort();
    // 另一条目坏引用：候选所属条目没变，写入闸门失败要撤销新资源并恢复原字节。
    await writeFile(catalog, JSON.stringify([entries[0], { ...entries[1], file: 'missing.mp3' }]) + '\r\n');
    const badBefore = await snapshot();
    assert.equal((await api('/api/tracks/a/apply', { fields: rollback.changes })).code, 422);
    assert.equal(await snapshot(), badBefore);
    assert.deepEqual((await readdir(join(temp, 'covers'))).sort(), filesBefore);
    assert.deepEqual((await readdir(join(temp, 'lyrics'))).sort(), lyricsBefore);
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    await rm(temp, { recursive: true, force: true });
  }
});
