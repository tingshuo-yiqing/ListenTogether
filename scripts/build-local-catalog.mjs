#!/usr/bin/env node
// 一起听歌 · 本地曲库装配（把云端曲库落成本地可跑的 media/）
//
// 背景：云端曲库的 MP3 用中文名，Windows 自带 tar 按 ANSI 代码页解析 tar 头，
// 会把 UTF-8 中文名解成乱码甚至解包失败（陷阱见 docs/development-pitfalls.md）。
// 因此拉取时在服务器侧用 `tar --transform` 把文件名换成 <id>.mp3，
// 再在本脚本里把 catalog.json 的 file 字段按 id 映射改写并挂上歌词引用。
//
// 用法：
//   node scripts/build-local-catalog.mjs [--source <catalog.json>] [--media <dir>] [--title-only]
//     --source   源 catalog（默认 .workbuddy/media-stage/catalog.json，即云端原件副本）
//     --media    目标曲库目录（默认 <项目根>/media）
//     --title-only  去掉 artist 字段（旧版云端后端不认 artist，需要原样回拷时用）
//
// 行为：以源 catalog 的条目顺序为准（保持云端歌单顺序），逐条：
//   1. file 改写成 audio/<id>.mp3（2026-09-27 起 media/audio/ 存放音频；若源已是库内相对路径则原样保留）；
//   2. 校验目标 mp3 存在且非空，缺失即报错退出（不产出半成品 catalog）；
//   3. media/lyrics/<id>.lrc 存在则写入 lyrics 引用，不存在则跳过（不写坏引用）；
//   4. 保留源里的 artist（若有）以及目标 catalog 已配置且文件仍存在的 cover。
// 输出：<media>/catalog.json（UTF-8、2 空格缩进、末尾换行）。
// 幂等：重复执行结果一致。

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SRC = resolve(arg('--source', join(ROOT, '.workbuddy', 'media-stage', 'catalog.json')));
const MEDIA = resolve(arg('--media', join(ROOT, 'media')));
const TITLE_ONLY = process.argv.includes('--title-only');

if (!existsSync(SRC)) {
  console.error(`源 catalog 不存在：${SRC}`);
  console.error('提示：先用 .workbuddy 下的拉取流程把云端曲库解包到 .workbuddy/media-stage/。');
  process.exit(1);
}
if (!existsSync(MEDIA)) {
  console.error(`目标曲库目录不存在：${MEDIA}`);
  process.exit(1);
}

const src = JSON.parse(readFileSync(SRC, 'utf8'));
if (!Array.isArray(src) || src.length === 0) {
  console.error(`源 catalog 为空或非数组：${SRC}`);
  process.exit(1);
}

const dest = join(MEDIA, 'catalog.json');
// 重新装配时保留本地管理器已经配置的 cover，避免只因补歌词/重映射音频就丢掉封面。
let previous = [];
if (existsSync(dest)) {
  try {
    const parsed = JSON.parse(readFileSync(dest, 'utf8'));
    if (Array.isArray(parsed)) previous = parsed;
  } catch { /* 目标清单损坏时由下面的源清单重新生成 */ }
}
const previousById = new Map(previous.filter(e => e && typeof e.id === 'string').map(e => [e.id, e]));
const out = [];
const report = [];
let withLyrics = 0, missingMp3 = 0, missingLrc = 0, missingCover = 0;

for (const e of src) {
  if (!e || typeof e.id !== 'string' || typeof e.title !== 'string') {
    console.error('源 catalog 条目缺少 id/title：' + JSON.stringify(e));
    process.exit(1);
  }
  // 目标文件名统一 audio/<basename>.mp3（ASCII，音频与歌词/封面分目录存放）
  const base = basename(String(e.file ?? '').replace(/\\/g, '/'));
  const file = /^[A-Za-z0-9._-]+\.mp3$/.test(base) ? `audio/${base}` : `audio/${e.id}.mp3`;
  const mp3 = join(MEDIA, file);
  if (!existsSync(mp3) || statSync(mp3).size === 0) {
    console.error(`缺少音频文件或文件为空：${mp3}`);
    missingMp3++;
    continue;
  }
  const entry = { id: e.id, title: e.title };
  if (!TITLE_ONLY && typeof e.artist === 'string' && e.artist) entry.artist = e.artist;
  entry.file = file;

  const cover = typeof e.cover === 'string' && e.cover.trim() ? e.cover.trim()
    : (typeof previousById.get(e.id)?.cover === 'string' ? previousById.get(e.id).cover : null);
  if (cover) {
    const coverPath = join(MEDIA, cover);
    if (!existsSync(coverPath) || statSync(coverPath).size === 0) {
      console.error(`缺少封面文件：${coverPath}`);
      missingCover++;
    } else entry.cover = cover;
  }

  const lrcRel = `lyrics/${e.id}.lrc`;
  const lrc = join(MEDIA, lrcRel);
  if (existsSync(lrc) && statSync(lrc).size > 0) {
    entry.lyrics = lrcRel;
    withLyrics++;
    report.push(`${e.id} | ${e.title} | ${file} | 歌词 ${statSync(lrc).size}B`);
  } else {
    missingLrc++;
    report.push(`${e.id} | ${e.title} | ${file} | (无歌词文件)`);
  }
  out.push(entry);
}

if (missingMp3 > 0 || missingCover > 0) {
  if (missingMp3 > 0) console.error(`\n有 ${missingMp3} 首缺音频文件，未写出 catalog（避免半成品）。先把文件补齐再跑。`);
  if (missingCover > 0) console.error(`有 ${missingCover} 首缺封面文件，未写出 catalog（避免悬挂引用）。先把文件补齐再跑。`);
  process.exit(1);
}

writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(report.join('\n'));
console.log(`\n条目 ${out.length}（挂歌词 ${withLyrics}、无歌词文件 ${missingLrc}）→ ${dest}`);
