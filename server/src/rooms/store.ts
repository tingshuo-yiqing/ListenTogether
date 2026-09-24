import { randomBytes, randomUUID } from 'node:crypto';
import type { Track } from '../library/catalog.js';
import type { EventSink, ServerEvent } from '../events.js';

export class Fault extends Error { constructor(public statusCode: number, message: string) { super(message); } }
type Member = { id: string; name: string; token: string; joinedAt: number; offlineAt: number; send?: (data: unknown) => void; close?: () => void };
export type Room = { code: string; creatorIp: string; hostId: string; members: Member[]; trackId: string | null; playing: boolean; positionMs: number; timestampMs: number; version: number; emptySince?: number };
/** 同一来源 IP 允许同时存在的活跃房间数；房间被 5 分钟空房回收后配额自动释放（不按房间历史累计）。 */
export const IP_ROOM_QUOTA = 3;
const ROOM_LIMIT = 100, MEMBER_LIMIT = 15, MEMBER_GRACE_MS = 60_000, EMPTY_ROOM_MS = 300_000;

export class Rooms {
  rooms = new Map<string, Room>();
  constructor(public tracks: Track[], public now = Date.now, private readonly events?: EventSink) {}
  private emit(event: ServerEvent) { this.events?.(event); }
  nickname(value: unknown) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 24) throw new Fault(400, '昵称应为 1–24 字'); return value.trim(); }
  /** ip 来自 req.ip（trustProxy 仅信任回环，直连不可伪造）；仅用于存量配额与日志，不参与身份判定。 */
  create(name: unknown, ip = '') {
    const nickname = this.nickname(name);
    if (this.roomsOf(ip) >= IP_ROOM_QUOTA) throw new Fault(429, `同一来源最多同时创建 ${IP_ROOM_QUOTA} 个房间，请先使用已有房间`);
    if (this.rooms.size >= ROOM_LIMIT) throw new Fault(503, '房间数量已达上限');
    let code: string; do { code = randomBytes(4).toString('hex').toUpperCase(); } while (this.rooms.has(code));
    const room: Room = { code, creatorIp: ip, hostId: '', members: [], trackId: this.tracks[0]?.id ?? null, playing: false, positionMs: 0, timestampMs: this.now(), version: 0, emptySince: this.now() };
    const credentials = this.add(room, nickname); room.hostId = credentials.memberId;
    this.rooms.set(code, room);
    this.emit({ event: 'room.created', code, hostId: credentials.memberId });
    return credentials;
  }
  /** 当前 IP 的活跃房间数（遍历内存房间表，房间被 tick 回收后自然减少）。 */
  roomsOf(ip: string) { let total = 0; for (const room of this.rooms.values()) if (room.creatorIp === ip) total += 1; return total; }
  /** 全服在线成员数（持有 WS 发送回调的成员）。 */
  onlineMembers() { let total = 0; for (const room of this.rooms.values()) for (const member of room.members) if (member.send) total += 1; return total; }
  get(code: string) { const room = this.rooms.get(code); if (!room) throw new Fault(404, '房间不存在或已过期'); return room; }
  add(room: Room, name: unknown) {
    const nickname = this.nickname(name);
    if (room.members.length >= MEMBER_LIMIT) throw new Fault(409, `房间已满（${MEMBER_LIMIT} 人）`);
    const member: Member = { id: randomUUID(), name: nickname, token: randomBytes(32).toString('hex'), joinedAt: this.now(), offlineAt: this.now() };
    room.members.push(member); this.broadcast(room);
    this.emit({ event: 'member.joined', code: room.code, memberId: member.id });
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
    this.emit({ event: 'member.online', code: room.code, memberId: member.id });
    // 旧连接的 close 事件不能把替换后的新连接标记为离线。
    return () => { if (member.send === send) { member.send = undefined; member.close = undefined; member.offlineAt = this.now(); this.broadcast(room); this.emit({ event: 'member.offline', code: room.code, memberId: member.id }); } };
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
    this.emit({ event: 'member.left', code, memberId: member.id });
    if (room.hostId === member.id) this.transferHost(room, room.members.find(m => m.send)?.id ?? '');
    this.broadcast(room);
  }
  private transferHost(room: Room, nextId: string) {
    const from = room.hostId; room.hostId = nextId;
    this.emit({ event: 'host.transferred', code: room.code, from, to: nextId });
  }
  tick() {
    for (const room of this.rooms.values()) {
      const now = this.now(); let changed = false;
      const host = room.members.find(m => m.id === room.hostId);
      if (!host || (!host.send && now - host.offlineAt >= MEMBER_GRACE_MS)) {
        const next = room.members.find(m => m.send);
        if (next && next.id !== room.hostId) { this.transferHost(room, next.id); changed = true; }
      }
      const expired = room.members.filter(m => !m.send && now - m.offlineAt >= MEMBER_GRACE_MS);
      if (expired.length) {
        room.members = room.members.filter(m => !expired.includes(m));
        changed = true;
        for (const member of expired) this.emit({ event: 'member.removed', code: room.code, memberId: member.id, reason: 'offline-timeout' });
      }
      if (!room.members.some(m => m.send)) {
        room.emptySince ??= now;
        if (now - room.emptySince >= EMPTY_ROOM_MS) { this.rooms.delete(room.code); this.emit({ event: 'room.deleted', code: room.code, reason: 'empty-timeout' }); continue; }
      }
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
