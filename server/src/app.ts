import Fastify, { LogController } from 'fastify';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import { Rooms, Fault } from './rooms/store.js';
import { toSummary, CatalogIndex, SearchError, SEARCH_LIMIT_DEFAULT } from './library/catalog-index.js';
import { CoverCache } from './library/cover-cache.js';
import { audioRoutes } from './routes/audio.js';
import { coverRoutes } from './routes/cover.js';
import { lyricsRoutes } from './routes/lyrics.js';
import { socketRoutes } from './realtime/socket.js';
import type { EventSink } from './events.js';
import type { Track } from './library/catalog.js';
export async function buildApp(tracks: Track[], options: { now?: () => number; timers?: boolean; logger?: boolean; coverCacheBytes?: number } = {}) {
  // 不记录原始请求，防止 Authorization 或后续新增敏感字段进入日志。
  const app = Fastify({ logger: options.logger ?? false, logController: new LogController({ disableRequestLogging: true }), bodyLimit: 4096, trustProxy: process.env.TRUST_PROXY === 'true' ? '127.0.0.1' : false });
  // 排障事件只走结构化字段（见 events.ts）；logger=false 的测试构建下为空操作，不影响断言。
  const events: EventSink = event => app.log.info(event, event.event);
  const realtime = { wsConnections: 0 };
  // 封面按需读取 + 全服字节 LRU（QC-D）：默认 32MiB，测试可注入更小上限验证淘汰。
  const covers = new CoverCache(options.coverCacheBytes);
  const rooms = new Rooms(tracks, options.now, events, covers);
  // 事件循环延迟只读诊断（QC-D 负载脚本读数）：累计直方图，ns → ms；Node 24 的直方图无
  // unref，随 app.onClose disable 释放，不阻塞测试进程退出。
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();
  // 检索索引构建一次（QC-A）：房间检索走它；QC-B1 起播放路径也用按 ID 查找。
  const catalogIndex = new CatalogIndex(tracks);
  // v2 能力标志：chat 随 QC-C 打开；客户端按标志显隐功能，不比较日期字符串。
  const capabilities = { protocol: 2 as const, features: { queue: true, catalogSearch: true, chat: true } }; // chat 随 QC-C 打开
  // ▲ 业务端点要求协议头（docs/protocol.md「HTTP」▲ 标记）；缺失/不支持 426，校验先于创建成员。
  const requireProtocol = (req: { headers: Record<string, unknown> }) => {
    if (req.headers['x-listentogether-protocol'] !== '2') throw new Fault(426, '请升级到支持点歌队列的新版本');
  };
  await app.register(rateLimit, { global: false });
  await app.register(websocket, { options: { maxPayload: 4096 } });
  app.setErrorHandler((error, _req, reply) => { const failure = error as { statusCode?: number; message: string; code?: string }; const status = failure.statusCode ?? 500; if (status >= 500) app.log.error({ message: failure.message }, 'request failed'); const body: Record<string, unknown> = { message: status >= 500 ? '服务器内部错误，请查看服务日志' : failure.message }; if (status === 409 && failure.code) body.code = failure.code; reply.code(status).send(body); });
  // 存活检查保持 {ok:true} 兼容现有探活，追加只读计数供排障；计数不代表曲库可用或链路畅通。
  // eventLoop 为累计口径（直方图纳秒 → ms），负载脚本以起止差值读数。
  const loopMs = (p: number) => eventLoop.count > 0 ? Math.round(eventLoop.percentile(p) / 1000) / 1000 : 0;
  app.get('/health', async () => ({ ok: true, rooms: rooms.rooms.size, onlineMembers: rooms.onlineMembers(), wsConnections: realtime.wsConnections, eventLoop: { p50Ms: loopMs(50), p99Ms: loopMs(99), maxMs: Math.round(eventLoop.max / 1000) / 1000 } }));
  // 能力探测：404 表示旧服务端；不暴露成员或路径。
  app.get('/api/capabilities', async () => ({ ...capabilities, serverNowMs: rooms.now() }));
  const limits = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  // 建房按 req.ip 记创建者：单 IP 同时最多 3 个活跃房间（限速不限量的缺口由 Rooms.create 兜底）。
  app.post<{ Body: { nickname?: unknown } }>('/api/rooms', { ...limits, preValidation: async req => requireProtocol(req) }, async req => rooms.create(req.body?.nickname, req.ip));
  app.post<{ Params: { code: string }; Body: { nickname?: unknown } }>('/api/rooms/:code/join', { ...limits, preValidation: async req => requireProtocol(req) }, async req => rooms.add(rooms.get(req.params.code), req.body?.nickname));
  // 旧全量 catalog 保留给诊断脚本迁移（要求 v2 头），新 APK 首屏不整库加载。
  app.get<{ Params: { code: string } }>('/api/rooms/:code/catalog', { preValidation: async req => requireProtocol(req) }, async req => {
    rooms.auth(req.params.code, req.headers.authorization?.replace(/^Bearer /, '') ?? '');
    return tracks.map(toSummary);
  });
  app.delete<{ Params: { code: string } }>('/api/rooms/:code/membership', async req => { rooms.leave(req.params.code, req.headers.authorization?.replace(/^Bearer /, '') ?? ''); return { ok: true }; });
  // 房间内分页检索（QC-A）：与全量 catalog 相同的成员鉴权与公开字段口径，绝不返回路径/字节。
  // 请求带 revision 且与当前不一致 → 409 CATALOG_CHANGED，客户端清页重查；不带则直接返回。
  app.get<{ Params: { code: string }; Querystring: { q?: string; offset?: string; limit?: string; revision?: string } }>(
    '/api/rooms/:code/catalog/search',
    { preValidation: async req => requireProtocol(req) },
    async (req, reply) => {
      rooms.auth(req.params.code, req.headers.authorization?.replace(/^Bearer /, '') ?? '');
      const { q = '', offset = '0', limit = String(SEARCH_LIMIT_DEFAULT), revision } = req.query;
      let result;
      try {
        result = catalogIndex.search(q as string, Number(offset), Number(limit));
      } catch (error) {
        if (error instanceof SearchError) { reply.code(400).send({ message: error.message }); return; }
        throw error;
      }
      if (typeof revision === 'string' && revision !== result.catalogRevision) {
        reply.code(409).send({ message: '曲库已更新，请重新查询', code: 'CATALOG_CHANGED' });
        return;
      }
      return result;
    });
  audioRoutes(app, rooms); coverRoutes(app, rooms); lyricsRoutes(app, rooms); socketRoutes(app, rooms, realtime, events);
  const timer = options.timers === false ? undefined : setInterval(() => rooms.tick(), 250);
  timer?.unref(); app.addHook('onClose', async () => { if (timer) clearInterval(timer); eventLoop.disable(); });
  return { app, rooms };
}
