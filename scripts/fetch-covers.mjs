#!/usr/bin/env node
/**
 * 一起听歌 · 封面批量抓取（一次性/可重跑的本机工具）
 *
 * 用法：
 *   node scripts/fetch-covers.mjs [--source qq] [--min-score 0.8] [--force] [--dry-run]
 *     --source    匹配源（qq/netease/musicbrainz，默认 qq，华语封面覆盖最好）
 *     --min-score 候选置信度阈值，与界面同一量纲（默认 0.8；低于阈值一律不落封面）
 *     --force     已有 cover 字段的条目也重抓（默认跳过，幂等）
 *     --dry-run   只匹配和下载到内存校验、不写盘不写 catalog，用于先看报告
 *
 * 行为：逐首用 lib/metadata-sources.mjs 匹配候选（缓存优先，键与可视化管理器同一份
 *   .workbuddy/metadata-cache.json），候选达标且有封面地址时下载图片：
 *   校验魔数（JPG/PNG/WebP）与 ≤1MB（与 loadCatalog 同口径），存 covers/<id>.<ext>，
 *   catalog 条目写 cover 相对路径。全部完成后原子写 catalog → loadCatalog 整库校验，
 *   失败则回滚 catalog 并删除本次新落的图片文件——不会留下半成品。
 *
 * 出网边界：搜索接口与封面图片各 1–2 个请求/首，只取元数据与图片，不取音源、
 *   不带登录态。下载间隔 300ms，搜索限速由源客户端自带的串行队列保证。
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createMetadataSource, DEFAULT_SOURCE, DEFAULT_MIN_SCORE,
  cacheKey, mergeLocalFields, readId3Tags,
} from './lib/metadata-sources.mjs';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(name);
const MEDIA_DIR = resolve(argValue('--dir', join(PROJECT_ROOT, 'media')));
const SOURCE = argValue('--source', DEFAULT_SOURCE);
const MIN_SCORE = Number(argValue('--min-score', String(DEFAULT_MIN_SCORE)));
const FORCE = hasFlag('--force');
const DRY_RUN = hasFlag('--dry-run');
const CATALOG_PATH = join(MEDIA_DIR, 'catalog.json');
const COVERS_DIR = join(MEDIA_DIR, 'covers');
const CACHE_PATH = resolve(argValue('--cache', join(PROJECT_ROOT, '.workbuddy', 'metadata-cache.json')));
const DOWNLOAD_GAP_MS = 300;

if (!Number.isFinite(MIN_SCORE) || MIN_SCORE < 0 || MIN_SCORE > 1) {
  console.error('置信度阈值必须是 0 到 1 之间的数字');
  process.exit(1);
}

// 复用 server 编译产物与依赖（与管理器同一套探路提示）
const SERVER_DIR = resolve(SCRIPT_DIR, '..', 'server');
async function importRequired(relativePath, fixCommand) {
  const absolute = join(SERVER_DIR, ...relativePath.split('/'));
  if (!existsSync(absolute)) {
    console.error(`缺少依赖：${absolute}\n请先执行：${fixCommand}`);
    process.exit(1);
  }
  return import(pathToFileURL(absolute).href);
}
const { loadCatalog } = await importRequired('dist/library/catalog.js', 'cd server && npm run build');
const { parseFile } = await importRequired('node_modules/music-metadata/lib/index.js', 'cd server && npm ci');

/** 图片魔数 → 扩展名；不认识的一律拒绝（loadCatalog 只收 JPG/PNG/WebP）。 */
function imageExt(data) {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

async function readCache() {
  try {
    const raw = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

// ---- 主流程 ----
const entries = JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
if (!Array.isArray(entries)) { console.error('catalog.json 必须是数组'); process.exit(1); }
const loaded = await loadCatalog(MEDIA_DIR); // 启动自检：库坏了不继续
const byId = new Map(loaded.map((t) => [t.id, t]));
const client = createMetadataSource(SOURCE);
const cache = await readCache();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = [];
const writtenFiles = [];
let matched = 0, skipped = 0, noCover = 0, failed = 0;

for (const entry of entries) {
  if (!entry || typeof entry.id !== 'string') continue;
  if (entry.cover && !FORCE) { skipped++; report.push(`= ${entry.id} 已有封面（${entry.cover}），跳过`); continue; }
  const track = byId.get(entry.id);
  if (!track) { failed++; report.push(`! ${entry.id} 编目条目未能加载`); continue; }

  // 与可视化管理器同一口径：手填优先、ID3 兜底，缓存键含源名
  const local = mergeLocalFields(entry, await readId3Tags(track.path, parseFile));
  const key = `${SOURCE}|${cacheKey(entry)}`;
  let result = cache[key] || null;
  const usedCache = Boolean(result);
  if (!result) {
    try {
      result = await client.findMetadata(local, { minScore: MIN_SCORE });
      cache[key] = { ...result, cachedAt: new Date().toISOString() };
    } catch (err) {
      failed++; report.push(`! ${entry.id} 匹配失败：${err.message}`);
      continue;
    }
  }
  const accepted = Boolean(result?.candidate) && Number(result?.score) >= MIN_SCORE;
  const coverUrl = accepted ? (result.coverUrl || null) : null;
  if (!coverUrl) {
    noCover++;
    report.push(`- ${entry.id} ${usedCache ? '(缓存)' : ''}分数 ${Number(result?.score || 0).toFixed(2)} 达标=${accepted}，无可用封面地址`);
    continue;
  }

  try {
    const res = await fetch(coverUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = imageExt(buf);
    if (!ext) throw new Error('不是 JPG/PNG/WebP 图片');
    if (buf.length > 1024 * 1024) throw new Error(`图片 ${(buf.length / 1024).toFixed(0)}KB 超过 1MB 上限`);
    if (DRY_RUN) { matched++; report.push(`~ ${entry.id}（演练）将保存 ${ext} ${(buf.length / 1024).toFixed(0)}KB ← ${coverUrl}`); }
    else {
      await mkdir(COVERS_DIR, { recursive: true });
      const rel = `covers/${entry.id}.${ext}`;
      await writeFile(join(MEDIA_DIR, rel), buf);
      writtenFiles.push(rel);
      entry.cover = rel;
      matched++;
      report.push(`+ ${entry.id} ${ext} ${(buf.length / 1024).toFixed(0)}KB（分数 ${Number(result.score).toFixed(2)}，${usedCache ? '缓存' : '新查'}）`);
    }
  } catch (err) { failed++; report.push(`! ${entry.id} 下载失败：${err.message}`); }
  await sleep(DRY_RUN ? 0 : DOWNLOAD_GAP_MS);
}

if (DRY_RUN) {
  console.log(report.join('\n'));
  console.log(`\n演练完成：可写 ${matched}，已有跳过 ${skipped}，无封面 ${noCover}，失败 ${failed}（未写盘）`);
  process.exit(0);
}

// 原子写 catalog → 整库校验 → 失败回滚并清理本次图片
const oldEntries = entries;
await writeFile(CATALOG_PATH + '.tmp', JSON.stringify(entries, null, 2) + '\n', 'utf8');
await rename(CATALOG_PATH + '.tmp', CATALOG_PATH);
try {
  await loadCatalog(MEDIA_DIR);
} catch (err) {
  await writeFile(CATALOG_PATH + '.tmp', JSON.stringify(oldEntries, null, 2) + '\n', 'utf8');
  await rename(CATALOG_PATH + '.tmp', CATALOG_PATH);
  for (const rel of writtenFiles) await unlink(join(MEDIA_DIR, rel)).catch(() => {});
  console.error(`写入后校验未通过，已回滚并清理图片：${err.message}`);
  process.exit(1);
}
await mkdir(dirname(CACHE_PATH), { recursive: true });
await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf8');

console.log(report.join('\n'));
console.log(`\n完成：新落封面 ${matched}，已有跳过 ${skipped}，无封面 ${noCover}，失败 ${failed}`);
console.log(`catalog 与缓存已更新；运行中的后端需重启才会加载封面（重启清空内存房间）。`);
