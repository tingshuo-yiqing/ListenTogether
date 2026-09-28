#!/usr/bin/env node
// 一起听歌 · 房主遥控（真机验收辅助工具）
//
// 用途：本地/云端验收时，由电脑侧当房主建房并保持 WS，再下发播放指令，
// 让真机以"成员"身份跟听——用于验证歌词页、进度、切歌等跟听侧行为。
// 房间码与令牌写入文件，供 adb 侧填写房间码（房间码不在手机界面上显示）。
//
// 用法：
//   node scripts/host-remote.mjs --target http://127.0.0.1:3000 --nickname 电脑房主 \
//     --out .workbuddy/host-room.json [--cmds .workbuddy/host-cmds.txt]
//   指令（每行一条）：select <trackId> | play | pause | seek <ms> | resync | status | quit
//
// 两种驱动方式（二选一）：
//   --cmds <文件>  轮询指令文件，只执行新增的行。适合后台任务（后台进程没有 stdin）。
//   不带 --cmds    从 stdin 读指令（前台交互用）。
//
// 行为：连上后每 5 秒发 sync（与真机同节奏），收到 state 落盘一份便于核对。
//   收到 quit 时退出前 DELETE membership，避免占着房主身份。

import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
// 复用后端依赖的 ws 客户端（自动回应服务端 ping，防止被心跳判定离线）。
const require2 = createRequire(pathToFileURL(fileURLToPath(new URL('../server/package.json', import.meta.url))));
const WebSocket = require2('ws');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const TARGET = arg('--target', 'http://127.0.0.1:3000').replace(/\/$/, '');
const NICK = arg('--nickname', '电脑房主');
const OUT = arg('--out', '.workbuddy/host-room.json');
const TRACK = arg('--track', '');
// --join <房间码>：加入已有房间而不是新建（重启遥控器时避免换房间码、真机不用重新入房）
const JOIN = arg('--join', '');

const created = await (await fetch(TARGET + (JOIN ? `/api/rooms/${JOIN}/join` : '/api/rooms'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nickname: NICK }),
})).json();

if (!created.code) {
  console.error('入房失败：' + JSON.stringify(created));
  process.exit(1);
}

const { code, token, memberId } = created;
console.log(`ROOM ${code} memberId=${memberId}`);

const wsUrl = TARGET.replace(/^http/, 'ws') + '/ws/' + code;
const ws = new WebSocket(wsUrl, { headers: { Authorization: 'Bearer ' + token } });

let lastState = null;
let version = 0;

function send(obj) { ws.send(JSON.stringify(obj)); }

ws.on('open', () => {
  console.log('WS 已连接，房主就绪');
  if (TRACK) send({ type: 'command', action: 'select', trackId: TRACK });
  const timer = setInterval(() => {
    if (ws.readyState === 1) send({ type: 'sync', clientTimeMs: Date.now() });
  }, 5000);
  ws.on('close', () => clearInterval(timer));
});

ws.on('message', raw => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (msg.type === 'state') {
    lastState = msg;
    if (msg.version !== version) {
      version = msg.version;
      const me = msg.members.find(m => m.id === memberId);
      console.log(`STATE v${msg.version} track=${msg.trackId} playing=${msg.playing} pos=${Math.round(msg.positionMs)}ms host=${msg.hostId === memberId ? '我' : msg.hostId} members=${msg.members.length} 我在线=${me ? me.online : '?'}`);
    }
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ code, token, memberId, target: TARGET, state: lastState }, null, 2));
  } else if (msg.type === 'error') {
    console.log(`ERROR ${msg.status} ${msg.message}`);
  }
});

ws.on('error', e => console.error('WS 错误: ' + e.message));

function runCmd(line) {
  const [cmd, a] = line.trim().split(/\s+/);
  if (!cmd) return false;
  if (cmd === 'select') send({ type: 'command', action: 'select', trackId: a });
  else if (cmd === 'play' || cmd === 'pause') send({ type: 'command', action: cmd });
  else if (cmd === 'seek') send({ type: 'command', action: 'seek', positionMs: Number(a) });
  else if (cmd === 'resync') send({ type: 'sync', clientTimeMs: Date.now() });
  else if (cmd === 'status') console.log('当前: ' + JSON.stringify(lastState));
  else if (cmd === 'room') console.log('房间码: ' + code);
  else if (cmd === 'quit') { shutdown(); return true; }
  else console.log('未知指令: ' + cmd);
  return false;
}

/** 执行回执：把已执行的指令写到 <cmds>.ack，供外部脚本确认"看到了、发下去了"。
 *  没有它就只能靠服务端状态反推，实测排查成本很高。 */
function ack(line, note) {
  if (!ACK) return;
  try { appendFileSync(ACK, `${new Date().toISOString()}\t${line}\t${note}\n`); } catch { /* 回执失败不影响主流程 */ }
}

async function shutdown() {
  try { ws.close(); } catch {}
  try {
    await fetch(`${TARGET}/api/rooms/${code}/membership`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token },
    });
    console.log('已退出房间');
  } catch (e) { console.error('退出失败: ' + e.message); }
  process.exit(0);
}

const CMDS = arg('--cmds', '');
const ACK = arg('--ack', CMDS ? CMDS + '.ack' : '');
if (CMDS) {
  // 后台模式：轮询指令文件，只执行新增的行（后台任务没有 stdin）。
  // 注意：偏移量必须按"已执行的行数"记，不能按字节记——UTF-8 里字节数与解码后的
  // 码元数不是一回事（BOM 3 字节变 1 字符就会把偏移算错，实测会吃掉行首字符）。
  let done = 0;
  console.log('指令文件模式: ' + CMDS);
  setInterval(() => {
    if (!existsSync(CMDS)) return;
    const lines = readFileSync(CMDS, 'utf8').split(/\r?\n/);
    // 末尾通常是空串（文件以换行结尾），不当作待执行行
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    if (lines.length <= done) {
      if (lines.length < done) done = 0; // 文件被重写变短，重新计
      return;
    }
    for (let i = done; i < lines.length; i++) {
      const l = lines[i].trim();
      console.log('> ' + l);
      ack(l, '已下发');
      if (runCmd(l)) return;
    }
    done = lines.length;
  }, 400);
} else {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', l => { ack(l.trim(), '已下发'); runCmd(l); });
  rl.on('close', () => { console.log('stdin 关闭，退出'); shutdown(); });
}
