import { randomBytes, randomUUID } from 'node:crypto';
import type { Track } from '../library/catalog.js';
import { toSummary, type TrackSummary } from '../library/catalog-index.js';
import { CoverCache } from '../library/cover-cache.js';
import type { EventSink, ServerEvent } from '../events.js';
import { DedupeStore } from './dedupe.js';
import { availableAvatar, type AvatarId } from './avatars.js';

export class Fault extends Error { constructor(public statusCode: number, message: string, public code?: string) { super(message); } }
export type Member = { id: string; name: string; avatarId: AvatarId; token: string; joinedAt: number; offlineAt: number; send?: (data: unknown) => void; close?: () => void };
/** 队列条目：点歌人快照随条目保留（离房不清点歌）；entryId 是服务端确认后的条目身份。 */
export type QueueEntry = {
  entryId: string; trackId: string;
  requestedBy: string; requestedByName: string; requestedAtMs: number;
  source: 'manual' | 'random';
};
export type ChatMessage = { messageId: string; clientMessageId: string | null; seq: number; senderId: string; senderName: string; senderAvatarId: AvatarId; text: string; createdAtMs: number };
export type Room = {
  code: string; creatorIp: string; hostId: string; members: Member[];
  currentEntry: QueueEntry | null; queue: QueueEntry[]; queueVersion: number;
  chat: ChatMessage[]; chatSeq: number;
  playing: boolean; positionMs: number; timestampMs: number; version: number; emptySince?: number;
};
/** 同一来源 IP 允许同时存在的活跃房间数；房间被 5 分钟空房回收后配额自动释放（不按房间历史累计）。 */
export const IP_ROOM_QUOTA = 3;
const ROOM_LIMIT = 100, MEMBER_LIMIT = 15, MEMBER_GRACE_MS = 60_000, EMPTY_ROOM_MS = 300_000;
/** 待播队列容量与普通成员个人待播配额（设计默认值）；当前曲不计个人配额。 */
export const QUEUE_LIMIT = 100, MEMBER_QUEUE_LIMIT = 5;
/** 聊天：保留窗口 100 条内存消息；限长 500 码点且 UTF-8 ≤2048 字节。 */
export const CHAT_HISTORY_LIMIT = 100, CHAT_TEXT_MAX_CODEPOINTS = 500, CHAT_TEXT_MAX_BYTES = 2048;

