package com.listentogether.app

import com.listentogether.app.diagnostics.Diagnostics
import com.listentogether.app.network.*
import java.io.File
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import okhttp3.*
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** 独立验收测试，借 init 脚本临时加入测试源集；不修改产品代码或常规测试。 */
@OptIn(ExperimentalCoroutinesApi::class)
class QueueChatAcceptanceProbeTest {
    private val ownId = "11111111-1111-4111-8111-111111111111"
    private val otherId = "22222222-2222-4222-8222-222222222222"
    private fun messageId(seq: Int) = "00000000-0000-4000-8000-${seq.toString().padStart(12, '0')}"
    private class FakeSocket : WebSocket {
        val sent = mutableListOf<String>()
        var acceptChat = true
        override fun request() = Request.Builder().url("http://localhost/").build()
        override fun queueSize() = 0L
        override fun send(text: String): Boolean { sent += text; return acceptChat || JSONObject(text).optString("type") != "chat.send" }
        override fun send(bytes: ByteString) = true
        override fun close(code: Int, reason: String?) = true
        override fun cancel() {}
    }
    private class Factory : WebSocket.Factory {
        val socket = FakeSocket()
        lateinit var listener: WebSocketListener
        override fun newWebSocket(request: Request, listener: WebSocketListener): WebSocket {
            this.listener = listener; return socket
        }
    }
    private object Noop : Diagnostics {
        override fun connection(event: String, roomCode: String?, detail: String) {}
        override fun sync(roomCode: String, trackId: String?, version: Long, rttMs: Long, offsetMs: Long) {}
        override fun playback(roomCode: String?, trackId: String?, version: Long, playerPositionMs: Long, targetPositionMs: Long, driftMs: Long, buffering: Boolean, localPause: Boolean, correction: String, estimatedServerMs: Long) {}
    }
    private fun client(dispatcher: TestDispatcher, factory: Factory, mono: () -> Long = { 1000L }): RoomClient {
        val store = object : ConnectionStore {
            override fun loadBaseUrl() = "http://localhost:3000"
            override fun saveBaseUrl(url: String) {}
        }
        val root = File(System.getProperty("java.io.tmpdir"), "lt-acceptance-probe")
        val transport: HttpTransport = { _, _, _, _ -> """{"code":"12345678","memberId":"$ownId","token":"fake-only"}""" }
        val probe: CapabilityProbe = { 200 to """{"protocol":2,"features":{"queue":true,"catalogSearch":true,"chat":true}}""" }
        return RoomClient(store, Noop, mono, transport, probe, factory, OkHttpClient(), CoverCache(File(root, "covers")), LrcCache(File(root, "lyrics")), dispatcher)
    }
    private fun entry(seq: Int) = JSONObject().put("messageId", messageId(seq)).put("seq", seq)
        .put("senderId", otherId).put("senderName", "probe").put("text", "message-$seq").put("createdAtMs", 3000)
    private fun send(factory: Factory, json: JSONObject) = factory.listener.onMessage(factory.socket, json.toString())
    private fun snapshot(id: String, seq: Int, count: Int = 1) = JSONObject().put("type", "chat.snapshot")
        .put("snapshotId", id).put("chunkIndex", 0).put("chunkCount", count).put("latestSeq", seq)
        .put("oldestSeq", seq).put("gap", false).put("messages", JSONArray().put(entry(seq)))
    private fun connect(client: RoomClient, factory: Factory) {
        client.join("http://localhost:3000", "probe", null)
        factory.listener.onOpen(factory.socket, Response.Builder().request(factory.socket.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK").build())
    }
    private fun ready(client: RoomClient, factory: Factory) {
        connect(client, factory)
        val sync = factory.socket.sent.map(::JSONObject).last { it.optString("type") == "sync" }
        send(factory, JSONObject().put("type", "clock").put("clientTimeMs", sync.getLong("clientTimeMs"))
            .put("serverTimeMs", sync.getLong("clientTimeMs") + 2000))
        assertEquals(ConnectionStatus.Ready, client.state.value.status)
    }
    private fun chatFrames(factory: Factory) = factory.socket.sent.map(::JSONObject).filter { it.optString("type") == "chat.send" }
    private fun failedAck(pending: PendingChat, expiresAt: Long) = JSONObject().put("type", "ack")
        .put("clientMessageId", pending.clientMessageId).put("ok", false).put("expiresAtMs", expiresAt)
        .put("error", JSONObject().put("status", 409).put("message", "验收失败结果"))

    @Test fun liveChatBufferStaysWithin100() = runTest {
        val dispatcher = UnconfinedTestDispatcher(testScheduler); val f = Factory(); val c = client(dispatcher, f)
        try {
            connect(c, f)
            for (seq in 1..101) send(f, JSONObject().put("type", "chat.message").put("message", entry(seq)))
            assertEquals("实时消息也应遵守100条窗口", 100, c.state.value.chat.size)
        } finally { c.leave() }
    }
    @Test fun chatEventDoesNotNotifyPlaybackObserver() = runTest {
        val dispatcher = UnconfinedTestDispatcher(testScheduler); val f = Factory(); val c = client(dispatcher, f)
        try {
            connect(c, f); var calls = 0; c.attachStateObserver { calls++ }
            send(f, JSONObject().put("type", "chat.message").put("message", entry(1)))
            assertEquals("单条聊天不应触发播放服务观察者", 0, calls)
        } finally { c.leave() }
    }
    @Test fun seqGapRequestsChatRecovery() = runTest {
        val dispatcher = UnconfinedTestDispatcher(testScheduler); val f = Factory(); val c = client(dispatcher, f)
        try {
            connect(c, f)
            send(f, JSONObject().put("type", "chat.message").put("message", entry(1)))
            send(f, JSONObject().put("type", "chat.message").put("message", entry(3)))
            assertTrue("缺少seq=2时应请求恢复", f.socket.sent.any { JSONObject(it).optString("type") == "chat.sync" })
        } finally { c.leave() }
    }
    @Test fun snapshotOrderingUsesSeqInsteadOfRandomSuffix() = runTest {
        val dispatcher = UnconfinedTestDispatcher(testScheduler); val f = Factory(); val c = client(dispatcher, f)
        try {
            connect(c, f)
            send(f, snapshot("same-ms-zzzzzz", 1))
            send(f, snapshot("same-ms-aaaaaa", 2))
            assertEquals("随机后缀较小的新快照不能被拒绝", 2L, c.state.value.chatLatestSeq)
        } finally { c.leave() }
    }
    @Test fun missingSnapshotChunkTimesOutAndRecovers() = runTest {
        val dispatcher = UnconfinedTestDispatcher(testScheduler); val f = Factory(); val c = client(dispatcher, f)
        try {
            connect(c, f); send(f, snapshot("incomplete", 1, count = 2))
            advanceTimeBy(5001); runCurrent()
            assertTrue("缺块5秒后应请求恢复", f.socket.sent.any { JSONObject(it).optString("type") == "chat.sync" })
        } finally { c.leave() }
    }

    @Test fun rejectedSocketPreservesOriginalOperationForExplicitRetry() = runTest {
        val d = UnconfinedTestDispatcher(testScheduler); val f = Factory(); val c = client(d, f) { 1000 + testScheduler.currentTime }
        try {
            ready(c, f); f.socket.acceptChat = false
            assertTrue(c.chatSend("原文与emoji🙂\n第二行"))
            val pending = c.state.value.chatPending.single()
            assertEquals(ChatDelivery.Failed, pending.delivery)
            f.socket.acceptChat = true
            assertTrue(c.retryChat(pending.clientMessageId))
            val frames = chatFrames(f)
            assertEquals(2, frames.size)
            for (field in listOf("clientMessageId", "issuedAtMs", "text")) assertEquals(frames[0].get(field), frames[1].get(field))
            assertEquals("原文与emoji🙂\n第二行", c.state.value.chatPending.single().text)
        } finally { c.leave() }
    }

    @Test fun correlatedRateLimitKeepsTextAndHonorsRetryDeadline() = runTest {
        val d = UnconfinedTestDispatcher(testScheduler); val f = Factory(); val c = client(d, f) { 1000 + testScheduler.currentTime }
        try {
            ready(c, f); assertTrue(c.chatSend("等待后重试"))
            val original = c.state.value.chatPending.single()
            send(f, JSONObject().put("type", "error").put("clientMessageId", original.clientMessageId)
                .put("status", 429).put("retryAfterMs", 2000).put("message", "稍后重试"))
            assertEquals(ChatDelivery.Failed, c.state.value.chatPending.single().delivery)
            assertFalse(c.retryChat(original.clientMessageId))
            advanceTimeBy(2000); runCurrent()
            assertTrue(c.retryChat(original.clientMessageId))
            assertEquals(original.text, c.state.value.chatPending.single().text)
            val frames = chatFrames(f)
            assertEquals(frames[0].getLong("issuedAtMs"), frames[1].getLong("issuedAtMs"))
            assertEquals(original.clientMessageId, frames[1].getString("clientMessageId"))
        } finally { c.leave() }
    }

    @Test fun serverShortenedExpiryCannotBeExtendedByRetry() = runTest {
        val d = UnconfinedTestDispatcher(testScheduler); val f = Factory(); val c = client(d, f) { 1000 + testScheduler.currentTime }
        try {
            ready(c, f); assertTrue(c.chatSend("过期仍保留原文"))
            val pending = c.state.value.chatPending.single()
            send(f, failedAck(pending, c.serverNow + 100))
            advanceTimeBy(100); runCurrent()
            assertFalse(c.retryChat(pending.clientMessageId))
            assertEquals(1, chatFrames(f).size)
            assertEquals(pending.text, c.state.value.chatPending.single().text)
        } finally { c.leave() }
    }

    @Test fun successfulAckWithoutBroadcastRecoversAndReconcilesSnapshot() = runTest {
        val d = UnconfinedTestDispatcher(testScheduler); val f = Factory(); val c = client(d, f)
        try {
            ready(c, f); assertTrue(c.chatSend("由快照恢复真实记录"))
            val pending = c.state.value.chatPending.single()
            send(f, JSONObject().put("type", "ack").put("clientMessageId", pending.clientMessageId)
                .put("ok", true).put("expiresAtMs", c.serverNow + 600000)
                .put("result", JSONObject().put("messageId", messageId(1)).put("seq", 1)))
            assertEquals(ChatDelivery.Confirmed, c.state.value.chatPending.single().delivery)
            assertTrue(f.socket.sent.any { JSONObject(it).optString("type") == "chat.sync" })
            send(f, snapshot("recover-1", 1))
            assertTrue(c.state.value.chatPending.isEmpty())
            assertEquals(listOf(messageId(1)), c.state.value.chat.map { it.messageId })
        } finally { c.leave() }
    }

    @Test fun chatConfirmationTimeoutRequestsOneRecoveryWithoutResending() = runTest {
        val d = UnconfinedTestDispatcher(testScheduler); val f = Factory(); val c = client(d, f)
        try {
            ready(c, f); assertTrue(c.chatSend("确认丢失"))
            val original = c.state.value.chatPending.single()
            advanceTimeBy(5001); runCurrent()
            assertEquals(original.text, c.state.value.chatPending.single().text)
            assertEquals(ChatDelivery.Unconfirmed, c.state.value.chatPending.single().delivery)
            assertEquals(1, chatFrames(f).size)
            assertEquals("确认超时应请求一次对应状态恢复", 1, f.socket.sent.count { JSONObject(it).optString("type") == "chat.sync" })
        } finally { c.leave() }
    }

    @Test fun broadcastWithOriginalClientIdReconcilesEvenWhenAckIsLost() = runTest {
        val d = UnconfinedTestDispatcher(testScheduler); val f = Factory(); val c = client(d, f)
        try {
            ready(c, f); assertTrue(c.chatSend("已送达，ack丢失"))
            val original = c.state.value.chatPending.single()
            val message = entry(1).put("senderId", ownId).put("text", original.text)
                .put("clientMessageId", original.clientMessageId)
            send(f, JSONObject().put("type", "chat.message").put("message", message))
            assertEquals(1, c.state.value.chat.size)
            assertTrue("真实广播携带原ID时应解除pending，避免同消息双气泡", c.state.value.chatPending.isEmpty())
        } finally { c.leave() }
    }
}
