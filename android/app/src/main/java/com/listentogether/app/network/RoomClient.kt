package com.listentogether.app.network

import android.content.Context
import android.os.SystemClock
import com.listentogether.app.BuildConfig
import com.listentogether.app.diagnostics.Diagnostics
import com.listentogether.app.sync.ClockEstimator
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * HTTP 传输边界：方法、完整地址、JSON 体（可空）、Bearer 令牌（可空）。
 * 返回 2xx 响应体；非 2xx 或网络错误抛 IOException。
 * 抽象目的：JVM 单测可注入假传输层，复现迟到响应、换服务器等竞态，而不访问公网。
 */
internal typealias HttpTransport = suspend (method: String, url: String, body: JSONObject?, token: String?) -> String

/** 生产 HTTP 传输：OkHttp 执行；服务器返回的 message 字段转成异常消息，便于 UI 直接展示。 */
internal fun okHttpTransport(http: OkHttpClient): HttpTransport = { method, url, body, token ->
    withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(url)
        token?.let { builder.header("Authorization", "Bearer $it") }
        val data = body?.toString()?.toRequestBody("application/json".toMediaType())
        builder.method(method, data)
        http.newCall(builder.build()).execute().use { response ->
            val text = response.body?.string() ?: ""
            if (!response.isSuccessful) throw IOException(runCatching { JSONObject(text).getString("message") }.getOrDefault("HTTP " + response.code))
            text
        }
    }
}

/**
 * 网络与会话核心：HTTP 入房/曲库/退出、WS 连接与重连、UI 状态发布。
 *
 * 会话模型：join 成功即创建一个不可变 [SessionContext]（地址、身份、代次）；
 * 此后所有请求与 WS 回调都绑定其创建时的上下文，回调前必须核对代次仍是当前会话，
 * 否则视为旧会话迟到结果并丢弃——退出 A 后立即加入 B 时，A 的结果不能影响 B。
 * 退出顺序（见 [leave]）：作废旧代次 → 取消任务 → 关闭 Socket → 用旧上下文尽力发 DELETE，
 * 本地不等该请求，新会话也不受它影响。
 * 状态机见 [ConnectionStatus]；token 只在内存与请求头中出现，不落盘、不写日志。
 *
 * 可替换边界：存储（[ConnectionStore]）、诊断（[Diagnostics]）、单调时钟（[monoMs]）、
 * HTTP（[transport]）、WebSocket（[wsFactory]）、协程调度器（[mainDispatcher]）。
 * 生产环境一律通过 [create] 构造；测试注入假实现驱动竞态场景。
 */
