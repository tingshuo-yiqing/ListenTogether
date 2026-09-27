import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import type { Track } from '../src/library/catalog.js';

function track(id: string, overrides: Partial<Track> = {}): Track {
  return { id, title: id, durationMs: 10000, path: '', size: 100, artist: null, cover: null, coverVer: null, lyricsPath: null, ...overrides };
}

test('lyrics: authentication, missing track/lyrics, UTF-8 text and no-store', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'listen-lyrics-'));
  const lrcPath = join(directory, '有词.lrc');
  const lrcText = '[00:01.00] 想用一杯 Latte 把妳灌醉\n[00:05.50] 好讓妳能多愛我一點\n';
  await writeFile(lrcPath, lrcText, 'utf8');
  const { app } = await buildApp([
    track('with-lyrics', { lyricsPath: lrcPath }),
    track('without-lyrics'),
    track('dangling', { lyricsPath: join(directory, '不存在.lrc') })
  ], { timers: false });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const host = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: 'host' } })).json();
  const headers = { authorization: 'Bearer ' + host.token };
  const base = '/api/rooms/' + host.code;
  // ① 鉴权：未带 token 直接 401（与音频/封面路由同一套成员令牌）。
  assert.equal((await app.inject({ url: base + '/lyrics/with-lyrics' })).statusCode, 401);
  // ② 歌曲不存在 → 404。
  const missing = await app.inject({ url: base + '/lyrics/missing', headers });
  assert.equal(missing.statusCode, 404); assert.equal(missing.json().message, '歌曲不存在');
  // ③ 无歌词 → 404 + 业务错误体（客户端据此显示占位文案）。
  const empty = await app.inject({ url: base + '/lyrics/without-lyrics', headers });
  assert.equal(empty.statusCode, 404); assert.equal(empty.json().message, '该歌曲没有歌词');
  // ④ 条目引用了已被删除的文件 → 404「歌词文件缺失」，不是 500。
  const dangling = await app.inject({ url: base + '/lyrics/dangling', headers });
  assert.equal(dangling.statusCode, 404); assert.equal(dangling.json().message, '歌词文件缺失，请联系管理员');
  // ⑤ 有歌词：200 + UTF-8 文本 + no-store + 内容逐字一致（中文经 HTTP 原样往返）。
  const res = await app.inject({ url: base + '/lyrics/with-lyrics', headers });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.equal(res.body, lrcText);
});
