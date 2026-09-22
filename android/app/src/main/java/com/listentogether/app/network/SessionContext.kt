package com.listentogether.app.network

/**
 * 一个加入会话的不可变上下文：服务地址、成员身份与代次。
 *
 * 所有权：RoomClient 只持有一个“当前会话”；join 成功时创建，leave 或身份失效后作废。
 * 每个请求与 WebSocket 回调在创建时捕获当时的 [SessionContext]，
 * 返回前必须核对 [generation] 仍等于当前代次，否则视为旧会话的迟到结果并丢弃，
 * 防止旧房间的响应或关闭事件影响新会话（例如退出 A 服务器后立即加入 B）。
 * 线程约定：本类不可变，可跨线程安全读取；token 只存在于内存，不落盘、不写入任何日志。
 */
data class SessionContext(
    val baseUrl: String,
    val credentials: Credentials,
    val generation: Int
)
