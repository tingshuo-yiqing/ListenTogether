import type { FastifyInstance } from 'fastify';
import { Fault, type Rooms } from '../rooms/store.js';
import type { EventSink } from '../events.js';
import { WindowLimiter } from './limits.js';

/**
 * 握手限连：同一"成员令牌 + 来源 IP"在 10 秒内最多 5 次升级请求。
 * 客户端退避重连节奏为 1/2/4/8/16 秒（协议约定），任一 10 秒窗口内最多 4 次，阈值 5 不会误伤正常重连。
 * 只在鉴权通过后计数：无效令牌在 auth 处直接 401，伪造成本不进限流键空间。
 */
export const HANDSHAKE_LIMIT = { max: 5, windowMs: 10_000 };
/** 心跳分两轮：本轮发 ping，下一轮仍无 pong 才 terminate（15 秒粒度，客户端需回 pong）。 */
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** 发送缓冲超过该值视为慢客户端，以 1013 关闭，避免内存被单个连接堆积。 */
export const MAX_BUFFERED_BYTES = 128 * 1024;

/** 发送所需的最小 socket 面（便于对慢客户端行为做注入式单测）。 */
export type SendSocket = { readyState: number; bufferedAmount: number; send: (data: string) => void; close: (code: number, reason: string) => void };
export function createSender(socket: SendSocket) {
  return (data: unknown) => {
    if (socket.readyState !== 1) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) socket.close(1013, 'slow client');
    else socket.send(JSON.stringify(data));
  };
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

export function socketRoutes(app: FastifyInstance, rooms: Rooms, stats: RealtimeStats, events?: EventSink) {
  const handshakes = new WindowLimiter(HANDSHAKE_LIMIT.max, HANDSHAKE_LIMIT.windowMs);
  app.get<{ Params: { code: string } }>('/ws/:code', {
    websocket: true,
    preValidation: async req => {
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      rooms.auth(req.params.code, token);
      if (handshakes.hit(`${req.ip}|${token}`)) {
        events?.({ event: 'ws.handshake_rejected', code: req.params.code, ip: req.ip });
        throw new Fault(429, '连接过于频繁，请稍后重试');
      }
    }
  }, (socket, req) => {
    const token = req.headers.authorization!.replace(/^Bearer /, '');
    const send = createSender(socket);
    const disconnect = rooms.connect(req.params.code, token, send, () => socket.close(1000, 'replaced or left'));
    stats.wsConnections += 1;
    // 每连接每秒 20 条消息：窗口随连接存在，超限只回 error 帧，不断开连接。
    let windowAt = Date.now(), count = 0;
    const heartbeat = startHeartbeat(socket);
    socket.on('pong', heartbeat.pong);
    socket.on('close', () => { heartbeat.stop(); stats.wsConnections -= 1; disconnect(); });
    socket.on('error', () => socket.terminate());
    socket.on('message', data => {
      try {
        if (Date.now() - windowAt >= 1000) { windowAt = Date.now(); count = 0; }
        if (++count > 20) throw new Fault(429, '操作过于频繁');
        const message = JSON.parse(data.toString());
        if (message.type === 'sync') {
          send({ type: 'clock', clientTimeMs: message.clientTimeMs, serverTimeMs: rooms.now() });
          send(rooms.snapshot(rooms.get(req.params.code)));
        } else if (message.type === 'command') rooms.command(req.params.code, token, message);
        else throw new Fault(400, '未知消息');
      } catch (error) { send({ type: 'error', status: error instanceof Fault ? error.statusCode : 400, message: error instanceof Fault ? error.message : '无效 JSON 消息' }); }
    });
  });
}
