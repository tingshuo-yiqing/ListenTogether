/**
 * 结构化排障事件。
 * 字段只允许携带房间码、成员 ID、曲目 ID 等非敏感标识：**禁止写入 Authorization 头、成员令牌与昵称**，
 * 事件最终会进入生产日志（server 启动时 logger=true），任何令牌泄漏都等于房间被接管。
 * 事件名用 `领域.动作` 形式，便于按前缀过滤（room.* / member.* / host.* / ws.*）。
 */
export type ServerEvent = { event: string } & Record<string, unknown>;
export type EventSink = (event: ServerEvent) => void;
