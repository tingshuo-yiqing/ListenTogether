import type { FastifyInstance } from 'fastify';
import { Fault, type Rooms } from '../rooms/store.js';
export function coverRoutes(app: FastifyInstance, rooms: Rooms) {
  // 封面是只读静态字节，按 id+coverVer 缓存；无封面 404 + 错误体与音频路由一致。
  app.get<{ Params: { code: string; id: string } }>('/api/rooms/:code/cover/:id', async (req, reply) => {
    rooms.auth(req.params.code, req.headers.authorization?.replace(/^Bearer /, '') ?? '');
    const track = rooms.tracks.find(t => t.id === req.params.id);
    if (!track) throw new Fault(404, '歌曲不存在');
    if (!track.cover || track.coverVer === null) throw new Fault(404, '该歌曲没有封面');
    reply.header('Cache-Control', 'private, max-age=86400').type(track.cover.mime);
    return reply.send(track.cover.data);
  });
}
