import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { Fault, type Rooms } from '../rooms/store.js';
export function lyricsRoutes(app: FastifyInstance, rooms: Rooms) {
  // 歌词是库内小文本（上架时已限 ≤256KB），整读返回；no-store——占位/替换频繁，不值得缓存。
  app.get<{ Params: { code: string; id: string } }>('/api/rooms/:code/lyrics/:id', async (req, reply) => {
    rooms.auth(req.params.code, req.headers.authorization?.replace(/^Bearer /, '') ?? '');
    const track = rooms.tracks.find(t => t.id === req.params.id);
    if (!track) throw new Fault(404, '歌曲不存在');
    if (!track.lyricsPath) throw new Fault(404, '该歌曲没有歌词');
    // 路径只来自启动时校验过的曲库条目，不接受任何请求参数拼接。
    const text = await readFile(track.lyricsPath, 'utf8').catch(() => { throw new Fault(404, '歌词文件缺失，请联系管理员'); });
    return reply.header('Cache-Control', 'private, no-store').type('text/plain; charset=utf-8').send(text);
  });
}
