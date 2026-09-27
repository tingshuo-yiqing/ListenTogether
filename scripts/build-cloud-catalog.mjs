#!/usr/bin/env node
// 一起听歌 · 为云端曲库生成带歌词引用的 catalog.json（本地生成，服务器侧只落盘）
//
// 背景：云端 MP3 用中文文件名、catalog 只有 id/title/file 三字段；歌词文件已在
// media/lyrics/<id>.lrc（与 id 同名）。本脚本在**本地**把云端 catalog 升格为
// 「保留原文件名 + 追加 lyrics 引用（+ 可选 artist）」的版本，再把结果整体上传，
// 从而不必在服务器上用 sed/node -e 拼中文（陷阱 1.6/1.8）。
//
// 用法：
//   node scripts/build-cloud-catalog.mjs --source <云端catalog> --lyrics <lrc目录> \
//     --audio <云端mp3目录> --out <输出文件> [--no-artist] [--cover-catalog <本地catalog>]
//
// 行为：
//   - 条目顺序、id、title、file 一律以 --source 为准（云端是真相源，不改名不排序）；
//   - 每条：<lyrics 目录>/<id>.lrc 存在 → 写 lyrics:"lyrics/<id>.lrc"；不存在则**不写**该字段
//     （宁可不加，也不制造"引用了但文件缺失"的悬挂引用——那会让客户端报错）；
//   - 默认从 --audio/<file> 用 music-metadata 读 ID3 artist 兜底补 artist 字段（云端 catalog
//     原本没有该字段，补上后云端与本地验收环境一致）；--no-artist 可关闭；
//   - 读取失败（文件缺失/无 ID3）不阻断，该条不补 artist；指定 --cover-catalog 时按 id 带入
//     本地管理器生成的 cover 字段，并检查封面文件存在（文件仍需由发布步骤单独同步）。
//
// 输出：UTF-8、2 空格缩进、末尾换行（服务器端 loadCatalog 直接 JSON.parse）。

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// music-metadata 是服务端依赖，从 server 的 node_modules 解析
const require2 = createRequire(join(ROOT, 'server', 'package.json'));
const { parseFile } = require2('music-metadata');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SRC = resolve(arg('--source', ''));
const LYRICS = resolve(arg('--lyrics', join(ROOT, 'media', 'lyrics')));
const AUDIO = resolve(arg('--audio', ''));
const OUT = resolve(arg('--out', ''));
const COVER_CATALOG = arg('--cover-catalog', '');
const NO_ARTIST = process.argv.includes('--no-artist');

if (!SRC || !existsSync(SRC)) { console.error('缺少/找不到 --source'); process.exit(1); }
if (!OUT) { console.error('缺少 --out'); process.exit(1); }
if (!existsSync(LYRICS)) { console.error('找不到歌词目录：' + LYRICS); process.exit(1); }

const entries = JSON.parse(readFileSync(SRC, 'utf8'));
if (!Array.isArray(entries) || entries.length === 0) {
  console.error('源 catalog 为空或非数组：' + SRC);
  process.exit(1);
}
let localCoverById = new Map();
let localCoverRoot = '';
if (COVER_CATALOG) {
  const coverCatalogPath = resolve(COVER_CATALOG);
  if (!existsSync(coverCatalogPath)) { console.error('找不到 --cover-catalog：' + coverCatalogPath); process.exit(1); }
  const localEntries = JSON.parse(readFileSync(coverCatalogPath, 'utf8'));
  if (!Array.isArray(localEntries)) { console.error('--cover-catalog 不是数组：' + coverCatalogPath); process.exit(1); }
  localCoverById = new Map(localEntries.filter(e => e && typeof e.id === 'string').map(e => [e.id, e]));
  localCoverRoot = dirname(coverCatalogPath);
}

const out = [];
const report = [];
let withLyrics = 0, withArtist = 0, missingLrc = 0, withCover = 0, missingCover = 0;

for (const e of entries) {
  if (!e || typeof e.id !== 'string' || typeof e.title !== 'string' || typeof e.file !== 'string') {
    console.error('条目字段不全：' + JSON.stringify(e));
    process.exit(1);
  }
  const item = { id: e.id, title: e.title };

  // artist：源里已有就用源的，否则从 ID3 兜底（与本地验收环境一致）
  let artist = typeof e.artist === 'string' && e.artist ? e.artist : null;
  if (!artist && !NO_ARTIST && AUDIO) {
    const audioPath = join(AUDIO, e.file);
    if (existsSync(audioPath)) {
      try {
        const md = await parseFile(audioPath, { duration: false });
        const a = md.common?.artist;
        if (typeof a === 'string' && a.trim()) artist = a.trim();
      } catch { /* 读不出就算了，不阻断 */ }
    }
  }
  if (artist) { item.artist = artist; withArtist++; }

  item.file = e.file;
  // 若源 catalog 已配置独立封面，或指定了本地管理器清单，则保留相对路径；
  // 封面文件由发布步骤单独同步，指定 --cover-catalog 时先在本地检查文件存在。
  const localCover = localCoverById.get(e.id)?.cover;
  const cover = typeof localCover === 'string' && localCover.trim() ? localCover.trim()
    : (typeof e.cover === 'string' && e.cover.trim() ? e.cover.trim() : null);
  if (cover) {
    const coverPath = join(localCoverRoot || ROOT, cover);
    if (COVER_CATALOG && (!existsSync(coverPath) || !statSync(coverPath).isFile())) {
      console.error(`缺少本地封面文件：${coverPath}`);
      missingCover++;
    } else {
      item.cover = cover;
      withCover++;
    }
  }

  // lyrics：只有本地确实存在该 id 的 .lrc 才写引用，避免悬挂引用
  const lrc = join(LYRICS, `${e.id}.lrc`);
  if (existsSync(lrc)) {
    item.lyrics = `lyrics/${e.id}.lrc`;
    withLyrics++;
    report.push(`${e.id} | ${e.title} | artist=${artist ?? '(无)'} | lyrics ✓`);
  } else {
    missingLrc++;
    report.push(`${e.id} | ${e.title} | artist=${artist ?? '(无)'} | lyrics ✗（不写引用）`);
  }
  out.push(item);
}

if (missingCover > 0) {
  console.error(`\n有 ${missingCover} 个封面引用找不到文件，未写出 catalog。`);
  process.exit(1);
}
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(report.join('\n'));
console.log(`\n条目 ${out.length}（挂歌词 ${withLyrics}、无歌词文件 ${missingLrc}、封面 ${withCover}、补到歌手 ${withArtist}）→ ${OUT}`);
