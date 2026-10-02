import type { FastifyInstance } from 'fastify';
import { Fault, type Rooms, type Room, type Member } from '../rooms/store.js';
import type { EventSink } from '../events.js';
import { WindowLimiter } from './limits.js';
import { MemberQuotas } from './quotas.js';
import type { Socket } from 'node:net';
import { validClientMessage } from './protocol.js';
import { createSender, type GlobalPending } from './outbox.js';
export { createSender, MAX_BUFFERED_BYTES, MAX_PENDING_BYTES, MAX_GLOBAL_PENDING_BYTES, SNAPSHOT_CHUNK_BYTES } from './outbox.js';
export type { GlobalPending, SendSocket } from './outbox.js';

/**
 * 握手限连：同一"成员令牌 + 来源 IP"在 10 秒内最多 5 次升级请求。
 * 客户端退避重连节奏为 1/2/4/8/16 秒（协议约定），任一 10 秒窗口内最多 4 次，阈值 5 不会误伤正常重连。
 * 只在鉴权通过后计数：无效令牌在 auth 处直接 401，伪造成本不进限流键空间。
 */
export const HANDSHAKE_LIMIT = { max: 5, windowMs: 10_000 };
/** 心跳分两轮：本轮发 ping，下一轮仍无 pong 才 terminate（15 秒粒度，客户端需回 pong）。 */
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** 每连接每秒输入消息硬保护（含未知/重复消息）：超出直接 1008 关闭，是滥用边界而非业务限流。 */
export const INPUT_HARD_LIMIT = { max: 100, windowMs: 1000 };
/** 分类业务配额（滑动窗口，重连不清成员配额）：播放命令 10/s；队列操作 5/10s；sync 类各自 2/s。 */
export const QUOTA_COMMAND = { max: 10, windowMs: 1000 };
export const QUOTA_QUEUE = { max: 5, windowMs: 10_000 };
export const QUOTA_SYNC = { max: 2, windowMs: 1000 };
export const QUOTA_CHAT = { max: 5, windowMs: 10_000 };
/** 分类限流的 429：带 retryAfterMs（协议「分类限流」要求），复用 Fault 管道输出。 */
class QuotaFault extends Fault {
  constructor(message: string, public retryAfterMs: number) { super(429, message, 'RATE_LIMITED'); }
}

export type HeartbeatSocket = { ping: () => void; terminate: () => void };
export type HeartbeatTimers = { setInterval: (handler: () => void, ms: number) => unknown; clearInterval: (handle: unknown) => void };
const systemTimers: HeartbeatTimers = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>)
};
/** 心跳句柄与 socket 同生共死：close 时必须 stop，否则定时器泄漏。 */
export function startHeartbeat(socket: HeartbeatSocket, timers: HeartbeatTimers = systemTimers) {
  let alive = true;
  const handle = timers.setInterval(() => {
    if (!alive) socket.terminate();
    else { alive = false; socket.ping(); }
  }, HEARTBEAT_INTERVAL_MS);
  return { pong: () => { alive = true; }, stop: () => timers.clearInterval(handle) };
}

/** 由传输层维护、/health 只读的连接计数。 */
export type RealtimeStats = { wsConnections: number };

/** 指纹：type + issuedAtMs + 规范化业务输入（重试必须携带完全一致的输入，否则 IDEMPOTENCY_CONFLICT）。 */
function fingerprint(type: string, issuedAtMs: number, input: Record<string, unknown>) {
  return JSON.stringify([type, issuedAtMs, input]);
}

