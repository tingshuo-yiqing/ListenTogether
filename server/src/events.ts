/**
 * 结构化排障事件。
 * 字段只允许携带房间码、成员 ID、曲目 ID 等非敏感标识：**禁止写入 Authorization 头、成员令牌与昵称**，
 * 事件最终会进入生产日志（server 启动时 logger=true），任何令牌泄漏都等于房间被接管。
 * 事件名用 `领域.动作` 形式，便于按前缀过滤（room.* / member.* / host.* / ws.*）。
 *
 * 唯一例外：`room.created` 携带 `creatorIp`（建房来源 IP）。理由：建房配额是**按来源 IP 计数**的
 * （同一 IP 同时最多 3 个活跃房间），2026-09-27 排查"配额为什么满"时日志里没有 IP、只能靠时间线反推，
 * 因此把它明确纳入事件。IP 只用于排障，不下发给客户端、不参与身份判定；除该字段外仍不得新增任何
 * 令牌/昵称/请求头类字段。
 */
export type ServerEvent = { event: string } & Record<string, unknown>;
export type EventSink = (event: ServerEvent) => void;
