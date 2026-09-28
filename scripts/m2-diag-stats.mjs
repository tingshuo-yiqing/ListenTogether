#!/usr/bin/env node
// M2 双机同步统计（diag 口径，验收标准见 docs/next-development-plan.md 第 3 节）。
//
// 输入：两台设备导出的 diag JSONL（type=playback 事件，含 estimatedServerMs/playerPositionMs/
//       driftMs/correction/buffering/localPause/trackId）。
// 对齐：estimatedServerMs 是各客户端估计的统一服务端时钟——按 (trackId, 1 秒桶) 取两侧最近事件配对，
//       偏差 = A.position − B.position。
// 输出：可比样本占比（双端同轨且都非暂停/缓冲的桶 / A 有事件的桶）、偏差分位数与 ≤500ms 占比
//       （95% 门槛）、各端 driftMs 分位数、correction=seek/speed 计数与明细、buffering 事件计数。
//
// 用法：node scripts/m2-diag-stats.mjs <A.jsonl> <B.jsonl> [--label-a 真机] [--label-b MuMu] [--window <起始epochMs>]
import { readFileSync } from 'node:fs';

const [fileA, fileB] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const labelOf = (flag, def) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : def; };
const LA = labelOf('--label-a', 'A'), LB = labelOf('--label-b', 'B');
const wIdx = process.argv.indexOf('--window');
const winStart = wIdx > 0 ? Number(process.argv[wIdx + 1]) : 0;
if (!fileA || !fileB) { console.error('用法: node scripts/m2-diag-stats.mjs <A.jsonl> <B.jsonl> [--label-a A] [--label-b B] [--window epochMs]'); process.exit(1); }

const load = f => readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch { return null; } })
  .filter(e => e && e.type === 'playback' && e.estimatedServerMs >= winStart);
const A = load(fileA), B = load(fileB);
if (!A.length || !B.length) { console.error('事件为空'); process.exit(1); }

const pct = (arr, p) => { const s = [...arr].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const fmt = arr => arr.length ? `n=${arr.length} p50=${pct(arr, .5)} p90=${pct(arr, .9)} p95=${pct(arr, .95)} p99=${pct(arr, .99)} max=${Math.max(...arr)}` : 'n=0';

// 1 秒桶配对：每桶各取离桶中心最近的一条；跳过任一端 localPause/buffering 的桶。
const buckets = new Map();
for (const [tag, arr] of [['A', A], ['B', B]]) {
  for (const e of arr) {
    const key = `${e.trackId}@${Math.round(e.estimatedServerMs / 1000)}`;
    if (!buckets.has(key)) buckets.set(key, {});
    buckets.get(key)[tag] = e;
  }
}
const devs = [], bucketsWithA = [...buckets.values()].filter(b => b.A).length;
let skippedPauseBuf = 0, comparable = 0;
for (const { A: a, B: b } of buckets.values()) {
  if (!a || !b) continue;
  if (a.localPause || b.localPause || a.buffering || b.buffering) { skippedPauseBuf++; continue; }
  comparable++;
  devs.push(Math.abs(a.playerPositionMs - b.playerPositionMs));
}
const within500 = devs.filter(d => d <= 500).length;
const tracks = [...new Set([...A, ...B].map(e => e.trackId))];

console.log(`A(${LA})=${A.length} 事件  B(${LB})=${B.length} 事件  轨道: ${tracks.join(', ')}`);
console.log(`1 秒桶: 双端齐全 ${comparable + skippedPauseBuf}（其中剔除暂停/缓冲 ${skippedPauseBuf}），可比 ${comparable}`);
console.log(`可比占 A 事件桶比例: ${(comparable / Math.max(1, bucketsWithA) * 100).toFixed(1)}%（门槛 ≥90%）`);
console.log(`跨端进度偏差: ${fmt(devs)}`);
console.log(`偏差 ≤500ms 占比: ${(within500 / Math.max(1, devs.length) * 100).toFixed(1)}%（门槛 ≥95%）`);
for (const [tag, arr] of [['A', A], ['B', B]]) {
  const drifts = arr.filter(e => !e.localPause && !e.buffering).map(e => Math.abs(e.driftMs));
  const corr = {};
  for (const e of arr) if (e.correction) corr[e.correction] = (corr[e.correction] ?? 0) + 1;
  const buf = arr.filter(e => e.buffering).length;
  console.log(`${tag}(${labelOf('--label-' + tag.toLowerCase(), tag)}): driftMs(绝对值) ${fmt(drifts)}  correction=${JSON.stringify(corr)}  buffering事件=${buf}/${arr.length}`);
}
// seek/speed 明细（时间用各端 wallClock 换算的 HH:MM:SS）
for (const [tag, arr] of [['A', A], ['B', B]]) {
  const marks = arr.filter(e => e.correction === 'seek' || e.correction === 'speed')
    .map(e => `${new Date(e.wallClockMs).toTimeString().slice(0, 8)} ${e.correction} drift=${e.driftMs}`);
  if (marks.length) console.log(`${tag} 纠正明细:\n  ` + marks.join('\n  '));
}
