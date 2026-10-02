package com.listentogether.app.network

import org.json.JSONObject

data class Track(val id: String, val title: String, val durationMs: Long, val artist: String? = null, val hasCover: Boolean = false, val coverVer: Long? = null, val hasLyrics: Boolean = false, val lyricsVer: Long? = null, val album: String? = null) {
    companion object {
        fun parse(json: JSONObject): Track = Track(
            id = json.getString("id"),
            title = json.getString("title"),
            durationMs = json.getLong("durationMs"),
            artist = if (json.isNull("artist")) null else json.optString("artist").takeIf { it.isNotEmpty() },
            hasCover = json.optBoolean("hasCover", false),
            coverVer = if (json.isNull("coverVer")) null else json.optLong("coverVer"),
            hasLyrics = json.optBoolean("hasLyrics", false),
            lyricsVer = if (json.isNull("lyricsVer")) null else json.optLong("lyricsVer"),
            album = (json.opt("album") as? String)?.trim()?.takeIf { it.isNotEmpty() }
        )
    }
}
data class Credentials(val code: String, val memberId: String, val token: String)
/** avatarId 由服务端入房时分配；旧 v2 服务缺字段时保留字素占位，不在客户端猜随机身份。 */
data class Member(val id: String, val name: String, val online: Boolean, val avatarId: String? = null)

/** 待播队列条目：entryId 是服务端确认后的条目身份（同一首歌再次入队是新 entryId）。 */
data class QueueEntry(
    val entryId: String, val trackId: String, val title: String, val artist: String?,
    val durationMs: Long, val hasCover: Boolean, val coverVer: Long?,
    val requestedBy: String, val requestedByName: String, val requestedAtMs: Long, val source: String
) {
    companion object {
        fun parse(json: JSONObject): QueueEntry = QueueEntry(
            entryId = json.getString("entryId"), trackId = json.getString("trackId"),
            title = json.getString("title"),
            artist = if (json.isNull("artist")) null else json.optString("artist").takeIf { it.isNotEmpty() },
            durationMs = json.getLong("durationMs"),
            hasCover = json.optBoolean("hasCover", false),
            coverVer = if (json.isNull("coverVer")) null else json.optLong("coverVer"),
            requestedBy = json.getString("requestedBy"), requestedByName = json.getString("requestedByName"),
            requestedAtMs = json.getLong("requestedAtMs"), source = json.getString("source")
        )
    }
}

/** 已收齐的待播队列快照（有界 ≤100 条）；queueVersion 用于重排的乐观并发控制。 */
data class QueueState(val queueVersion: Long, val entries: List<QueueEntry>) {
    companion object {
        fun parse(json: JSONObject): QueueState {
            val list = json.getJSONArray("entries")
            return QueueState(json.getLong("queueVersion"), (0 until list.length()).map { QueueEntry.parse(list.getJSONObject(it)) })
        }
    }
}

data class RoomState(
    val hostId: String, val members: List<Member>, val track: Track?,
    val playing: Boolean, val positionMs: Long, val timestampMs: Long, val version: Long,
    val entryId: String? = null
) {
    companion object {
        fun parse(json: JSONObject): RoomState {
            val list = json.getJSONArray("members")
            return RoomState(json.getString("hostId"), (0 until list.length()).map {
                val m = list.getJSONObject(it); Member(m.getString("id"), m.getString("name"), m.getBoolean("online"),
                    if (m.isNull("avatarId")) null else m.optString("avatarId").takeIf { value -> value.isNotEmpty() })
            }, if (json.isNull("track")) null else Track.parse(json.getJSONObject("track")), json.getBoolean("playing"),
                json.getLong("positionMs"), json.getLong("timestampMs"), json.getLong("version"),
                if (json.isNull("entryId")) null else json.optString("entryId").takeIf { it.isNotEmpty() })
        }
    }
}

