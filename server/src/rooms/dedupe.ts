import { Fault } from './store.js';
import { createHash } from 'node:crypto';

/**
 * v2 操作去重（协议见 docs/protocol.md「操作去重」）：键 = 房间+成员+操作ID，
 * 指纹含 type/issuedAtMs/规范化输入。同 ID 重试返回原结果（含确定性业务失败），
 * 同 ID 异参 409 IDEMPOTENCY_CONFLICT；过期 409 REQUEST_EXPIRED，绝不重新执行。
 * 未过期记录不因容量压力提前淘汰；满时拒绝**新**操作（429 DEDUP_CAPACITY，无副作用）。
 * 时基不倒退：服务端时间回拨不会复活已淘汰的过期请求（不影响播放校时公式）。
 */
export const REQUEST_TTL_MS = 10 * 60_000;
export const FUTURE_SKEW_MS = 30_000;
export const ROOM_RECORD_LIMIT = 10_000;
export const GLOBAL_BYTE_LIMIT = 64 * 1024 * 1024;
export const ROOM_BYTE_LIMIT = 4 * 1024 * 1024;
/** 紧凑确认结果上界；先预留再执行业务，提交后按序列化字节缩减。 */
const MAX_OUTCOME_BYTES = 4096, RECORD_OVERHEAD_BYTES = 128;

export type DedupeOutcome = { ok: true; result: Record<string, unknown> } | { ok: false; status: number; message: string; code?: string };

type DedupeRecord = { fingerprint: string; expiresAtMs: number; outcome: DedupeOutcome | null; bytes: number };

export type DedupeTicket = { replay: { outcome: DedupeOutcome; expiresAtMs: number } | null; commit: (outcome: DedupeOutcome) => number; cancel: () => void };

export class DedupeStore {
  private rooms = new Map<string, Map<string, DedupeRecord>>();
  private globalBytes = 0;
  private roomBytes = new Map<string, number>();
  private lastNow = 0;

  constructor(private readonly nowSrc: () => number = Date.now, private readonly byteLimit = GLOBAL_BYTE_LIMIT) {}

  /** 不倒退的服务端时基：仅用于操作有效期判定，与播放校时的 now() 分开。 */
  private now(): number {
    this.lastNow = Math.max(this.lastNow, this.nowSrc());
    return this.lastNow;
  }

  /**
   * 首次接收：校验时间窗、预留容量，返回 commit 句柄（必须在同一同步临界区提交业务结果）。
   * 重试：命中未过期记录时按指纹比对，相同则回放原结果，不同则 409。
   * 抛出的 Fault 均无副作用；解析错误/限频在进入本方法前处理，不占结果槽位。
   */
  begin(code: string, memberId: string, requestId: string, issuedAtMs: number, fingerprint: string): DedupeTicket {
    if (!Number.isSafeInteger(issuedAtMs)) throw new Fault(400, 'issuedAtMs 无效');
    const now = this.now();
    const room = this.room(code, now);
    const key = `${memberId}:${requestId}`;
    const digest = createHash('sha256').update(fingerprint).digest('hex');
    const existing = room.get(key);
    if (existing && existing.expiresAtMs > now) {
      if (existing.fingerprint !== digest) throw new Fault(409, '同一操作 ID 携带了不同输入', 'IDEMPOTENCY_CONFLICT');
      if (!existing.outcome) throw new Fault(409, '操作正在处理，请稍后核对', 'REQUEST_PENDING');
      return { replay: { outcome: existing.outcome, expiresAtMs: existing.expiresAtMs }, commit: () => existing.expiresAtMs, cancel: () => {} };
    }
    if (issuedAtMs > now + FUTURE_SKEW_MS) throw new Fault(400, '操作时间超前，请先校时');
    if (issuedAtMs + REQUEST_TTL_MS <= now) throw new Fault(409, '操作已过期，请核对当前状态后重试', 'REQUEST_EXPIRED');
    const expiresAtMs = issuedAtMs + REQUEST_TTL_MS;
    const baseBytes = Buffer.byteLength(JSON.stringify({ key, fingerprint: digest, expiresAtMs })) + RECORD_OVERHEAD_BYTES;
    const bytes = baseBytes + MAX_OUTCOME_BYTES;
    // 全服压力下先清理其他活跃房间的过期记录，闲置房间不应永久占用新操作预算。
    if (this.globalBytes + bytes > this.byteLimit) for (const roomCode of this.rooms.keys()) this.room(roomCode, now);
    if (room.size >= ROOM_RECORD_LIMIT || this.globalBytes + bytes > this.byteLimit || (this.roomBytes.get(code) ?? 0) + bytes > ROOM_BYTE_LIMIT) {
      throw new Fault(429, '去重记录容量已满，请稍后重试', 'DEDUP_CAPACITY');
    }
    const record: DedupeRecord = { fingerprint: digest, expiresAtMs, outcome: null, bytes };
    room.set(key, record); this.adjust(code, bytes);
    const cancel = () => { if (room.get(key) === record && record.outcome === null) this.releaseRecord(code, room, key, record); };
    return {
      replay: null, cancel,
      commit: outcome => {
        if (this.rooms.get(code) !== room || room.get(key) !== record) throw new Fault(409, '操作预留已释放', 'REQUEST_EXPIRED');
        if (record.outcome !== null) return expiresAtMs;
        const outcomeBytes = Buffer.byteLength(JSON.stringify(outcome));
        if (outcomeBytes > MAX_OUTCOME_BYTES) { cancel(); throw new Fault(500, '确认结果超出契约上限'); }
        this.adjust(code, baseBytes + outcomeBytes - record.bytes);
        record.bytes = baseBytes + outcomeBytes; record.outcome = outcome;
        return expiresAtMs;
      }
    };
  }

  /** 房间销毁时释放计数；重复调用安全。 */
  release(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const record of room.values()) this.globalBytes -= record.bytes;
    this.rooms.delete(code);
    this.roomBytes.delete(code);
  }

  stats() { return { records: [...this.rooms.values()].reduce((n, m) => n + m.size, 0), bytes: this.globalBytes }; }

  private room(code: string, now: number): Map<string, DedupeRecord> {
    let room = this.rooms.get(code);
    if (!room) { room = new Map(); this.rooms.set(code, room); return room; }
    for (const [key, record] of room) if (record.expiresAtMs <= now) this.releaseRecord(code, room, key, record); // 惰性清理过期记录
    return room;
  }

  private adjust(code: string, delta: number) { this.globalBytes += delta; this.roomBytes.set(code, (this.roomBytes.get(code) ?? 0) + delta); }
  private releaseRecord(code: string, room: Map<string, DedupeRecord>, key: string, record: DedupeRecord): void {
    room.delete(key);
    this.adjust(code, -record.bytes);
  }
}