class RoomClient internal constructor(
    private val store: ConnectionStore,
    private val diag: Diagnostics,
    private val monoMs: () -> Long,
    private val transport: HttpTransport,
    private val wsFactory: WebSocket.Factory,
    mainDispatcher: CoroutineDispatcher
) {
    private val scope = CoroutineScope(SupervisorJob() + mainDispatcher)
    private val mutable = MutableStateFlow(UiState())
    val state = mutable.asStateFlow()

    /** 校时估计器：单调时钟由构造注入，样本规则见 ClockEstimator。 */
    private val clock = ClockEstimator(monoMs)

    /** 仅用于首页地址栏预填的最近服务器地址；请求一律使用会话上下文里的地址，不读这个字段。 */
    var baseUrl: String = store.loadBaseUrl()
        private set
    private var socket: WebSocket? = null
    private var reconnect: Job? = null
    private var syncJob: Job? = null
    private var generation = 0
    private var attempt = 0
    private var serverOffsetMs = 0L
    private var pendingClock: Long? = null

    /** 当前会话；join 成功创建，leave 作废。Expired 状态下保留，供用户退出或重新加入。 */
    private var session: SessionContext? = null
    var onState: (() -> Unit)? = null
    val serverNow: Long get() = monoMs() + serverOffsetMs
    val isHost: Boolean get() = state.value.room?.hostId == state.value.credentials?.memberId && state.value.credentials != null

    /** 已收到快照且校时可用（状态 Ready）；替代旧 connected+clockReady 组合推断。 */
    val synchronized: Boolean get() = state.value.status == ConnectionStatus.Ready

    /** 当前会话代次；播放服务用它与创建时捕获的代次比较，旧实例不得影响新会话。 */
    val sessionGeneration: Int? get() = session?.generation

    /** 播放服务注册状态回调，返回其绑定的会话代次；没有活跃会话返回 null。 */
    fun attachStateObserver(callback: () -> Unit): Int? {
        val bound = session?.generation ?: return null
        onState = callback
        return bound
    }

    /** 仅当传入代次仍是当前会话时才解除回调；旧服务实例销毁不能清掉新会话的观察者。 */
    fun detachStateObserver(generation: Int?) {
        if (generation != null && session?.generation == generation) onState = null
    }

    /** 使用会话上下文发起请求：地址与令牌都取自上下文创建时刻，迟到结果不影响新会话。 */
    private suspend fun request(context: SessionContext, method: String, path: String, body: JSONObject? = null): String =
        transport(method, context.baseUrl + path, body, context.credentials.token)

    fun join(address: String, nickname: String, code: String?) {
        val current = state.value
        // 入房中或会话活跃时忽略重复请求；只有 Idle 与 Expired 允许发起新会话。
        if (current.busy) return
        if (current.credentials != null && current.status != ConnectionStatus.Expired) return
        scope.launch {
            // 从失效会话重新加入：先走完整退出清理，再开始新的入房流程。
            if (state.value.status == ConnectionStatus.Expired) leave()
            mutable.value = UiState(status = ConnectionStatus.Joining, message = "正在连接服务器")
            var created: SessionContext? = null
            try {
                val url = address.trim().trimEnd('/').toHttpUrl()
                require(url.encodedPath == "/" && url.query == null && url.fragment == null && url.username.isEmpty() && url.password.isEmpty()) { "请输入服务器根地址，例如 https://music.example.com" }
                require(BuildConfig.DEBUG || url.isHttps) { "发布版只支持 HTTPS" }
                val root = url.toString().trimEnd('/')
                baseUrl = root
                store.saveBaseUrl(root)
                val route = if (code == null) "/api/rooms" else "/api/rooms/" + code.trim().uppercase().also { require(it.matches(Regex("[0-9A-F]{8}"))) { "邀请码为 8 位字符" } } + "/join"
                val json = JSONObject(transport("POST", root + route, JSONObject().put("nickname", nickname), null))
                val credentials = Credentials(json.getString("code"), json.getString("memberId"), json.getString("token"))
                // 会话从这一刻诞生：代次递增并绑定上下文，之后一切请求/回调都核对它。
                val context = SessionContext(root, credentials, generation + 1)
                generation = context.generation
                session = context
                created = context
                val catalog = JSONArray(request(context, "GET", "/api/rooms/" + credentials.code + "/catalog"))
                val tracks = (0 until catalog.length()).map { val t = catalog.getJSONObject(it); Track(t.getString("id"), t.getString("title"), t.getLong("durationMs")) }
                mutable.value = UiState(status = ConnectionStatus.Connecting, credentials = credentials, tracks = tracks, message = "正在连接房间")
                attempt = 0
                diag.connection("join", credentials.code, "generation=${context.generation}")
                openSocket(context)
            } catch (e: CancellationException) {
                // 协程被取消不是服务器错误，必须原样向外抛出。
                throw e
            } catch (e: Exception) {
                created?.let { context ->
                    // 回滚用入房时的上下文：即使地址已变，也不会把 DELETE 发去别的服务器。
                    runCatching { request(context, "DELETE", "/api/rooms/" + context.credentials.code + "/membership") }
                    if (session === context) { session = null; generation++ }
                }
                mutable.value = UiState(message = e.message ?: "连接失败")
            }
        }
    }

    private fun openSocket(context: SessionContext) {
        val url = context.baseUrl.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://") + "/ws/" + context.credentials.code
        socket = wsFactory.newWebSocket(Request.Builder().url(url).header("Authorization", "Bearer " + context.credentials.token).build(), object : WebSocketListener() {
            // 每个回调都绑定创建时的上下文；代次或连接引用不一致就是旧会话的迟到回调，直接丢弃。
            override fun onOpen(webSocket: WebSocket, response: Response) { scope.launch {
                if (context.generation != generation || socket !== webSocket) { webSocket.close(1000, "stale"); return@launch }
                socket = webSocket; attempt = 0
                mutable.value = state.value.copy(status = ConnectionStatus.Calibrating, message = "已连接，正在校时")
                diag.connection("socket-open", context.credentials.code, "generation=${context.generation}")
                onState?.invoke()
                syncJob?.cancel()
                syncJob = scope.launch {
                    while (isActive) {
                        // 单调时钟不受手动改系统时间影响；15 秒无校时响应视为断线。
                        if (pendingClock != null && monoMs() - pendingClock!! > 15_000) { webSocket.cancel(); break }
                        if (pendingClock == null) {
                            pendingClock = monoMs()
                            webSocket.send(JSONObject().put("type", "sync").put("clientTimeMs", pendingClock).toString())
                        }
                        delay(5_000)
                    }
                }
            } }
            override fun onMessage(webSocket: WebSocket, text: String) { scope.launch {
                if (context.generation != generation || socket !== webSocket) return@launch
                try {
                    val json = JSONObject(text)
                    when (json.getString("type")) {
                        "clock" -> {
                            val sent = json.getLong("clientTimeMs")
                            if (sent == pendingClock) {
                                val received = monoMs()
                                clock.add(sent, received, json.getLong("serverTimeMs"))?.let { sample ->
                                    // 往返最短的有效样本决定偏移；没有合格样本时保持校时中，不用手机日期猜位置。
                                    clock.offsetMs()?.let { offset ->
                                        serverOffsetMs = offset
                                        pendingClock = null
                                        val room = state.value.room
                                        // 周期校时不覆盖本机暂停/中断提示；恢复播放后由 setPlaying 重写“已同步”。
                                        mutable.value = state.value.copy(status = ConnectionStatus.Ready,
                                            message = if (state.value.locallyPaused) state.value.message else "已同步")
                                        diag.sync(context.credentials.code, room?.trackId, room?.version ?: -1L, sample.rttMs, offset)
                                        onState?.invoke()
                                    }
                                }
                            }
                        }
                        "state" -> {
                            val incoming = RoomState.parse(json)
                            // 同版本快照用于定期校准；只忽略更旧的状态。会话切换时房间为 null，不会把新房间误判为过期。
                            if (incoming.version >= (state.value.room?.version ?: -1)) {
                                mutable.value = state.value.copy(room = incoming)
                                onState?.invoke()
                            }
                        }
                        "error" -> report(json.optString("message", "操作失败"))
                    }
                } catch (_: Exception) { report("服务器消息格式错误") }
            } }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                failed(context, webSocket, response?.code == 401 || response?.code == 404, t)
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { failed(context, webSocket, code == 1000, null) }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }
        })
    }

    private fun failed(context: SessionContext, failedSocket: WebSocket, terminal: Boolean, error: Throwable?) { scope.launch {
        if (context.generation != generation || socket !== failedSocket) return@launch
        socket = null; syncJob?.cancel(); pendingClock = null
        // 断线后旧校时样本全部作废；恢复必须先取快照、再重新校时，才允许继续播放。
        clock.clear(); serverOffsetMs = 0
        diag.connection(if (terminal) "expired" else "reconnecting", context.credentials.code, (error?.javaClass?.simpleName ?: "") + " attempt=$attempt")
        if (terminal) {
            mutable.value = state.value.copy(status = ConnectionStatus.Expired, message = "房间或成员已失效，请退出后重新加入")
        } else {
            mutable.value = state.value.copy(status = ConnectionStatus.Reconnecting, message = "连接断开，正在重试")
            reconnect?.cancel()
            // 重连复用同一会话上下文；退避 1/2/4/8/16 秒，一个会话至多一个活跃连接与重连任务。
            reconnect = scope.launch { delay((1000L shl attempt.coerceAtMost(4)).also { attempt++ }); if (context.generation == generation) openSocket(context) }
        }
        onState?.invoke()
    } }

    /** 用户手动重试：清退避、立即重开连接；只在等待重连时可用。 */
    fun retry() {
        val context = session ?: return
        if (state.value.status != ConnectionStatus.Reconnecting) return
        reconnect?.cancel(); reconnect = null; attempt = 0
        mutable.value = state.value.copy(status = ConnectionStatus.Connecting, message = "正在重新连接")
        onState?.invoke()
        openSocket(context)
    }

    fun command(action: String, trackId: String? = null, positionMs: Long? = null) {
        val context = session ?: return
        if (!state.value.connected || !isHost) return
        val message = JSONObject().put("type", "command").put("action", action)
        trackId?.let { message.put("trackId", it) }; positionMs?.let { message.put("positionMs", it) }
        socket?.send(message.toString())
        diag.connection("command", context.credentials.code, action)
    }

    fun setPlaying(playing: Boolean) {
        // 明确点击播放才解除本机中断；服务器的周期快照不能替用户恢复外放。
        if (playing) mutable.value = state.value.copy(locallyPaused = false, message = if (state.value.status == ConnectionStatus.Ready) "已同步" else "正在同步")
        if (isHost) command(if (playing) "play" else "pause")
        else mutable.value = state.value.copy(locallyPaused = !playing)
        onState?.invoke()
    }

    fun pauseLocally(message: String) {
        mutable.value = state.value.copy(locallyPaused = true, message = message)
        onState?.invoke()
    }

    fun updatePosition(position: Long) { mutable.value = state.value.copy(positionMs = position.coerceAtLeast(0)) }
    fun report(message: String) { mutable.value = state.value.copy(message = message) }

    /**
     * 退出房间。顺序固定：先作废旧会话代次（此后所有旧回调被丢弃），再取消任务、
     * 关闭 Socket、清空校时样本，最后用旧上下文尽力发送 DELETE。
     * 本地不等待该请求；DELETE 失败不阻止退出，服务器靠离线清理收回成员。
     */
    fun leave() {
        val old = session
        session = null
        generation++
        reconnect?.cancel(); reconnect = null
        syncJob?.cancel(); syncJob = null
        socket?.close(1000, "leave"); socket = null
        clock.clear(); serverOffsetMs = 0; pendingClock = null
        mutable.value = UiState()
        onState?.invoke()
        if (old != null) {
            diag.connection("leave", old.credentials.code, "generation=${old.generation}")
            scope.launch { runCatching { request(old, "DELETE", "/api/rooms/" + old.credentials.code + "/membership") } }
        }
    }

    companion object {
        /** 进程共享的 OkHttp：HTTP 与 WebSocket 共用连接池；15 秒调用超时，15 秒 WS ping 检测半开连接。 */
        private val sharedHttp: OkHttpClient by lazy {
            OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).pingInterval(15, TimeUnit.SECONDS).build()
        }

        /** 生产入口：SharedPreferences 存储、系统单调时钟、OkHttp 传输、Main.immediate 调度。 */
        fun create(context: Context, diag: Diagnostics): RoomClient = RoomClient(
            SharedPrefsStore(context), diag, SystemClock::elapsedRealtime, okHttpTransport(sharedHttp), sharedHttp, Dispatchers.Main.immediate
        )
    }
}