export function socketRoutes(app: FastifyInstance, rooms: Rooms, stats: RealtimeStats, events?: EventSink) {
  const handshakes = new WindowLimiter(HANDSHAKE_LIMIT.max, HANDSHAKE_LIMIT.windowMs);
  const limits = { command: new MemberQuotas(), queue: new MemberQuotas(), sync: new MemberQuotas(), chat: new MemberQuotas() };
  const globalPending: GlobalPending = { count: 0 };
  app.get<{ Params: { code: string } }>('/ws/:code', {
    websocket: true,
    preValidation: async req => {
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      rooms.auth(req.params.code, token);
      if (req.headers['x-listentogether-protocol'] !== '2') throw new Fault(426, '请升级到支持点歌队列的新版本');
      if (handshakes.hit(`${req.ip}|${token}`)) {
        events?.({ event: 'ws.handshake_rejected', code: req.params.code, ip: req.ip });
        throw new Fault(429, '连接过于频繁，请稍后重试');
      }
    }
  }, (socket, req) => {
    const token = req.headers.authorization!.replace(/^Bearer /, '');
    const send = createSender(socket, globalPending);
    const transport = (socket as unknown as { _socket?: Socket })._socket;
    transport?.on('drain', send.flush);
    const disconnect = rooms.connect(req.params.code, token, send, () => socket.close(1000, 'replaced or left'));
    const current = rooms.get(req.params.code);
    send(rooms.queueSnapshot(current)); // 加入/重连恢复队列快照
    send(rooms.chatSnapshot(current)); // 聊天保留窗口快照（≤32KiB 分块）
    // 同类快照在途合并（协议「限流、快照与恢复」5）：合并窗口内的重复 queue.sync/chat.sync
    // 只在事件循环末尾产生一次最新快照，禁止复制堆积；合并期间以最后一次请求的 lastSeq 判缺口。
    const coalesce = { queue: false, chat: false, chatLastSeq: undefined as number | undefined };
    const sendQueueSnapshotCoalesced = (room: Room) => {
      if (coalesce.queue) return;
      coalesce.queue = true;
      setImmediate(() => { coalesce.queue = false; send(rooms.queueSnapshot(room)); });
    };
    const sendChatSnapshotCoalesced = (room: Room, lastSeq?: number) => {
      coalesce.chatLastSeq = lastSeq;
      if (coalesce.chat) return;
      coalesce.chat = true;
      setImmediate(() => { coalesce.chat = false; send(rooms.chatSnapshot(room, coalesce.chatLastSeq)); });
    };
    stats.wsConnections += 1;
    const heartbeat = startHeartbeat(socket);
    socket.on('pong', heartbeat.pong);
    socket.on('close', () => { transport?.off('drain', send.flush); send.dispose(); heartbeat.stop(); stats.wsConnections -= 1; disconnect(); });
    socket.on('error', () => socket.terminate());
    // 输入硬保护：每连接每秒 100 条，超出 1008 关闭（与业务限流分开；连接级滥用边界，重连即清）。
    let windowAt = Date.now(), inputs = 0;
    socket.on('message', data => {
      if (Date.now() - windowAt >= INPUT_HARD_LIMIT.windowMs) { windowAt = Date.now(); inputs = 0; }
      if (++inputs > INPUT_HARD_LIMIT.max) { socket.close(1008, 'too many messages'); return; }
      let message: unknown;
      try { message = JSON.parse(data.toString()); } catch { send({ type: 'error', status: 400, message: '无效 JSON 消息' }); return; }
      try {
        if (!validClientMessage(message)) throw new Fault(400, '消息不符合协议');
        // 每条消息重新鉴权：离房/被移除成员的残留连接立即失效，不能继续操作队列。
        const { room, member } = rooms.auth(req.params.code, token);
        route(room, member, message);
      } catch (error) { report(error, message); }
    });

    function report(error: unknown, input: unknown) {
      const message = input !== null && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
      const fault = error instanceof Fault ? error : null;
      const payload: Record<string, unknown> = { type: 'error', status: fault ? fault.statusCode : 400, message: fault ? fault.message : '无效消息' };
      for (const id of ['requestId', 'clientMessageId']) if (typeof message[id] === 'string' && message[id].length > 0 && message[id].length <= 64) payload[id] = message[id];
      if (fault?.code) payload.code = fault.code;
      if (error instanceof QuotaFault) payload.retryAfterMs = error.retryAfterMs;
      send(payload);
    }

    function route(room: Room, member: Member, message: Record<string, unknown>) {
      const type = String(message.type ?? '');
      const quotaKey = `${room.code}|${member.id}`;
      if (type === 'sync' || type === 'queue.sync') {
        // sync 类无副作用、不占去重；sync 与 queue.sync 各自 2/s。
        const sync = limits.sync.hit(`${quotaKey}|${type}`, QUOTA_SYNC.max, QUOTA_SYNC.windowMs);
        if (sync.limited) throw new QuotaFault('同步过于频繁', sync.retryAfterMs);
        if (type === 'sync') {
          if (typeof message.clientTimeMs !== 'number') throw new Fault(400, 'clientTimeMs 无效');
          send({ type: 'clock', clientTimeMs: message.clientTimeMs, serverTimeMs: rooms.now() });
          send(rooms.snapshot(room));
          send(rooms.queueSnapshot(room)); // 校时响应即答（延迟敏感），不参与快照合并
        } else sendQueueSnapshotCoalesced(room);
        return;
      }
      if (type === 'command') {
        deduped(room, member, message, ['command', Number(message.issuedAtMs), { action: message.action, ...(message.positionMs !== undefined ? { positionMs: message.positionMs } : {}) }], () => {
          const quota = limits.command.hit(quotaKey, QUOTA_COMMAND.max, QUOTA_COMMAND.windowMs);
          if (quota.limited) throw new QuotaFault('操作过于频繁', quota.retryAfterMs);
          rooms.command(room.code, member.token, message);
          return {};
        });
        return;
      }
      if (type === 'skip-next') {
        deduped(room, member, message, ['skip-next', Number(message.issuedAtMs), {}],
          () => { const quota = limits.command.hit(quotaKey, QUOTA_COMMAND.max, QUOTA_COMMAND.windowMs); if (quota.limited) throw new QuotaFault('操作过于频繁', quota.retryAfterMs); return rooms.skipNext(room, member); });
        return;
      }
      if (type === 'queue.add' || type === 'queue.addRandom' || type === 'queue.remove' || type === 'queue.move') {
        // 去重记录检查先于配额：重放回放已缓存确认、不消耗业务配额（协议「操作去重」）。
        const quota = () => { const q = limits.queue.hit(quotaKey, QUOTA_QUEUE.max, QUOTA_QUEUE.windowMs); if (q.limited) throw new QuotaFault('点歌操作过于频繁，请稍后再试', q.retryAfterMs); };
        if (type === 'queue.add') {
          if (typeof message.trackId !== 'string' || !message.trackId) throw new Fault(400, 'trackId 无效');
          deduped(room, member, message, ['queue.add', Number(message.issuedAtMs), { trackId: message.trackId }], () => { quota(); return rooms.queueAdd(room, member, message.trackId as string); });
        } else if (type === 'queue.addRandom') {
          if (message.count !== 1 && message.count !== 5) throw new Fault(400, '随机加入数量只能是 1 或 5');
          deduped(room, member, message, ['queue.addRandom', Number(message.issuedAtMs), { count: message.count }], () => { quota(); return rooms.queueAddRandom(room, member, message.count as 1 | 5); });
        } else if (type === 'queue.remove') {
          if (typeof message.entryId !== 'string' || !message.entryId) throw new Fault(400, 'entryId 无效');
          deduped(room, member, message, ['queue.remove', Number(message.issuedAtMs), { entryId: message.entryId }], () => { quota(); return rooms.queueRemove(room, member, message.entryId as string); });
        } else {
          const beforeEntryId = message.beforeEntryId;
          if (beforeEntryId !== null && (typeof beforeEntryId !== 'string' || !beforeEntryId)) throw new Fault(400, 'beforeEntryId 无效');
          if (!Number.isSafeInteger(message.expectedQueueVersion)) throw new Fault(400, 'expectedQueueVersion 无效');
          deduped(room, member, message,
            ['queue.move', Number(message.issuedAtMs), { entryId: message.entryId, beforeEntryId, expectedQueueVersion: message.expectedQueueVersion }],
            () => { quota(); return rooms.queueMove(room, member, message.entryId as string, beforeEntryId as string | null, message.expectedQueueVersion as number); });
        }
        return;
      }
      if (type === 'chat.send') {
        const clientMessageId = message.clientMessageId;
        if (typeof clientMessageId !== 'string' || !clientMessageId) throw new Fault(400, 'clientMessageId 无效');
        deduped(room, member, message, ['chat.send', Number(message.issuedAtMs), { text: message.text }],
          () => { const quota = limits.chat.hit(`${quotaKey}|chat`, QUOTA_CHAT.max, QUOTA_CHAT.windowMs); if (quota.limited) throw new QuotaFault('发言太频繁，请稍后再试', quota.retryAfterMs); return rooms.chatSend(room, member, message.text as string, clientMessageId); },
          'clientMessageId', clientMessageId);
        return;
      }
      if (type === 'chat.sync') {
        const chatSync = limits.sync.hit(`${quotaKey}|chat.sync`, QUOTA_SYNC.max, QUOTA_SYNC.windowMs);
        if (chatSync.limited) throw new QuotaFault('同步过于频繁', chatSync.retryAfterMs);
        sendChatSnapshotCoalesced(room, typeof message.lastSeq === 'number' ? message.lastSeq : undefined);
        return;
      }
      throw new Fault(400, '未知消息');
    }

    /** 去重包裹：业务失败同样提交为确定性结果（协议「操作去重」）；重排失败额外补发最新队列。idField 区分 requestId / clientMessageId。 */
    function deduped(room: Room, member: Member, message: Record<string, unknown>, fpInput: [string, number, Record<string, unknown>], run: () => Record<string, unknown>, idField: 'requestId' | 'clientMessageId' = 'requestId', idValue?: string) {
      const requestId = idValue ?? message.requestId;
      if (typeof requestId !== 'string' || !requestId) throw new Fault(400, `${idField} 无效`);
      const ticket = rooms.dedupe.begin(room.code, member.id, requestId, Number(message.issuedAtMs), fingerprint(...fpInput));
      if (ticket.replay) { ack(idField, requestId, ticket.replay.outcome, ticket.replay.expiresAtMs); return; }
      let outcome;
      try {
        outcome = { ok: true as const, result: run() };
      } catch (error) {
        // 限频不占去重结果槽位（协议「操作去重」）：直接以错误帧外抛，不提交、无副作用，可原 ID 重试。
        if (error instanceof QuotaFault) { ticket.cancel(); throw error; }
        if (error instanceof Fault) outcome = { ok: false as const, status: error.statusCode, message: error.message, code: error.code };
        else { ticket.cancel(); throw error; }
      }
      const expiresAtMs = ticket.commit(outcome);
      ack(idField, requestId, outcome, expiresAtMs);
      if (!outcome.ok && fpInput[0] === 'queue.move') send(rooms.queueSnapshot(room)); // 失败/冲突后同步最新队列
    }

    function ack(idField: 'requestId' | 'clientMessageId', requestId: string, outcome: { ok: boolean; [k: string]: unknown }, expiresAtMs: number) {
      const payload: Record<string, unknown> = { type: 'ack', [idField]: requestId, ok: outcome.ok, expiresAtMs };
      if (outcome.ok) payload.result = outcome.result;
      else payload.error = { status: outcome.status, message: outcome.message, ...(outcome.code ? { code: outcome.code } : {}) };
      send(payload);
    }
  });
}
