package com.listentogether.app

import com.listentogether.app.diagnostics.Diagnostics
import com.listentogether.app.network.ConnectionStatus
import com.listentogether.app.network.ConnectionStore
import com.listentogether.app.network.HttpTransport
import com.listentogether.app.network.RoomClient
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * 会话竞态回归（假传输层，不访问公网，不依赖 Android 框架）。
 * 覆盖 02 模块验收场景：迟到回调隔离、退出后换服务器、重连与退出竞态、401 过期与重新加入、校时超时。
 * UnconfinedTestDispatcher 让会话协程逐语句立即执行；delay 走虚拟时钟，可控推进退避与超时。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RoomClientSessionTest {
    private val dispatcher = UnconfinedTestDispatcher()

    /** 可控单调时钟（毫秒）：测试手动推进，与 delay 的虚拟时钟互相独立。 */
    private var mono = 1_000L

    /** 内存记录的 HTTP 请求；响应按登记顺序回放，异常也按顺序抛出。 */
    private class RecordedRequest(val method: String, val url: String, val token: String?, val body: String?)

    private val httpRequests = mutableListOf<RecordedRequest>()
    private val httpResponses = ArrayDeque<Result<String>>()

    // 传输层假实现：登记请求并回放响应；地址与令牌来自调用方给定，便于核对上下文绑定。
    private val transport: HttpTransport = { method, url, body, token ->
        httpRequests += RecordedRequest(method, url, token, body?.toString())
        httpResponses.removeFirst().getOrThrow()
    }

    private class FakeSocket : WebSocket {
        val sent = mutableListOf<String>()
        var closedCode: Int? = null
        var canceled = false
        override fun send(text: String): Boolean { sent += text; return true }
        override fun send(bytes: okio.ByteString): Boolean { sent += bytes.hex(); return true }
        override fun close(code: Int, reason: String?): Boolean { if (closedCode == null) closedCode = code; return true }
        override fun cancel() { canceled = true }
        override fun request(): Request = Request.Builder().url("http://socket.local").build()
        override fun queueSize(): Long = 0
    }

    // Socket 工厂假实现：捕获监听器，由测试手动驱动 onOpen/onMessage/onFailure 回调。
    private class FakeSocketFactory : WebSocket.Factory {
        val sockets = mutableListOf<FakeSocket>()
        val listeners = mutableListOf<WebSocketListener>()
        val requests = mutableListOf<Request>()
        override fun newWebSocket(request: Request, listener: WebSocketListener): WebSocket =
            FakeSocket().also { sockets += it; listeners += listener; requests += request }

        private fun fakeResponse(code: Int): Response = Response.Builder()
            .request(Request.Builder().url("http://socket.local").build())
            .protocol(Protocol.HTTP_1_1).code(code).message("fake").build()

        fun open(index: Int) { listeners[index].onOpen(sockets[index], fakeResponse(200)) }
        fun fail(index: Int, code: Int?) {
            listeners[index].onFailure(sockets[index], IOException("fake"), code?.let { fakeResponse(it) })
        }
    }

    private val store = object : ConnectionStore {
        var value = ""
        override fun loadBaseUrl(): String = value
        override fun saveBaseUrl(url: String) { value = url }
    }

    private val sockets = FakeSocketFactory()

    private object NoopDiagnostics : Diagnostics {
        override fun connection(event: String, roomCode: String?, detail: String) {}
        override fun sync(roomCode: String, trackId: String?, version: Long, rttMs: Long, offsetMs: Long) {}
        override fun playback(roomCode: String?, trackId: String?, version: Long, playerPositionMs: Long, targetPositionMs: Long, driftMs: Long, buffering: Boolean, localPause: Boolean, correction: String, estimatedServerMs: Long) {}
    }

    private fun newClient() = RoomClient(store, NoopDiagnostics, { mono }, transport, sockets, dispatcher)

    private fun credentials(code: String) = JSONObject()
        .put("code", code).put("memberId", "member-$code").put("token", "token-$code")

    /** 入房并回放“凭据 + 空曲库”两个响应；返回新建 Socket 的下标。 */
    private fun joinRoom(client: RoomClient, address: String, code: String?): Int {
        httpResponses += Result.success(credentials(code ?: "NEWROOM1").toString())
        httpResponses += Result.success("[]")
        client.join(address, "Tester", code)
        return sockets.sockets.size - 1
    }

    /** 打开 Socket 并应答一次校时（服务器快 2 秒），推进到 Ready。 */
    private fun reachReady(index: Int) {
        sockets.open(index)
        val sent = JSONObject(sockets.sockets[index].sent.single()).getLong("clientTimeMs")
        sockets.listeners[index].onMessage(sockets.sockets[index],
            JSONObject().put("type", "clock").put("clientTimeMs", sent).put("serverTimeMs", sent + 2_000).toString())
    }

    /** 构造房间快照消息；members 为空、trackId 为 null 即可满足 RoomState.parse。 */
    private fun stateMessage(version: Long, playing: Boolean = true): String =
        JSONObject().put("type", "state").put("hostId", "member-NEWROOM1").put("members", JSONArray())
            .put("trackId", JSONObject.NULL).put("playing", playing).put("positionMs", 1_000)
            .put("timestampMs", 1).put("version", version).toString()

    @Test
    fun joinReachesReadyAfterClockReply() = runTest(dispatcher) {
        val client = newClient()
        val index = joinRoom(client, "http://a.local", null)

        // 入房请求带昵称、不带令牌；曲库请求带上下文里的令牌；地址已持久化。
        // 未写端口按项目约定补 3000（口令分享可省略 :3000）。
        assertEquals(ConnectionStatus.Connecting, client.state.value.status)
        assertEquals("http://a.local:3000", store.value)
        assertEquals("POST", httpRequests[0].method)
        assertEquals("http://a.local:3000/api/rooms", httpRequests[0].url)
        assertNull(httpRequests[0].token)
        assertEquals("token-NEWROOM1", httpRequests[1].token)

        sockets.open(index)
        assertEquals(ConnectionStatus.Calibrating, client.state.value.status)
        // WS 握手带会话令牌；连接后立即发起一次校时。
        assertEquals("Bearer token-NEWROOM1", sockets.requests[index].header("Authorization"))
        val sync = JSONObject(sockets.sockets[index].sent.single())
        assertEquals("sync", sync.getString("type"))

        // 回复校时：服务器比手机快 2 秒 → Ready，serverNow 已换算到服务器时基。
        val sent = sync.getLong("clientTimeMs")
        sockets.listeners[index].onMessage(sockets.sockets[index],
            JSONObject().put("type", "clock").put("clientTimeMs", sent).put("serverTimeMs", sent + 2_000).toString())
        assertEquals(ConnectionStatus.Ready, client.state.value.status)
        assertEquals(mono + 2_000, client.serverNow)
        assertTrue(client.synchronized)
        // 结束常驻校时循环，避免虚拟时钟上留下无限 delay 任务。
        client.leave()
    }

    @Test
    fun clockSyncKeepsLocalPauseMessage() = runTest(dispatcher) {
        val client = newClient()
        val index = joinRoom(client, "http://a.local", null)
        sockets.open(index)
        val sent1 = JSONObject(sockets.sockets[index].sent.single()).getLong("clientTimeMs")
        sockets.listeners[index].onMessage(sockets.sockets[index],
            JSONObject().put("type", "clock").put("clientTimeMs", sent1).put("serverTimeMs", sent1 + 2_000).toString())
        assertEquals(ConnectionStatus.Ready, client.state.value.status)

        // 焦点丢失/音频 401 的本机暂停提示必须留在横幅上，不被 5 秒周期校时覆盖成“已同步”。
        client.pauseLocally("登录已失效，请退出房间后重新加入")
        advanceTimeBy(5_001)
        val sent2 = JSONObject(sockets.sockets[index].sent.last()).getLong("clientTimeMs")
        sockets.listeners[index].onMessage(sockets.sockets[index],
            JSONObject().put("type", "clock").put("clientTimeMs", sent2).put("serverTimeMs", sent2 + 2_000).toString())
        assertEquals(ConnectionStatus.Ready, client.state.value.status)
        assertTrue(client.state.value.locallyPaused)
        assertEquals("登录已失效，请退出房间后重新加入", client.state.value.message)
        client.leave()
    }

    @Test
    fun explicitNonDefaultPortPreserved() = runTest(dispatcher) {
        val client = newClient()
        // 显式非默认端口（:8080）是用户有意指定的服务器，不得被约定端口 3000 覆盖。
        joinRoom(client, "http://a.local:8080", null)
        assertEquals("http://a.local:8080", store.value)
        assertEquals("http://a.local:8080/api/rooms", httpRequests[0].url)
        client.leave()
    }

    @Test
    fun staleOldSocketCallbacksCannotAffectNewSession() = runTest(dispatcher) {
        val client = newClient()
        val oldIndex = joinRoom(client, "http://a.local", "AAAAAAAA")
        sockets.open(oldIndex)
        client.leave()
        assertEquals(ConnectionStatus.Idle, client.state.value.status)

        val newIndex = joinRoom(client, "http://b.local", "BBBBBBBB")
        sockets.open(newIndex)
        // 旧 Socket 的迟到快照与断线回调都被代次/连接引用检查丢弃。
        sockets.listeners[oldIndex].onMessage(sockets.sockets[oldIndex],
            JSONObject().put("type", "state").put("hostId", "old").put("members", JSONArray())
                .put("playing", false).put("positionMs", 0).put("timestampMs", 0).put("version", 99).toString())
        sockets.fail(oldIndex, null)
        assertNull(client.state.value.room)
        assertEquals(ConnectionStatus.Calibrating, client.state.value.status)
        client.leave()
    }

    @Test
    fun leaveSendsDeleteToOldServerBeforeNewJoin() = runTest(dispatcher) {
        val client = newClient()
        joinRoom(client, "http://a.local", "AAAAAAAA")
        client.leave()

        // DELETE 使用退出时的旧上下文：旧地址（含约定端口 3000）、旧令牌；失败也不阻塞本地退出。
        val delete = httpRequests.single { it.method == "DELETE" }
        assertEquals("http://a.local:3000/api/rooms/AAAAAAAA/membership", delete.url)
        assertEquals("token-AAAAAAAA", delete.token)

        joinRoom(client, "http://b.local", "BBBBBBBB")
        val join = httpRequests.last { it.method == "POST" && it.url.endsWith("/join") }
        assertEquals("http://b.local:3000/api/rooms/BBBBBBBB/join", join.url)
        // 清理请求登记在新入房之前：旧会话清理不阻塞、也不混淆新会话。
        assertTrue(httpRequests.indexOf(delete) < httpRequests.indexOf(join))
    }

    @Test
    fun leaveCancelsPendingReconnect() = runTest(dispatcher) {
        val client = newClient()
        val index = joinRoom(client, "http://a.local", "AAAAAAAA")
        sockets.open(index)
        sockets.fail(index, 500) // 非终态失败 → 进入重连
        assertEquals(ConnectionStatus.Reconnecting, client.state.value.status)

        // 退避 1 秒后按同一会话上下文重开连接。
        advanceTimeBy(1_500)
        assertEquals(2, sockets.sockets.size)

        // 重连后退出：不再创建任何新连接，状态回 Idle。
        client.leave()
        advanceTimeBy(30_000)
        assertEquals(2, sockets.sockets.size)
        assertEquals(ConnectionStatus.Idle, client.state.value.status)
    }

    @Test
    fun unauthorizedMarksExpiredAndAllowsRejoin() = runTest(dispatcher) {
        val client = newClient()
        val index = joinRoom(client, "http://a.local", "AAAAAAAA")
        sockets.open(index)
        sockets.fail(index, 401)
        assertEquals(ConnectionStatus.Expired, client.state.value.status)
        assertNotNull(client.state.value.credentials)

        // 从 Expired 直接重新加入：join 内部先清理旧会话再入新房间。
        // 注意：测试调度器把 leave 的 DELETE 排进事件循环，join 协程结束后才执行，
        // 因此响应队列末位放一个占位响应给迟到的 DELETE（生产端 DELETE 即刻发起，不等待其结果）。
        val newIndex = joinRoom(client, "http://b.local", "BBBBBBBB")
        httpResponses += Result.success("{\"ok\":true}")
        assertEquals(ConnectionStatus.Connecting, client.state.value.status)
        assertEquals("BBBBBBBB", client.state.value.credentials?.code)

        // 旧会话清理确实发出：旧地址（含约定端口 3000）、旧令牌；失败不阻塞新会话。
        val delete = httpRequests.last { it.method == "DELETE" }
        assertEquals("http://a.local:3000/api/rooms/AAAAAAAA/membership", delete.url)
        assertEquals("token-AAAAAAAA", delete.token)

        sockets.open(newIndex)
        assertEquals(ConnectionStatus.Calibrating, client.state.value.status)
        client.leave()
    }

    @Test
    fun clockSilenceCancelsSocket() = runTest(dispatcher) {
        val client = newClient()
        val index = joinRoom(client, "http://a.local", "AAAAAAAA")
        mono = 1_000
        sockets.open(index)
        // 校时请求发出后 16 秒无响应：下一个 5 秒周期检查主动断开（真实环境随后进入重连）。
        // advanceTimeBy 不执行恰好落在目标时刻的任务，因此多推进 1 毫秒触发唤醒。
        mono = 17_000
        advanceTimeBy(5_001)
        assertTrue(sockets.sockets[index].canceled)
    }

    @Test
    fun olderSnapshotVersionIgnored() = runTest(dispatcher) {
        val client = newClient()
        val index = joinRoom(client, "http://a.local", null)
        reachReady(index)

        sockets.listeners[index].onMessage(sockets.sockets[index], stateMessage(5))
        assertEquals(5L, client.state.value.room?.version)

        // 更旧的快照（乱序/迟到）被丢弃，房间状态不被回滚。
        sockets.listeners[index].onMessage(sockets.sockets[index], stateMessage(3, playing = false))
        assertEquals(5L, client.state.value.room?.version)
        assertTrue(client.state.value.room!!.playing)

        // 同版本快照用于定期校准，仍然应用。
        sockets.listeners[index].onMessage(sockets.sockets[index], stateMessage(5, playing = false))
        assertEquals(false, client.state.value.room!!.playing)
        client.leave()
    }

    @Test
    fun duplicateJoinIgnoredWhileSessionActive() = runTest(dispatcher) {
        val client = newClient()
        joinRoom(client, "http://a.local", "AAAAAAAA")

        // 会话活跃（含 Connecting/Ready）时重复 join 直接忽略：不发请求、不建 Socket。
        client.join("http://b.local", "Tester", "BBBBBBBB")
        assertEquals(2, httpRequests.size)
        assertEquals(1, sockets.sockets.size)
        client.leave()
    }

    @Test
    fun retryOnlyWorksWhileReconnecting() = runTest(dispatcher) {
        val client = newClient()
        val index = joinRoom(client, "http://a.local", "AAAAAAAA")
        reachReady(index)

        // Ready 状态手动重试无效：不新建连接、不改变状态。
        client.retry()
        assertEquals(1, sockets.sockets.size)
        assertEquals(ConnectionStatus.Ready, client.state.value.status)

        sockets.fail(index, 500)
        assertEquals(ConnectionStatus.Reconnecting, client.state.value.status)

        // 重连等待期立即重试：清退避、马上重开连接，不等 1 秒延迟。
        client.retry()
        assertEquals(ConnectionStatus.Connecting, client.state.value.status)
        assertEquals(2, sockets.sockets.size)
        client.leave()
    }

    @Test
    fun reconnectBackoffDoubles() = runTest(dispatcher) {
        val client = newClient()
        val index = joinRoom(client, "http://a.local", "AAAAAAAA")
        sockets.open(index)

        // 退避序列 1/2/4 秒：每次非终态失败后才按指数间隔重开连接。
        sockets.fail(index, 500)
        advanceTimeBy(1_001)
        assertEquals(2, sockets.sockets.size)

        sockets.fail(1, 500)
        advanceTimeBy(1_500)
        assertEquals(2, sockets.sockets.size) // 2 秒窗口未到，不得提前重连
        advanceTimeBy(600)
        assertEquals(3, sockets.sockets.size)

        sockets.fail(2, 500)
        advanceTimeBy(4_001)
        assertEquals(4, sockets.sockets.size)
        client.leave()
    }

    @Test
    fun closeFrame1000ExpiredOtherwiseReconnecting() = runTest(dispatcher) {
        // 正常关闭帧（1000）视为终态：服务器主动结束会话，进入 Expired。
        val client = newClient()
        val index = joinRoom(client, "http://a.local", "AAAAAAAA")
        reachReady(index)
        sockets.listeners[index].onClosed(sockets.sockets[index], 1000, "shutdown")
        assertEquals(ConnectionStatus.Expired, client.state.value.status)
        client.leave()

        // 异常关闭码进入重连而不是过期。
        val other = newClient()
        val otherIndex = joinRoom(other, "http://a.local", "CCCCCCCC")
        sockets.open(otherIndex)
        sockets.listeners[otherIndex].onClosed(sockets.sockets[otherIndex], 1001, "abnormal")
        assertEquals(ConnectionStatus.Reconnecting, other.state.value.status)
        other.leave()
    }

    @Test
    fun reconnectMustRecalibrateBeforeReady() = runTest(dispatcher) {
        val client = newClient()
        val index = joinRoom(client, "http://a.local", "AAAAAAAA")
        reachReady(index)
        assertTrue(client.synchronized)

        // 断线清空校时样本：重连成功后仍停在 Calibrating，不得沿用旧偏移直接 Ready。
        sockets.fail(index, null)
        assertEquals(ConnectionStatus.Reconnecting, client.state.value.status)
        advanceTimeBy(1_001)
        val newIndex = sockets.sockets.size - 1
        sockets.open(newIndex)
        assertEquals(ConnectionStatus.Calibrating, client.state.value.status)

        // 新连接重新发起校时，应答后才允许回 Ready 跟随播放。
        val sent = JSONObject(sockets.sockets[newIndex].sent.single()).getLong("clientTimeMs")
        sockets.listeners[newIndex].onMessage(sockets.sockets[newIndex],
            JSONObject().put("type", "clock").put("clientTimeMs", sent).put("serverTimeMs", sent + 2_000).toString())
        assertEquals(ConnectionStatus.Ready, client.state.value.status)
        client.leave()
    }
}
