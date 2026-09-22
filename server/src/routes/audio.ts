import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { Fault, type Rooms } from '../rooms/store.js';
export function audioRoutes(app: FastifyInstance, rooms: Rooms) {
  app.get<{ Params: { code: string; id: string } }>('/api/rooms/:code/audio/:id', async (req, reply) => {
    rooms.auth(req.params.code, req.headers.authorization?.replace(/^Bearer /, '') ?? '');
    const track = rooms.tracks.find(t => t.id === req.params.id);
    if (!track) throw new Fault(404, '歌曲不存在');
    const info = await stat(track.path).catch(() => { throw new Fault(404, '音乐文件缺失，请联系管理员'); });
    const size = info.size;
    reply.header('Accept-Ranges', 'bytes').header('Cache-Control', 'private, no-store').type('audio/mpeg');
    const range = req.headers.range;
    if (!range) return reply.header('Content-Length', size).send(createReadStream(track.path));
    // 只接受单段范围；后缀范围 bytes=-500 同样支持，不能把非法输入交给文件流。
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = 0, end = size - 1;
    if (match && (match[1] || match[2])) {
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    } else start = size;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1).send(createReadStream(track.path, { start, end }));
  });
}
