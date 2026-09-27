#!/usr/bin/env node
// 一起听歌 · 歌词抓取（lrclib.net 公开 API）
//
// 用法：
//   node scripts/fetch-lrc.mjs < catalog.tsv
//   输入每行：id<TAB>中文标题<TAB>durationMs[<TAB>歌手]（第 4 列可选，用于重名歧义消解）
//
// 行为：按 (track_name, duration ±2s) 搜 lrclib.net，命中且 syncedLyrics 非空即落盘到
//   media/lyrics/<id>.lrc（LRC 文本，UTF-8，[mm:ss.xx] 时间戳）。duration 在 ±2s 内优先，
//   没有再放宽到 ±10s；仍无命中则不带 duration 再搜一次（不同发行版时长可能差几十秒）。
//   仍找不到 / 命中但无 syncedLyrics 写入占位空 .lrc（仅一行 ; 注释）。
//   --force 重抓全部；默认跳过磁盘上已含 [mm:ss] 时间戳的真实歌词，只补占位/缺失项。
//   输出匹配报告（id / 状态 / artist / album / 时长差），并打印命中率。
//
// 约束：
//   - User-Agent 必填（lrclib.net 政策），见 docs/track-metadata-design.md 第 7 节。
//   - 命中后只写盘，不修改 catalog.json（云端 catalog 是真相源，本轮只生成本地 .lrc 副本）。
//   - 中文仅通过文件内容流转（lrclib 响应 UTF-8 → fs.writeFileSync('utf8')）；
//     标题/歌手作为 URL 参数走 encodeURIComponent，无 shell 注入面。

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'media', 'lyrics');
const UA = 'ListenTogether/0.3 (personal trial; +86 dev)';

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const FORCE = process.argv.includes('--force');
const lines = readFileSync(0, 'utf8').split(/\r?\n/).filter(l => l.trim());
const songs = lines.map(line => {
  const [id, title, dur, artist] = line.split('\t');
  return { id, title, durationMs: Number(dur), artist: artist?.trim() || null };
});

function api(params) {
  const qs = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    https.get({ host: 'lrclib.net', path: '/api/search?' + qs, headers: { 'User-Agent': UA } }, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          // 服务端过载/参数过宽时返回 {"message":…} 对象而非数组
          if (!Array.isArray(j)) { reject(new Error('lrclib ' + (j.statusCode ?? '') + ' ' + (j.message ?? '非数组响应'))); return; }
          resolve(j);
        } catch (e) { reject(new Error('lrclib 响应非 JSON: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

function pick(results, wantSeconds) {
  // 先按 ±2s、有 syncedLyrics 选首；没有就放宽 ±10s。
  for (const tol of [2, 10]) {
    for (const r of results) {
      if (typeof r.duration === 'number' && Math.abs(r.duration - wantSeconds) <= tol && r.syncedLyrics) return r;
    }
  }
  return null;
}

function writeOrSkip(id, body) {
  const path = join(OUT_DIR, id + '.lrc');
  writeFileSync(path, body, 'utf8');
  return path;
}

const report = [];
let matched = 0, missing = 0, kept = 0;
for (const s of songs) {
  const seconds = Math.round(s.durationMs / 1000);
  const dest = join(OUT_DIR, s.id + '.lrc');
  if (!FORCE && existsSync(dest)) {
    const existing = readFileSync(dest, 'utf8');
    if (/\[\d{2}:\d{2}/.test(existing)) { kept++; report.push([s.id, 'kept'].join('\t')); continue; }
  }
  let status = 'missing', artist = '', album = '', diff = '';
  try {
    const q = { track_name: s.title, duration: seconds };
    if (s.artist) q.artist = s.artist;
    let results;
    try {
      results = await api(q);
    } catch (e) {
      // lrclib 偶发 503 过载：等 3 秒重试一次
      await new Promise(r => setTimeout(r, 3000));
      results = await api(q);
    }
    let hit = pick(results, seconds);
    if (!hit) {
      // 放宽：不带 duration 全量搜索，按 syncedLyrics 存在与否取首条
      const q2 = { track_name: s.title };
      if (s.artist) q2.artist = s.artist;
      results = await api(q2);
      hit = results.find(r => r.syncedLyrics) ?? null;
    }
    if (hit) {
      const body = hit.syncedLyrics.replace(/\r\n/g, '\n').trimEnd() + '\n';
      writeOrSkip(s.id, body);
      matched++;
      status = 'matched'; artist = hit.artistName ?? ''; album = hit.albumName ?? '';
      diff = ((hit.duration - seconds) ?? 0).toFixed(1) + 's';
    } else {
      writeOrSkip(s.id, `; 未在 lrclib.net 匹配到带时间戳歌词；曲名「${s.title}」\n`);
      missing++;
      status = 'no-synced-hit';
    }
  } catch (e) {
    writeOrSkip(s.id, `; 抓取失败：${e.message}\n`);
    missing++;
    status = 'error';
  }
  report.push([s.id, status, artist, album, diff].join('\t'));
  process.stdout.write(`[${status}] ${s.id}\t${s.title} → ${artist || '(无)'}\n`);
}
console.log('\n匹配 ' + matched + ' 首，跳过已有 ' + kept + ' 首，未匹配 ' + missing + ' 首，输出 ' + OUT_DIR);
console.log('\n完整报告：');
console.log(report.join('\n'));