import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Rooms } from '../../../server/dist/rooms/store.js';
import { createSender, MAX_BUFFERED_BYTES, MAX_PENDING_BYTES } from '../../../server/dist/realtime/socket.js';

// 只使用合成领域对象与可控发送器，不连接在用房间、不触碰真实曲库。
const results = [];
const record = (name, passed, evidence) => results.push({ name, passed, evidence });
function makeRoom() {
  const tracks = Array.from({ length: 5 }, (_, i) => ({
    id: `t${i}`, title: `合成曲目${i}`, durationMs: 10_000, path: '', size: 10,
    artist: null, cover: null, coverVer: null, lyricsPath: null, lyricsVer: null
  }));
  const rooms = new Rooms(tracks, () => 1000);
  const credentials = rooms.create('边界验收');
  const { room, member } = rooms.auth(credentials.code, credentials.token);
  for (const track of tracks) rooms.queueAdd(room, member, track.id);
  rooms.command(credentials.code, credentials.token, { action: 'play' });
  return { rooms, room, member };
}

{
  const { rooms, room, member } = makeRoom();
  rooms.skipNext(room, member);
  record('正常下一首保留播放意图', room.currentEntry?.trackId === 't1' && room.playing, {
    currentTrackId: room.currentEntry?.trackId ?? null, playing: room.playing
  });
}
{
  const { rooms, room, member } = makeRoom();
  // 注入设计明确要求处理的「服务端已知失效」状态；不宣称当前版本支持曲库热更新。
  for (const id of ['t1', 't2', 't3']) rooms.byId.delete(id);
  rooms.skipNext(room, member);
  record('连续三个失效条目之后继续播放有效曲', room.currentEntry?.trackId === 't4' && room.playing && room.queue.length === 0, {
    currentTrackId: room.currentEntry?.trackId ?? null, playing: room.playing,
    remaining: room.queue.map(entry => entry.trackId)
  });
}
{
  const { rooms, room, member } = makeRoom();
  for (const id of ['t1', 't2', 't3', 't4']) rooms.byId.delete(id);
  rooms.skipNext(room, member);
  record('所有待播条目失效时完整消费并停止', room.currentEntry === null && !room.playing && room.queue.length === 0, {
    currentTrackId: room.currentEntry?.trackId ?? null, playing: room.playing,
    remaining: room.queue.map(entry => entry.trackId)
  });
}
{
  const globalPending = { count: 0 };
  const socket = { readyState: 1, bufferedAmount: 0, send(_data, callback) { callback?.(); }, close() {} };
  const send = createSender(socket, globalPending);
  send({ type: 'test', text: '正常完成' });
  record('发送完成后全服计数归零', globalPending.count === 0, { globalPendingBytes: globalPending.count });
}
{
  const globalPending = { count: 0 };
  const callbacks = [], closed = [];
  let sentFrames = 0;
  const socket = {
    readyState: 1, bufferedAmount: 0,
    send(data, callback) { this.bufferedAmount += Buffer.byteLength(data); sentFrames++; callbacks.push(callback); },
    close(code, reason) { closed.push({ code, reason }); this.readyState = 2; }
  };
  const send = createSender(socket, globalPending);
  const frames = Array.from({ length: 7 }, (_, index) => ({
    type: 'chat.snapshot', snapshotId: 'slow-probe', chunkIndex: index, chunkCount: 7,
    text: 'x'.repeat(30_000)
  }));
  const logicalSnapshotBytes = frames.reduce((sum, frame) => sum + Buffer.byteLength(JSON.stringify(frame)), 0);
  for (const frame of frames) send(frame);
  const pendingAtClose = globalPending.count;
  // 模拟网络恢复，验证计费能回收；快照剩余块是否继续发送由发送器负责。
  socket.bufferedAmount = 0;
  for (const callback of callbacks) callback?.();
  record('容量内分块快照遇慢写时等待发送完成而非提前关闭', closed.length === 0 && sentFrames === frames.length, {
    logicalSnapshotBytes, applicationLimitBytes: MAX_PENDING_BYTES, socketLimitBytes: MAX_BUFFERED_BYTES,
    sentFrames, totalFrames: frames.length, closed, pendingAtClose,
    globalPendingAfterCallbacks: globalPending.count,
    method: '可控发送器延迟 callback，验证调度；并非真实 TCP 速度测量'
  });
}

const paths = [
  'server/src/rooms/store.ts', 'server/dist/rooms/store.js',
  'server/src/realtime/socket.ts', 'server/dist/realtime/socket.js'
];
const hashes = {};
for (const path of paths) {
  const bytes = await readFile(new URL('../../../' + path, import.meta.url));
  hashes[path] = createHash('sha256').update(bytes).digest('hex');
}
await writeFile(new URL('./extended-probe-results.json', import.meta.url), JSON.stringify({
  capturedAt: new Date().toISOString(), scope: 'isolated-domain-and-sender-injection', hashes, results
}, null, 2) + '\n');
for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}: ${JSON.stringify(result.evidence)}`);
process.exitCode = results.some(result => !result.passed) ? 1 : 0;