export class Rooms {
  rooms = new Map<string, Room>();
  readonly byId: Map<string, Track>;
  readonly dedupe: DedupeStore;
  constructor(public tracks: Track[], public now = Date.now, private readonly events?: EventSink, readonly covers: CoverCache = new CoverCache()) {
    this.byId = new Map(tracks.map(t => [t.id, t]));
    this.dedupe = new DedupeStore(now);
  }
  private emit(event: ServerEvent) { this.events?.(event); }
  nickname(value: unknown) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 24) throw new Fault(400, '昵称应为 1–24 字'); return value.trim(); }
  /** ip 来自 req.ip（trustProxy 仅信任回环，直连不可伪造）；仅用于存量配额与日志，不参与身份判定。 */
  create(name: unknown, ip = '') {
    const nickname = this.nickname(name);
    // 文案要把"怎么恢复"讲清楚：房间空了以后会保留 5 分钟供掉线重连，之后自动回收并释放配额。
    if (this.roomsOf(ip) >= IP_ROOM_QUOTA) {
      throw new Fault(429, `同一来源最多同时创建 ${IP_ROOM_QUOTA} 个房间；空的房间保留 ${EMPTY_ROOM_MS / 60_000} 分钟后自动回收，请稍后重试或使用已有房间`);
    }
    if (this.rooms.size >= ROOM_LIMIT) throw new Fault(503, '房间数量已达上限');
    let code: string; do { code = randomBytes(4).toString('hex').toUpperCase(); } while (this.rooms.has(code));
    // v2：建房从「无当前曲、空队列」开始，不预选全库第一首；首曲入队时提升为当前曲并保持暂停。
    const room: Room = { code, creatorIp: ip, hostId: '', members: [], currentEntry: null, queue: [], queueVersion: 0, chat: [], chatSeq: 0, playing: false, positionMs: 0, timestampMs: this.now(), version: 0, emptySince: this.now() };
    const credentials = this.add(room, nickname); room.hostId = credentials.memberId;
    this.rooms.set(code, room);
    // 事件带 creatorIp：配额是"按来源 IP 计数"的，出问题时必须能从日志直接看出是谁占了额度。
    this.emit({ event: 'room.created', code, hostId: credentials.memberId, creatorIp: ip });
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
    const member: Member = { id: randomUUID(), name: nickname, avatarId: availableAvatar(room.members.map(m => m.avatarId)), token: randomBytes(32).toString('hex'), joinedAt: this.now(), offlineAt: this.now() };
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
    // 无房主时在首个在线快照之前补位；仍在宽限中的房主保留身份。
    if (!room.members.some(m => m.id === room.hostId)) this.transferHost(room, room.members.find(m => m.send)!.id);
    this.broadcast(room);
    this.emit({ event: 'member.online', code: room.code, memberId: member.id });
    // 旧连接的 close 事件不能把替换后的新连接标记为离线。
    return () => { if (member.send === send) { member.send = undefined; member.close = undefined; member.offlineAt = this.now(); this.broadcast(room); this.emit({ event: 'member.offline', code: room.code, memberId: member.id }); } };
  }
  currentTrack(room: Room): Track | undefined { return room.currentEntry ? this.byId.get(room.currentEntry.trackId) : undefined; }
  position(room: Room) {
    const duration = this.currentTrack(room)?.durationMs ?? 0;
    return Math.min(duration, room.positionMs + (room.playing ? Math.max(0, this.now() - room.timestampMs) : 0));
  }
  snapshot(room: Room) {
    const track = this.currentTrack(room);
    return {
      type: 'state', protocol: 2 as const, code: room.code, hostId: room.hostId,
      members: room.members.map(m => ({ id: m.id, name: m.name, avatarId: m.avatarId, online: !!m.send })),
      track: track ? toSummary(track) : null, entryId: room.currentEntry?.entryId ?? null,
      playing: room.playing, positionMs: room.positionMs, timestampMs: room.timestampMs,
      serverNowMs: this.now(), version: room.version,
    };
  }
  /** 逻辑完整队列副本（≤100 条）；传输层统一按实际 JSON 字节分块。 */
  queueSnapshot(room: Room) {
    return {
      type: 'queue.state' as const, serverNowMs: this.now(), queueVersion: room.queueVersion,
      entries: room.queue.map(entry => {
        const track = this.byId.get(entry.trackId);
        return { ...entry, title: track?.title ?? entry.trackId, artist: track?.artist ?? null, durationMs: track?.durationMs ?? 0, hasCover: track?.cover !== undefined && track.cover !== null, coverVer: track?.coverVer ?? null };
      }),
    };
  }
  broadcast(room: Room) { room.version++; const state = this.snapshot(room); room.members.forEach(m => m.send?.(state)); }
  /** 队列广播不递增播放 version（点歌追加不是播放状态变化）；queueVersion 由调用方在状态变更后递增。 */
  private broadcastQueue(room: Room) { const queue = this.queueSnapshot(room); room.members.forEach(m => m.send?.(queue)); }
  /** 播放命令（v2：play/pause/seek；select 已移除，切歌必须走队列）。 */
  command(code: string, token: string, input: unknown) {
    const { room, member } = this.auth(code, token);
    if (room.hostId !== member.id) throw new Fault(403, '只有房主可以控制房间');
    if (!input || typeof input !== 'object') throw new Fault(400, '无效指令');
    const command = input as Record<string, unknown>;
    if (!['play', 'pause', 'seek'].includes(String(command.action))) throw new Fault(400, '未知操作');
    if (!room.currentEntry) throw new Fault(409, '没有正在播放的歌曲，请先点歌', 'NO_CURRENT_TRACK');
    if (command.action === 'seek' && (typeof command.positionMs !== 'number' || !Number.isFinite(command.positionMs) || command.positionMs < 0)) throw new Fault(400, '无效进度');
    const duration = this.currentTrack(room)!.durationMs;
    // 所有状态改变先结算当前位置，再更新时间基准，避免暂停/恢复时累计旧时间。
    room.positionMs = this.position(room); room.timestampMs = this.now();
    if (command.action === 'seek') room.positionMs = Math.min(command.positionMs as number, duration);
    if (command.action === 'play') { if (room.positionMs >= duration) room.positionMs = 0; room.playing = true; }
    if (command.action === 'pause') room.playing = false;
    this.broadcast(room);
  }

  // ---- 队列领域操作：先校验后变更（同一同步临界区，无 await）；业务失败抛 Fault，由传输层连同 requestId 转成 ack ----

  queueAdd(room: Room, member: Member, trackId: string) {
    const track = this.byId.get(trackId);
    if (!track) throw new Fault(404, '歌曲不存在', 'TRACK_NOT_FOUND');
    if (room.currentEntry?.trackId === trackId || room.queue.some(e => e.trackId === trackId)) throw new Fault(409, '该歌曲已在当前播放或待播队列中', 'TRACK_ALREADY_QUEUED');
    if (room.queue.length >= QUEUE_LIMIT) throw new Fault(409, `待播队列已满（${QUEUE_LIMIT} 首）`, 'QUEUE_FULL');
    if (room.hostId !== member.id && room.queue.filter(e => e.requestedBy === member.id).length >= MEMBER_QUEUE_LIMIT) {
      throw new Fault(409, `你最多同时待播 ${MEMBER_QUEUE_LIMIT} 首`, 'MEMBER_QUEUE_LIMIT');
    }
    const entry: QueueEntry = { entryId: randomUUID(), trackId, requestedBy: member.id, requestedByName: member.name, requestedAtMs: this.now(), source: 'manual' };
    const promoted = !room.currentEntry;
    if (promoted) { // 首曲提升为当前曲并保持暂停：positionMs=0、playing=false，房主明确播放后开始
      room.currentEntry = entry; room.positionMs = 0; room.timestampMs = this.now(); room.playing = false;
    } else room.queue.push(entry);
    room.queueVersion++;
    this.emit({ event: 'queue.added', code: room.code, memberId: member.id, entryId: entry.entryId, trackId, promoted });
    if (promoted) this.broadcast(room); // 当前曲变化属播放状态变化，递增 version
    this.broadcastQueue(room);
    return { entryId: entry.entryId, queueVersion: room.queueVersion, promoted };
  }

  /** 随机加入：服务端从完整曲库不放回抽样（同批不重复），候选排除当前曲与待播曲。 */
  queueAddRandom(room: Room, member: Member, count: number) {
    if (count !== 1 && count !== 5) throw new Fault(400, '随机加入数量只能是 1 或 5');
    const used = new Set(room.queue.map(e => e.trackId));
    if (room.currentEntry) used.add(room.currentEntry.trackId);
    const candidates = this.tracks.filter(t => !used.has(t.id));
    const capacityLeft = QUEUE_LIMIT - room.queue.length;
    const quotaLeft = room.hostId === member.id ? Number.MAX_SAFE_INTEGER : MEMBER_QUEUE_LIMIT - room.queue.filter(e => e.requestedBy === member.id).length;
    const addable = Math.min(count, capacityLeft, quotaLeft, candidates.length);
    if (addable <= 0) {
      if (capacityLeft <= 0) throw new Fault(409, `待播队列已满（${QUEUE_LIMIT} 首）`, 'QUEUE_FULL');
      if (quotaLeft <= 0) throw new Fault(409, `你最多同时待播 ${MEMBER_QUEUE_LIMIT} 首`, 'MEMBER_QUEUE_LIMIT');
      throw new Fault(409, '没有可随机加入的候选歌曲', 'NO_RANDOM_CANDIDATES');
    }
    // 不放回抽样：部分 Fisher-Yates，取前 addable 个
    for (let i = 0; i < addable; i++) {
      const j = i + Math.floor(Math.random() * (candidates.length - i));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const picked = candidates.slice(0, addable);
    const entryIds: string[] = [];
    let promoted = false;
    for (const track of picked) {
      const entry: QueueEntry = { entryId: randomUUID(), trackId: track.id, requestedBy: member.id, requestedByName: member.name, requestedAtMs: this.now(), source: 'random' };
      if (!room.currentEntry) { room.currentEntry = entry; room.positionMs = 0; room.timestampMs = this.now(); room.playing = false; promoted = true; }
      else room.queue.push(entry);
      entryIds.push(entry.entryId);
    }
    room.queueVersion++;
    this.emit({ event: 'queue.added', code: room.code, memberId: member.id, entryIds, promoted, source: 'random' });
    if (promoted) this.broadcast(room);
    this.broadcastQueue(room);
    return { addedCount: addable, entryIds, queueVersion: room.queueVersion, promoted };
  }

  queueRemove(room: Room, member: Member, entryId: string) {
    const index = room.queue.findIndex(e => e.entryId === entryId);
    if (index < 0) throw new Fault(404, '条目不存在或已播放');
    const entry = room.queue[index];
    if (room.hostId !== member.id && entry.requestedBy !== member.id) throw new Fault(403, '只能撤回自己的点歌');
    room.queue.splice(index, 1); room.queueVersion++;
    this.emit({ event: 'queue.removed', code: room.code, memberId: member.id, entryId, trackId: entry.trackId });
    this.broadcastQueue(room);
    return { queueVersion: room.queueVersion };
  }

  queueMove(room: Room, member: Member, entryId: string, beforeEntryId: string | null, expectedQueueVersion: number) {
    if (room.hostId !== member.id) throw new Fault(403, '只有房主可以调整队列顺序');
    if (expectedQueueVersion !== room.queueVersion) throw new Fault(409, '队列已被他人更新，请按最新队列重新操作', 'QUEUE_VERSION_CONFLICT');
    const index = room.queue.findIndex(e => e.entryId === entryId);
    if (index < 0) throw new Fault(404, '条目不存在或已播放');
    if (beforeEntryId !== null) {
      if (!room.queue.some(e => e.entryId === beforeEntryId)) throw new Fault(404, '锚点条目不存在');
      if (beforeEntryId === entryId) return { queueVersion: room.queueVersion }; // 移到自己之前 = 无操作
    }
    const [entry] = room.queue.splice(index, 1);
    if (beforeEntryId !== null) {
      // 取出条目后锚点位置可能整体偏移，按最新数组重新定位。
      const adjusted = room.queue.findIndex(e => e.entryId === beforeEntryId);
      room.queue.splice(adjusted < 0 ? room.queue.length : adjusted, 0, entry);
    } else room.queue.push(entry);
    room.queueVersion++;
    this.emit({ event: 'queue.moved', code: room.code, memberId: member.id, entryId, beforeEntryId });
    this.broadcastQueue(room);
    return { queueVersion: room.queueVersion };
  }

  /** 房主跳过：消费队头，保留原播放意图；无当前曲 409。 */
  skipNext(room: Room, member: Member) {
    if (room.hostId !== member.id) throw new Fault(403, '只有房主可以跳过');
    if (!room.currentEntry) throw new Fault(409, '没有正在播放的歌曲', 'NO_CURRENT_TRACK');
    const keepPlaying = room.playing;
    this.consume(room, this.now(), keepPlaying);
    this.emit({ event: 'queue.skipped', code: room.code, memberId: member.id });
    this.broadcast(room);
    this.broadcastQueue(room);
    return { queueVersion: room.queueVersion };
  }

  /** 取下一项：跳过曲目已失效的条目（服务端已知不存在），扫描次数受队列长度上限约束。 */
  private consume(room: Room, now: number, playing: boolean) {
    let next: QueueEntry | null = null;
    let remaining = room.queue.length;
    while (room.queue.length && remaining-- > 0) {
      const head = room.queue.shift()!;
      if (this.byId.has(head.trackId)) { next = head; break; }
      this.emit({ event: 'queue.entry_skipped', code: room.code, entryId: head.entryId, trackId: head.trackId });
    }
    room.currentEntry = next;
    room.positionMs = 0; room.timestampMs = now;
    room.playing = next ? playing : false;
    room.queueVersion++;
  }

  /** 纯文本聊天：服务端生成消息身份与顺序；sender 来自认证成员，客户端不可伪造。 */
  chatSend(room: Room, member: Member, text: string, clientMessageId: string | null = null) {
    if (typeof text !== 'string' || !text.trim()) throw new Fault(400, '消息不能为空');
    if ([...text].length > CHAT_TEXT_MAX_CODEPOINTS) throw new Fault(400, `消息最多 ${CHAT_TEXT_MAX_CODEPOINTS} 个字符`);
    if (Buffer.byteLength(text, 'utf8') > CHAT_TEXT_MAX_BYTES) throw new Fault(400, '消息过长');
    const message: ChatMessage = { messageId: randomUUID(), clientMessageId, seq: ++room.chatSeq, senderId: member.id, senderName: member.name, senderAvatarId: member.avatarId, text, createdAtMs: this.now() };
    room.chat.push(message);
    if (room.chat.length > CHAT_HISTORY_LIMIT) room.chat.shift(); // 环形窗口：超出即从最旧侧截断
    this.emit({ event: 'chat.sent', code: room.code, memberId: member.id, seq: message.seq });
    const frame = { type: 'chat.message' as const, message };
    room.members.forEach(m => m.send?.(frame)); // 逐条事件广播（含发送者，客户端按 messageId 去重）
    return { messageId: message.messageId, seq: message.seq };
  }

  /** 聊天快照（保留窗口全集，取同一时刻的副本，分块发送期间新消息不得混入）；lastSeq 仅用于标注缺口。 */
  chatSnapshot(room: Room, lastSeq?: number) {
    const oldestSeq = room.chat[0]?.seq ?? null;
    return {
      type: 'chat.snapshot' as const, latestSeq: room.chatSeq, oldestSeq,
      // lastSeq < oldestSeq-1 表示客户端缺的中间消息已滑出保留窗口，不可恢复。
      gap: typeof lastSeq === 'number' && oldestSeq !== null && lastSeq < oldestSeq - 1,
      messages: [...room.chat],
    };
  }

  leave(code: string, token: string) {
    const { room, member } = this.auth(code, token); room.members = room.members.filter(m => m !== member); member.close?.();
    this.emit({ event: 'member.left', code, memberId: member.id });
    if (room.hostId === member.id) this.transferHost(room, room.members.find(m => m.send)?.id ?? '');
    this.broadcast(room); // 点歌人离房保留已点歌曲，队列不动
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
        const nextId = room.members.find(m => m.send)?.id ?? '';
        if (nextId !== room.hostId) { this.transferHost(room, nextId); changed = true; }
      }
      const expired = room.members.filter(m => !m.send && now - m.offlineAt >= MEMBER_GRACE_MS);
      if (expired.length) {
        room.members = room.members.filter(m => !expired.includes(m));
        changed = true;
        for (const member of expired) this.emit({ event: 'member.removed', code: room.code, memberId: member.id, reason: 'offline-timeout' });
      }
      if (!room.members.some(m => m.send)) {
        room.emptySince ??= now;
        if (now - room.emptySince >= EMPTY_ROOM_MS) { this.rooms.delete(room.code); this.dedupe.release(room.code); this.emit({ event: 'room.deleted', code: room.code, reason: 'empty-timeout' }); continue; }
      }
      else room.emptySince = undefined;
      // 自然曲终：有有效待播则消费队头继续播放，否则清空当前曲停止（不自动接着全库播放）。
      const duration = this.currentTrack(room)?.durationMs ?? 0;
      if (room.playing && room.currentEntry && this.position(room) >= duration) {
        this.consume(room, now, true);
        this.emit({ event: 'queue.advanced', code: room.code, entryId: room.currentEntry?.entryId ?? null });
        this.broadcast(room);
        this.broadcastQueue(room);
        changed = false; // 已广播
      }
      if (changed) this.broadcast(room);
    }
  }
}

export type { TrackSummary };