/** 已确认的聊天消息（服务端身份与顺序；seq 房间内连续递增）。 */
data class ChatEntry(val messageId: String, val seq: Long, val senderId: String, val senderName: String, val text: String, val createdAtMs: Long, val clientMessageId: String? = null, val senderAvatarId: String? = null) {
    companion object {
        fun parse(json: JSONObject): ChatEntry = ChatEntry(
            messageId = json.getString("messageId"), seq = json.getLong("seq"),
            senderId = json.getString("senderId"), senderName = json.getString("senderName"),
            text = json.getString("text"), createdAtMs = json.getLong("createdAtMs"),
            clientMessageId = if (json.isNull("clientMessageId")) null else json.optString("clientMessageId").takeIf { it.isNotEmpty() },
            senderAvatarId = if (json.isNull("senderAvatarId")) null else json.optString("senderAvatarId").takeIf { it.isNotEmpty() }
        )
    }
}

/** 本地发送状态：确认超时不等于失败，Confirmed 仍须与服务端消息身份对账。 */
enum class ChatDelivery { Sending, Unconfirmed, Failed, Confirmed }

/**
 * 本地聊天原文与操作身份；重试保留 ID、issuedAtMs（服务端时基毫秒）和 text。
 * retryAtMonoMs / expiresAtMonoMs 使用手机单调时钟毫秒，避免重连校时或墙钟跳变改变等待期限。
 * messageId 只从服务端 ack 的 result 获取，不能由文本推测 seq 或服务端身份。
 */
data class PendingChat(
    val clientMessageId: String, val text: String, val issuedAtMs: Long = 0,
    val delivery: ChatDelivery = ChatDelivery.Sending, val error: String? = null,
    val retryAtMonoMs: Long = 0, val messageId: String? = null,
    val expiresAtMonoMs: Long = Long.MAX_VALUE
)

/** 曲库检索分页结果；revision 供客户端翻页时检测曲库变更（409 CATALOG_CHANGED）。 */
data class CatalogPage(val catalogRevision: String, val total: Int, val offset: Int, val items: List<Track>)

/**
 * 明确的连接状态机，替代旧 busy/connected 两个布尔的组合推断。
 * 正常流转：Idle → Joining → Connecting → Calibrating → Ready。
 * 异常：连接断开进入 Reconnecting（可手动重试）；身份失效进入 Expired（须退出后重新加入）；
 * 服务端过旧/过新（能力探测 404、HTTP/WS 426）进入 Incompatible 终态（v2 兼容矩阵）；用户退出回 Idle。
 * 本地暂停不是连接状态，不在本枚举内；断线恢复不得清除用户暂停。
 */
enum class ConnectionStatus { Idle, Joining, Connecting, Calibrating, Ready, Reconnecting, Expired, Incompatible }

data class UiState(
    val status: ConnectionStatus = ConnectionStatus.Idle, val message: String = "",
    val credentials: Credentials? = null, val queue: QueueState? = null, val room: RoomState? = null,
    val chat: List<ChatEntry> = emptyList(), val chatLatestSeq: Long = 0,
    val chatOldestSeq: Long? = null, val chatGap: Boolean = false,
    val chatSnapshotReceived: Boolean = false, val chatInitialSeq: Long? = null,
    val chatPending: List<PendingChat> = emptyList(),
    /** 首次入房与每次重连能力探测的真实结果；关闭时不开放聊天入口或发送。 */
    val chatEnabled: Boolean = false,
    val queueAdding: Set<String> = emptySet(), val randomAdding: Boolean = false,
    val locallyPaused: Boolean = false, val positionMs: Long = 0
) {
    /** 入房请求进行中；旧 busy 标志的唯一来源。 */
    val busy: Boolean get() = status == ConnectionStatus.Joining
    /** Socket 已打开（校时中或已就绪），允许发送房间指令；校时未就绪仍不能播放。 */
    val connected: Boolean get() = status == ConnectionStatus.Calibrating || status == ConnectionStatus.Ready
}
