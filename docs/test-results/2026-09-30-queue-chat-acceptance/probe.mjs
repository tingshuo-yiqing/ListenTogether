// 独立验收探针：只起随机本地端口和合成领域数据，不操作在用后端/真实曲库。
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import WebSocket from '../../../server/node_modules/ws/wrapper.mjs';
import { buildApp } from '../../../server/dist/app.js';
import { DedupeStore, REQUEST_TTL_MS } from '../../../server/dist/rooms/dedupe.js';

const results = [];
const record = (name, passed, evidence) => results.push({ name, passed, evidence });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate) {
  for (let i = 0; i < 150; i++) { if (predicate()) return; await delay(10); }
  throw new Error('probe timeout');
}
const tracks = Array.from({ length: 102 }, (_, i) => ({
  id: `t${i}`, title: '合成标题'.repeat(45), durationMs: 10000, path: '', size: 10,
  artist: null, cover: null, coverVer: null, lyricsPath: null, lyricsVer: null
}));
const { app, rooms } = await buildApp(tracks, { timers: false });
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const credentials = rooms.create('验收探针');
const { room, member } = rooms.auth(credentials.code, credentials.token);
const received = [];
const socket = new WebSocket(address.replace('http:', 'ws:') + '/ws/' + room.code, {
  headers: { authorization: 'Bearer ' + credentials.token, 'x-listentogether-protocol': '2' }
});
socket.on('message', data => received.push(JSON.parse(data.toString())));
try {
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const invalidId = 'not-a-uuid';
  socket.send(JSON.stringify({ type: 'queue.add', requestId: invalidId, issuedAtMs: Date.now(), trackId: 't0', unexpected: true }));
  await waitFor(() => received.some(x => x.requestId === invalidId));
  const invalidReply = received.find(x => x.requestId === invalidId);
  record('运行时拒绝不符合 schema 的 ID 与额外字段', invalidReply.ok !== true, { accepted: invalidReply.ok === true });

  const versionBefore = room.version;
  const command = { type: 'command', action: 'play', requestId: randomUUID(), issuedAtMs: Date.now() };
  socket.send(JSON.stringify(command)); socket.send(JSON.stringify(command));
  await delay(100);
  record('播放命令复用 ID 去重且返回 ack', room.version - versionBefore === 1 && received.some(x => x.type === 'ack' && x.requestId === command.requestId), {
    versionIncrements: room.version - versionBefore, ackReceived: received.some(x => x.type === 'ack' && x.requestId === command.requestId)
  });

  const ids = Array.from({ length: 6 }, () => randomUUID());
  for (const clientMessageId of ids) socket.send(JSON.stringify({ type: 'chat.send', clientMessageId, issuedAtMs: Date.now(), text: '验收消息' }));
  await waitFor(() => received.some(x => x.type === 'error' && x.status === 429));
  const quotaError = received.find(x => x.type === 'error' && x.status === 429);
  record('聊天限频错误关联 clientMessageId', quotaError.clientMessageId === ids.at(-1), {
    status: quotaError.status, hasClientMessageId: typeof quotaError.clientMessageId === 'string', retryAfterMs: quotaError.retryAfterMs
  });

  for (let i = 1; i <= 100; i++) rooms.queueAdd(room, member, `t${i}`);
  const snapshot = rooms.queueSnapshot(room);
  const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot));
  record('满队列快照按 32KiB 输出分块', snapshotBytes <= 32 * 1024 || 'chunkCount' in snapshot, { entries: snapshot.entries.length, bytes: snapshotBytes, hasChunkCount: 'chunkCount' in snapshot });

  let now = 1000;
  const dedupe = new DedupeStore(() => now);
  const issued = now;
  const id = randomUUID();
  dedupe.begin('expiry', 'member', id, issued, 'same-input').commit({ ok: true, result: {} });
  now = issued + REQUEST_TTL_MS;
  let replayedAtExpiry = false;
  try { const ticket = dedupe.begin('expiry', 'member', id, issued, 'same-input'); replayedAtExpiry = !ticket.replay; } catch { }
  record('恰好到期的重试不重新执行', !replayedAtExpiry, { permitsNewExecutionAtExactExpiry: replayedAtExpiry });

  const bounded = new DedupeStore(() => 1000);
  let capacityRejected = false;
  for (let i = 0; i < 1700; i++) {
    try { bounded.begin('single-room', 'member', randomUUID(), 1000, String(i) + 'x'.repeat(3000)).commit({ ok: true, result: {} }); }
    catch { capacityRejected = true; break; }
  }
  record('去重记录每房间 4MiB 上限', capacityRejected || bounded.stats().bytes <= 4 * 1024 * 1024, { ...bounded.stats(), capacityRejected });

  // 在专用探针进程临时捕捉异常以保存证据；生产 Node 默认会因同一未捕捉异常退出。
  let uncaught = null;
  const catchNull = error => { uncaught = { name: error.name, message: error.message }; };
  process.once('uncaughtException', catchNull);
  socket.send('null');
  await delay(100);
  process.removeListener('uncaughtException', catchNull);
  record('WS JSON null 安全返回错误，不抛未捕捉异常', uncaught === null, { uncaught });
} finally {
  socket.terminate();
  await app.close();
}
const output = { date: '2026-09-30', scope: 'isolated-local-probe', results };
await writeFile(new URL('./probe-results.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}: ${JSON.stringify(result.evidence)}`);
// 未捕捉异常场景可能留下传输库句柄；本探针专用进程在证据写入与服务关闭后退出。
process.exit(results.some(x => !x.passed) ? 1 : 0);
