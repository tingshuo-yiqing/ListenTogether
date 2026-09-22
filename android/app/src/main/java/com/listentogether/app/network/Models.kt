package com.listentogether.app.network

import org.json.JSONObject

data class Track(val id: String, val title: String, val durationMs: Long)
data class Credentials(val code: String, val memberId: String, val token: String)
data class Member(val id: String, val name: String, val online: Boolean)
data class RoomState(
    val hostId: String, val members: List<Member>, val trackId: String?,
    val playing: Boolean, val positionMs: Long, val timestampMs: Long, val version: Long
) {
    companion object {
        fun parse(json: JSONObject): RoomState {
            val list = json.getJSONArray("members")
            return RoomState(json.getString("hostId"), (0 until list.length()).map {
                val m = list.getJSONObject(it); Member(m.getString("id"), m.getString("name"), m.getBoolean("online"))
            }, if (json.isNull("trackId")) null else json.getString("trackId"), json.getBoolean("playing"),
                json.getLong("positionMs"), json.getLong("timestampMs"), json.getLong("version"))
        }
    }
}
/**
 * 明确的连接状态机，替代旧 busy/connected 两个布尔的组合推断。
 * 正常流转：Idle → Joining → Connecting → Calibrating → Ready。
 * 异常：连接断开进入 Reconnecting（可手动重试）；身份失效进入 Expired（须退出后重新加入）；用户退出回 Idle。
 * 本地暂停不是连接状态，不在本枚举内；断线恢复不得清除用户暂停。
 */
enum class ConnectionStatus { Idle, Joining, Connecting, Calibrating, Ready, Reconnecting, Expired }

data class UiState(
    val status: ConnectionStatus = ConnectionStatus.Idle, val message: String = "",
    val credentials: Credentials? = null, val tracks: List<Track> = emptyList(), val room: RoomState? = null,
    val locallyPaused: Boolean = false, val positionMs: Long = 0
) {
    /** 入房请求进行中；旧 busy 标志的唯一来源。 */
    val busy: Boolean get() = status == ConnectionStatus.Joining
    /** Socket 已打开（校时中或已就绪），允许发送房间指令；校时未就绪仍不能播放。 */
    val connected: Boolean get() = status == ConnectionStatus.Calibrating || status == ConnectionStatus.Ready
}
