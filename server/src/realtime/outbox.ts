/** 出站预算：所有发送（含错误）共同计费，完成 / 关闭 / 抛错只释放一次。 */
export const MAX_BUFFERED_BYTES = 128 * 1024;
export const MAX_PENDING_BYTES = 512 * 1024;
export const MAX_GLOBAL_PENDING_BYTES = 64 * 1024 * 1024;
export const SNAPSHOT_CHUNK_BYTES = 32 * 1024;
export type GlobalPending = { count: number };
export type SendSocket = { readyState: number; bufferedAmount: number; send: (data: string, cb?: (err?: Error | null) => void) => void; close: (code: number, reason: string) => void };
type Frame = { json: string; bytes: number };
type Batch = { kind: string; frames: Frame[]; started: boolean };
export type Sender = ((data: unknown) => void) & { dispose: () => void; flush: () => void };
let snapshotCounter = 0;

/** 按完整包封装后的 UTF-8 字节分块；保守预留最大块编号，不漏 envelope 开销。 */
export function snapshotFrames(snapshot: Record<string, unknown>): Record<string, unknown>[] {
  const field = snapshot.type === 'queue.state' ? 'entries' : 'messages';
  const entries = snapshot[field] as unknown[];
  const snapshotId = `${Date.now().toString(36)}-${(++snapshotCounter).toString(36)}`;
  const head = { ...snapshot, [field]: [], snapshotId, chunkIndex: 99, chunkCount: 100 };
  const headerBytes = Buffer.byteLength(JSON.stringify(head));
  const chunks: unknown[][] = [];
  let current: unknown[] = [], bytes = headerBytes;
  for (const entry of entries) {
    const entryBytes = Buffer.byteLength(JSON.stringify(entry));
    if (headerBytes + entryBytes > SNAPSHOT_CHUNK_BYTES) throw new Error('单项快照超出传输上限');
    const added = entryBytes + (current.length ? 1 : 0);
    if (current.length && bytes + added > SNAPSHOT_CHUNK_BYTES) { chunks.push(current); current = []; bytes = headerBytes; }
    bytes += entryBytes + (current.length ? 1 : 0); current.push(entry);
  }
  chunks.push(current);
  return chunks.map((items, index) => ({ ...snapshot, [field]: items, snapshotId, chunkIndex: index, chunkCount: chunks.length }));
}

/**
 * 单连接有界出站队列：每次仅一帧在途，完成回调驱动后续帧，避免靠 sleep 猜网络。
 * 已开始的快照不可替换；同类尚未开始的快照仅保留最新一份，事件仍按入队顺序发送。
 * flush 可供底层 drain / 注入测试调用；dispose 在 close 时释放全部未完成预算。
 */
export function createSender(socket: SendSocket, globalPending?: GlobalPending): Sender {
  let pending = 0, busy = false, pumping = false, disposed = false;
  const batches: Batch[] = [];
  function account(delta: number) { pending += delta; if (globalPending) globalPending.count += delta; }
  function dispose() {
    if (disposed) return;
    disposed = true; if (globalPending) globalPending.count -= pending;
    pending = 0; batches.length = 0;
  }
  function fail(code = 1013) { dispose(); try { socket.close(code, code === 1013 ? 'slow client' : 'send failed'); } catch {} }
  function flush() {
    if (disposed || pumping || busy) return;
    if (socket.readyState !== 1) { dispose(); return; }
    pumping = true;
    try {
      while (!busy && batches.length && !disposed) {
        if (socket.bufferedAmount > MAX_BUFFERED_BYTES) { fail(); break; }
        const batch = batches[0], frame = batch.frames[0];
        if (socket.bufferedAmount + frame.bytes > MAX_BUFFERED_BYTES) break;
        batch.started = true; batch.frames.shift(); if (!batch.frames.length) batches.shift();
        busy = true;
        let completed = false;
        const done = (error?: Error | null) => {
          if (completed || disposed) return;
          completed = true; account(-frame.bytes); busy = false;
          if (error) fail(1011); else flush();
        };
        try { socket.send(frame.json, done); } catch { done(new Error('send failed')); }
      }
    } finally { pumping = false; }
  }
  const send = ((data: unknown) => {
    if (disposed || socket.readyState !== 1) return;
    let packets: unknown[], kind = '';
    try {
      const object = data as Record<string, unknown>;
      const isSnapshot = object && typeof object === 'object' && !('chunkCount' in object) &&
        ((object.type === 'queue.state' && Array.isArray(object.entries)) || (object.type === 'chat.snapshot' && Array.isArray(object.messages)));
      packets = isSnapshot ? snapshotFrames(object) : [data];
      if (isSnapshot) kind = String(object.type);
      const frames = packets.map(packet => { const json = JSON.stringify(packet); return { json, bytes: Buffer.byteLength(json) }; });
      const replace = kind ? batches.find(batch => !batch.started && batch.kind === kind) : undefined;
      const oldBytes = replace?.frames.reduce((sum, frame) => sum + frame.bytes, 0) ?? 0;
      const bytes = frames.reduce((sum, frame) => sum + frame.bytes, 0);
      if (pending - oldBytes + bytes > MAX_PENDING_BYTES || (globalPending && globalPending.count - oldBytes + bytes > MAX_GLOBAL_PENDING_BYTES)) { fail(); return; }
      account(bytes - oldBytes);
      if (replace) replace.frames = frames;
      else batches.push({ kind, frames, started: false });
      flush();
    } catch { fail(1011); }
  }) as Sender;
  send.dispose = dispose; send.flush = flush;
  return send;
}
