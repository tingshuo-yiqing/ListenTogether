#!/usr/bin/env node
// M2 双机同步采样器（验收标准见 docs/next-development-plan.md 第 3 节）。
//
// 每秒对两台设备各取一次 `adb shell dumpsys media_session`，圈定
// package=com.listentogether.app 的会话，记录 playState/position/速度与本地接收时间戳
// （同一主机时钟，天然对齐；adb 往返延迟不扣除，属保守误差）。
// 轨道切换用 position 回退检测切分；同轨双 PLAYING 的样本才是可比样本。
// 事后统计与 diag 导出口径（correction=seek/speed 分级）见 verification 对应轮次。
//
// 用法：
//   node scripts/m2-sync-sample.mjs --a "t:6" --b "127.0.0.1:16384" --duration 600 --out m2-samples.csv
//   adb 目标以 "t:<id>" 表示 transport id，否则按序列号处理。
import { spawnSync } from 'node:child_process';
import { openSync, writeSync, closeSync } from 'node:fs';

// 同步 sleep：Atomics.wait 在主线程也可用（比 loopback ping 可靠——ping 对 127.0.0.1 立即应答，-w 不生效）。
const sleep = ms => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const ADB = process.env.ADB ?? 'C:/Users/ting/AppData/Local/Android/Sdk/platform-tools/adb.exe';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : def;
}
const A = arg('a'), B = arg('b');
const DURATION = Number(arg('duration', '600'));
const INTERVAL = Number(arg('interval', '1000'));
const OUT = arg('out', 'm2-samples.csv');
if (!A || !B) { console.error('需要 --a 与 --b 两个 adb 目标'); process.exit(1); }

const adbArgs = (t) => (t.startsWith('t:') ? ['-t', t.slice(2)] : ['-s', t]);
function sessionOf(target) {
  const r = spawnSync(ADB, [...adbArgs(target), 'shell', 'dumpsys', 'media_session'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 8000 });
  if (r.status !== 0 || !r.stdout) return null;
  // 会话记录按 package= 分段；取 com.listentogether.app 段内第一条 state=PlaybackState。
  const lines = r.stdout.split('\n');
  let inApp = false;
  for (const line of lines) {
    if (/^\s*package=/.test(line)) inApp = line.includes('com.listentogether.app');
    else if (inApp && line.includes('state=PlaybackState')) {
      // 行如 state=PlaybackState {state=PLAYING(3), position=...}：先取括号内枚举，再映射名称。
      const raw = /state=PlaybackState \{state=[A-Z]+\((\d+)\)/.exec(line)?.[1] ?? '';
      const pos = / position=(\d+)/.exec(line)?.[1] ?? '';
      const speed = /speed=([\d.]+)/.exec(line)?.[1] ?? '';
      return { state: raw, pos: Number(pos), speed };
    }
  }
  return null;
}
// state: 0=NONE 1=STOPPED 2=PAUSED 3=PLAYING …
const STATE_NAME = { 0: 'none', 1: 'stopped', 2: 'paused', 3: 'playing', 4: 'fastforward', 5: 'rewind', 6: 'buffering', 7: 'error', 8: 'connecting' };

const out = openSync(OUT, 'w');
// 顺序读取有固有时延：A 先读、B 后读，B 的位置天然多走了 (t_b - t_a)×速度。
// 每行同时记录两次读取各自的时刻与速度，分析侧据此把 A 的位置外推到 t_b 再比差（gap_skew 列）。
writeSync(out, 'ts_ms,ta_ms,tb_ms,a_state,a_pos,a_speed,b_state,b_pos,b_speed,gap_raw,gap_skew\n');
const t0 = Date.now();
let n = 0;
while (Date.now() - t0 < DURATION * 1000) {
  const ts = Date.now();
  const ta = Date.now();
  const a = sessionOf(A);
  const tb = Date.now();
  const b = sessionOf(B);
  const aSpeed = a?.speed ? Number(a.speed) : 1;
  const gapRaw = a && b ? b.pos - a.pos : '';
  const gapSkew = a && b ? Math.round(b.pos - (a.pos + aSpeed * (tb - ta))) : '';
  writeSync(out, `${ts},${ta},${tb},${a ? STATE_NAME[a.state] ?? a.state : ''},${a?.pos ?? ''},${a?.speed ?? ''},${b ? STATE_NAME[b.state] ?? b.state : ''},${b?.pos ?? ''},${b?.speed ?? ''},${gapRaw},${gapSkew}\n`);
  if (++n % 20 === 0) console.error(`tick ${n}: A=${a ? a.state + '@' + a.pos : 'none'} B=${b ? b.state + '@' + b.pos : 'none'} gap_skew=${gapSkew}`);
  const spent = Date.now() - ts;
  sleep(INTERVAL - spent);
}
closeSync(out);
console.error(`done: ${n} ticks -> ${OUT}`);
