import type { FastifyInstance } from 'fastify';
import { Fault, type Rooms } from '../rooms/store.js';
export function socketRoutes(app: FastifyInstance, rooms: Rooms) {
  app.get<{ Params: { code: string } }>('/ws/:code', { websocket: true, preValidation: async req => { rooms.auth(req.params.code, req.headers.authorization?.replace(/^Bearer /, '') ?? ''); } }, (socket, req) => {
    const token = req.headers.authorization!.replace(/^Bearer /, '');
    const send = (data: unknown) => { if (socket.readyState === 1) { if (socket.bufferedAmount > 128 * 1024) socket.close(1013, 'slow client'); else socket.send(JSON.stringify(data)); } };
    const disconnect = rooms.connect(req.params.code, token, send, () => socket.close(1000, 'replaced or left'));
    let alive = true, windowAt = Date.now(), count = 0;
    socket.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) socket.terminate(); else { alive = false; socket.ping(); } }, 15_000);
    socket.on('close', () => { clearInterval(heartbeat); disconnect(); });
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
