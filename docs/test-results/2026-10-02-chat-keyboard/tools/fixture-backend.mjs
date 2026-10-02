// 隔离的合成曲库实例，仅供本轮 UI 验证；不接触 3000 调试服务和真实 media/。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { buildApp } from '../../../../server/dist/app.js';
import { loadCatalog } from '../../../../server/dist/library/catalog.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const WebSocket = createRequire(resolve(root, 'server/package.json'))('ws');
const { app, rooms } = await buildApp(await loadCatalog(resolve(root, 'demo-media')), { logger: false });
let host;
let room;
let member;
app.get('/__keyboard/state', async () => ({ ...rooms.snapshot(room), messages: rooms.chatSnapshot(room).messages }));
app.post('/__keyboard/play', async () => { rooms.command(host.code, host.token, { action: 'play' }); return { ok: true }; });
app.post('/__keyboard/pause', async () => { rooms.command(host.code, host.token, { action: 'pause' }); return { ok: true }; });
await app.listen({ port: 3002, host: '127.0.0.1' });
host = rooms.create('脚本房主', 'keyboard-fixture');
({ room, member } = rooms.auth(host.code, host.token));
const ws = new WebSocket(`ws://127.0.0.1:3002/ws/${host.code}`, { headers: { Authorization: `Bearer ${host.token}`, 'X-ListenTogether-Protocol': '2' } });
await new Promise((ok, fail) => { ws.once('open', ok); ws.once('error', fail); });
rooms.queueAdd(room, member, 'demo-long');
for (let i = 1; i <= 12; i++) rooms.chatSend(room, member, `聊天布局测试 ${i}：输入时给消息留出更多空间。`);
await writeFile(process.argv[2], JSON.stringify({ code: host.code, trackTitle: rooms.currentTrack(room).title }), 'utf8');
console.log('fixture ready (port 3002, synthetic media only)');
let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
  ws.close();
  rooms.leave(host.code, host.token);
  await app.close();
}
process.stdin.resume();
process.stdin.on('data', () => { void stop(); });
process.stdin.on('end', () => { void stop(); });
