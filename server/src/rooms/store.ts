import { randomBytes, randomUUID } from 'node:crypto';
import type { Track } from '../library/catalog.js';

export class Fault extends Error { constructor(public statusCode: number, message: string) { super(message); } }
type Member = { id: string; name: string; token: string; joinedAt: number; offlineAt: number; send?: (data: unknown) => void; close?: () => void };
export type Room = { code: string; hostId: string; members: Member[]; trackId: string | null; playing: boolean; positionMs: number; timestampMs: number; version: number; emptySince?: number };
export class Rooms {
  rooms = new Map<string, Room>();
  constructor(public tracks: Track[], public now = Date.now) {}
  nickname(value: unknown) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 24) throw new Fault(400, '昵称应为 1–24 字'); return value.trim(); }
  create(name: unknown) {
    if (this.rooms.size >= 100) throw new Fault(503, '房间数量已达上限');
    let code: string; do { code = randomBytes(4).toString('hex').toUpperCase(); } while (this.rooms.has(code));
    const room: Room = { code, hostId: '', members: [], trackId: this.tracks[0]?.id ?? null, playing: false, positionMs: 0, timestampMs: this.now(), version: 0, emptySince: this.now() };
    const credentials = this.add(room, name); room.hostId = credentials.memberId;
    this.rooms.set(code, room); return credentials;
  }
  get(code: string) { const room = this.rooms.get(code); if (!room) throw new Fault(404, '房间不存在或已过期'); return room; }
  add(room: Room, name: unknown) {
    const nickname = this.nickname(name);
    if (room.members.length >= 15) throw new Fault(409, '房间已满（15 人）');
    const member: Member = { id: randomUUID(), name: nickname, token: randomBytes(32).toString('hex'), joinedAt: this.now(), offlineAt: this.now() };
    room.members.push(member); this.broadcast(room);
    return { code: room.code, memberId: member.id, token: member.token };
  }
  auth(code: string, token: string) {
    const room = this.get(code); const member = room.members.find(m => m.token === token);
    if (!member) throw new Fault(401, '成员令牌无效，请重新加入'); return { room, member };
  }
  connect(code: string, token: string, send: Member['send'], close: () => void) {
    const { room, member } = this.auth(code, token);
    member.close?.(); member.send = send; member.close = close; room.emptySince = undefined;
    this.broadcast(room);
    // 旧连接的 close 事件不能把替换后的新连接标记为离线。
    return () => { if (member.send === send) { member.send = undefined; member.close = undefined; member.offlineAt = this.now(); this.broadcast(room); } };
  }
  position(room: Room) { const duration = this.tracks.find(t => t.id === room.trackId)?.durationMs ?? 0; return Math.min(duration, room.positionMs + (room.playing ? Math.max(0, this.now() - room.timestampMs) : 0)); }
  snapshot(room: Room) { return { type: 'state', code: room.code, hostId: room.hostId, members: room.members.map(m => ({ id: m.id, name: m.name, online: !!m.send })), trackId: room.trackId, playing: room.playing, positionMs: room.positionMs, timestampMs: room.timestampMs, serverNowMs: this.now(), version: room.version }; }
  broadcast(room: Room) { room.version++; const state = this.snapshot(room); room.members.forEach(m => m.send?.(state)); }
  command(code: string, token: string, input: unknown) {
    const { room, member } = this.auth(code, token);
    if (room.hostId !== member.id) throw new Fault(403, '只有房主可以控制房间');
    if (!input || typeof input !== 'object') throw new Fault(400, '无效指令');
    const command = input as Record<string, unknown>;
    if (!['play', 'pause', 'seek', 'select'].includes(String(command.action))) throw new Fault(400, '未知操作');
    let selected: Track | undefined;
    if (command.action === 'select') { selected = this.tracks.find(t => t.id === command.trackId); if (!selected) throw new Fault(404, '歌曲不存在'); }
    if (command.action === 'seek' && (typeof command.positionMs !== 'number' || !Number.isFinite(command.positionMs) || command.positionMs < 0)) throw new Fault(400, '无效进度');
    if (!room.trackId && !selected) throw new Fault(409, '曲库为空，请先上传音乐');
    // 所有状态改变先结算当前位置，再更新时间基准，避免暂停/恢复时累计旧时间。
    room.positionMs = this.position(room); room.timestampMs = this.now();
    if (selected) { room.trackId = selected.id; room.positionMs = 0; }
    if (command.action === 'seek') room.positionMs = Math.min(command.positionMs as number, this.tracks.find(t => t.id === room.trackId)!.durationMs);
    if (command.action === 'play') { if (room.positionMs >= this.tracks.find(t => t.id === room.trackId)!.durationMs) room.positionMs = 0; room.playing = true; }
    if (command.action === 'pause') room.playing = false;
    this.broadcast(room);
  }
  leave(code: string, token: string) {
    const { room, member } = this.auth(code, token); room.members = room.members.filter(m => m !== member); member.close?.();
    if (room.hostId === member.id) room.hostId = room.members.find(m => m.send)?.id ?? '';
    this.broadcast(room);
  }
  tick() {
    for (const room of this.rooms.values()) {
      const now = this.now(); let changed = false;
      const host = room.members.find(m => m.id === room.hostId);
      if (!host || (!host.send && now - host.offlineAt >= 60_000)) {
        const next = room.members.find(m => m.send);
        if (next && next.id !== room.hostId) { room.hostId = next.id; changed = true; }
      }
      const count = room.members.length;
      room.members = room.members.filter(m => m.send || now - m.offlineAt < 60_000);
      changed ||= count !== room.members.length;
      if (!room.members.some(m => m.send)) { room.emptySince ??= now; if (now - room.emptySince >= 300_000) { this.rooms.delete(room.code); continue; } }
      else room.emptySince = undefined;
      const index = this.tracks.findIndex(t => t.id === room.trackId);
      if (room.playing && index >= 0 && this.position(room) >= this.tracks[index].durationMs) {
        const next = this.tracks[index + 1]; room.positionMs = next ? 0 : this.tracks[index].durationMs;
        room.trackId = next?.id ?? room.trackId; room.playing = !!next; room.timestampMs = now; changed = true;
      }
      if (changed) this.broadcast(room);
    }
  }
}
