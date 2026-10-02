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
    private class FakeSocket : WebSocket {
        val sent = mutableListOf<String>()
        override fun request() = Request.Builder().url("http://localhost/").build()
        override fun queueSize() = 0L
        override fun send(text: String): Boolean { sent += text; return true }
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
    private fun client(dispatcher: TestDispatcher, factory: Factory): RoomClient {
        val store = object : ConnectionStore {
            override fun loadBaseUrl() = "http://localhost:3000"
            override fun saveBaseUrl(url: String) {}
        }
        val root = File(System.getProperty("java.io.tmpdir"), "lt-acceptance-probe")
        val transport: HttpTransport = { _, _, _, _ -> """{"code":"12345678","memberId":"me","token":"fake-only"}""" }
        val probe: CapabilityProbe = { 200 to """{"protocol":2,"features":{"queue":true,"catalogSearch":true,"chat":true}}""" }
        return RoomClient(store, Noop, { 1000L }, transport, probe, factory, OkHttpClient(), CoverCache(File(root, "covers")), LrcCache(File(root, "lyrics")), dispatcher)
    }
    private fun entry(seq: Int) = JSONObject().put("messageId", "m-$seq").put("seq", seq)
        .put("senderId", "other").put("senderName", "probe").put("text", "message-$seq").put("createdAtMs", 3000)
    private fun send(factory: Factory, json: JSONObject) = factory.listener.onMessage(factory.socket, json.toString())
    private fun snapshot(id: String, seq: Int, count: Int = 1) = JSONObject().put("type", "chat.snapshot")
        .put("snapshotId", id).put("chunkIndex", 0).put("chunkCount", count).put("latestSeq", seq)
        .put("oldestSeq", seq).put("gap", false).put("messages", JSONArray().put(entry(seq)))
    private fun connect(client: RoomClient, factory: Factory) {
        client.join("http://localhost:3000", "probe", null)
        factory.listener.onOpen(factory.socket, Response.Builder().request(factory.socket.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK").build())
    }

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
}
