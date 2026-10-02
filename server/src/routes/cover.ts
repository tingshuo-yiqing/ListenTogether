import type { FastifyInstance } from 'fastify';
import { Fault, type Rooms } from '../rooms/store.js';
export function coverRoutes(app: FastifyInstance, rooms: Rooms) {
  // 封面按需读取（QC-D）：catalog 只留引用元数据，字节经 CoverCache（32MiB 全服 LRU +
  // 并发受限 + 同资源在途合并）返回；按 id+coverVer 缓存，无封面 404 + 错误体与音频路由一致。
  app.get<{ Params: { code: string; id: string } }>('/api/rooms/:code/cover/:id', async (req, reply) => {
    rooms.auth(req.params.code, req.headers.authorization?.replace(/^Bearer /, '') ?? '');
    const track = rooms.byId.get(req.params.id);
    if (!track) throw new Fault(404, '歌曲不存在');
    if (!track.cover || track.coverVer === null) throw new Fault(404, '该歌曲没有封面');
    // 读取失败（文件被移除/换坏）→ 404；失败不进缓存，文件恢复后无需重启。
    const art = await rooms.covers.get(track);
    if (!art) throw new Fault(404, '封面文件缺失，请联系管理员');
    reply.header('Cache-Control', 'private, max-age=86400').type(art.mime);
    return reply.send(art.data);
  });
}
