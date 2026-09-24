import Fastify, { LogController } from 'fastify';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import { Rooms, Fault } from './rooms/store.js';
import { audioRoutes } from './routes/audio.js';
import { socketRoutes } from './realtime/socket.js';
import type { EventSink } from './events.js';
import type { Track } from './library/catalog.js';
export async function buildApp(tracks: Track[], options: { now?: () => number; timers?: boolean; logger?: boolean } = {}) {
  // 不记录原始请求，防止 Authorization 或后续新增敏感字段进入日志。
  const app = Fastify({ logger: options.logger ?? false, logController: new LogController({ disableRequestLogging: true }), bodyLimit: 4096, trustProxy: process.env.TRUST_PROXY === 'true' ? '127.0.0.1' : false });
  // 排障事件只走结构化字段（见 events.ts）；logger=false 的测试构建下为空操作，不影响断言。
  const events: EventSink = event => app.log.info(event, event.event);
  const realtime = { wsConnections: 0 };
  const rooms = new Rooms(tracks, options.now, events);
  await app.register(rateLimit, { global: false });
  await app.register(websocket, { options: { maxPayload: 4096 } });
  app.setErrorHandler((error, _req, reply) => { const failure = error as { statusCode?: number; message: string }; const status = failure.statusCode ?? 500; if (status >= 500) app.log.error({ message: failure.message }, 'request failed'); reply.code(status).send({ message: status >= 500 ? '服务器内部错误，请查看服务日志' : failure.message }); });
  // 存活检查保持 {ok:true} 兼容现有探活，追加只读计数供排障；计数不代表曲库可用或链路畅通。
  app.get('/health', async () => ({ ok: true, rooms: rooms.rooms.size, onlineMembers: rooms.onlineMembers(), wsConnections: realtime.wsConnections }));
  const limits = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  // 建房按 req.ip 记创建者：单 IP 同时最多 3 个活跃房间（限速不限量的缺口由 Rooms.create 兜底）。
  app.post<{ Body: { nickname?: unknown } }>('/api/rooms', limits, async req => rooms.create(req.body?.nickname, req.ip));
  app.post<{ Params: { code: string }; Body: { nickname?: unknown } }>('/api/rooms/:code/join', limits, async req => rooms.add(rooms.get(req.params.code), req.body?.nickname));
  app.get<{ Params: { code: string } }>('/api/rooms/:code/catalog', async req => { rooms.auth(req.params.code, req.headers.authorization?.replace(/^Bearer /, '') ?? ''); return tracks.map(({ id, title, durationMs }) => ({ id, title, durationMs })); });
  app.delete<{ Params: { code: string } }>('/api/rooms/:code/membership', async req => { rooms.leave(req.params.code, req.headers.authorization?.replace(/^Bearer /, '') ?? ''); return { ok: true }; });
  audioRoutes(app, rooms); socketRoutes(app, rooms, realtime, events);
  const timer = options.timers === false ? undefined : setInterval(() => rooms.tick(), 250);
  timer?.unref(); app.addHook('onClose', async () => { if (timer) clearInterval(timer); });
  return { app, rooms };
}
