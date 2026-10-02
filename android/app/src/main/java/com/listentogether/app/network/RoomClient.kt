package com.listentogether.app.network

import android.content.Context
import android.graphics.Bitmap
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

/** 服务端不支持 v2 点歌队列（能力探测 404 / 业务请求或 WS 握手 426）→ 客户端兼容性终态。 */
internal class IncompatibleServerException(message: String) : IOException(message)

/** 能力探测边界：返回 HTTP 状态码与响应体；网络错误照常抛 IOException（可重试，不得冒充版本不兼容）。 */
internal typealias CapabilityProbe = suspend (url: String) -> Pair<Int, String>

/** v2 协议标识请求头；所有业务 HTTP 请求与 WS 握手都携带。 */
internal const val PROTOCOL_HEADER = "X-ListenTogether-Protocol"

/** 生产 HTTP 传输：OkHttp 执行；服务器返回的 message 字段转成异常消息；426 转兼容性终态。 */
internal fun okHttpTransport(http: OkHttpClient): HttpTransport = { method, url, body, token ->
    withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(url)
            .header(PROTOCOL_HEADER, "2")
        token?.let { builder.header("Authorization", "Bearer $it") }
        val data = body?.toString()?.toRequestBody("application/json".toMediaType())
        builder.method(method, data)
        http.newCall(builder.build()).execute().use { response ->
            val text = response.body?.string() ?: ""
            if (response.code == 426) throw IncompatibleServerException(runCatching { JSONObject(text).getString("message") }.getOrDefault("服务器不支持点歌队列，请升级服务端"))
            if (!response.isSuccessful) throw IOException(runCatching { JSONObject(text).getString("message") }.getOrDefault("HTTP " + response.code))
            text
        }
    }
}

/** 生产能力探测：GET 不抛业务异常，原样返回状态码与响应体（404 = 旧服务端）。 */
internal fun okHttpProbe(http: OkHttpClient): CapabilityProbe = { url ->
    withContext(Dispatchers.IO) {
        http.newCall(Request.Builder().url(url).header(PROTOCOL_HEADER, "2").build()).execute().use { response ->
            response.code to (response.body?.string() ?: "")
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
    private val probe: CapabilityProbe,
    private val wsFactory: WebSocket.Factory,
    private val http: OkHttpClient,
    private val coverCache: CoverCache,
    private val lrcCache: LrcCache,
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
    /** 最近一次房间重入提示，不包含或恢复任何旧成员凭证。 */
    val lastRoom: LastRoom? get() = store.loadLastRoom()

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
                require(BuildConfig.DEBUG || BuildConfig.ALLOW_INSECURE_BENCHMARK || url.isHttps) { "发布版只支持 HTTPS" }
                // 未写端口（okhttp 回填成协议默认 80/443）按项目约定补 3000：
                // 口令分享可省略 :3000，粘贴后仍加入同一服务器；显式非默认端口（如 :8080）原样保留。
                val root = (if (url.port == HttpUrl.defaultPort(url.scheme)) url.newBuilder().port(3000).build() else url)
                    .toString().trimEnd('/')
                baseUrl = root
                store.saveBaseUrl(root)
                val route = if (code == null) "/api/rooms" else "/api/rooms/" + code.trim().uppercase().also { require(it.matches(Regex("[0-9A-F]{8}"))) { "邀请码为 8 位字符" } } + "/join"
                // v2 能力探测先行：404 表示旧服务端，转「不支持点歌队列」终态；网络错误保持可重试，不冒充版本不兼容。
                val chatEnabled = checkCapabilities(root)
                val json = JSONObject(transport("POST", root + route, JSONObject().put("nickname", nickname), null))
                val credentials = Credentials(json.getString("code"), json.getString("memberId"), json.getString("token"))
                // 保存非敏感重入提示；进程重启后必须通过正常 join 获取全新令牌。
                store.saveLastRoom(LastRoom(credentials.code, nickname.trim()))
                // 会话从这一刻诞生：代次递增并绑定上下文，之后一切请求/回调都核对它。
                val context = SessionContext(root, credentials, generation + 1)
                generation = context.generation
                session = context
                created = context
                // v2 不再整库加载曲库：待播队列随 WS 连接下发，检索走 /catalog/search 按页请求。
                mutable.value = UiState(status = ConnectionStatus.Connecting, credentials = credentials, chatEnabled = chatEnabled, message = "正在连接房间")
                attempt = 0
                diag.connection("join", credentials.code, "generation=${context.generation}")
                openSocket(context, recheck = false)
            } catch (e: CancellationException) {
                // 协程被取消不是服务器错误，必须原样向外抛出。
                throw e
            } catch (e: IncompatibleServerException) {
                // v2 兼容终态：不清理（没建会话就没有可清理的东西），给用户明确的升级提示。
                mutable.value = UiState(status = ConnectionStatus.Incompatible, message = e.message ?: "服务器不支持点歌队列，请升级服务端")
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

    /** queue/catalogSearch 是 v2 必需能力；chat 为可选能力。网络失败仍走正常退避。 */
    private suspend fun checkCapabilities(root: String): Boolean {
        val (status, body) = probe(root + "/api/capabilities")
        if (status == 404 || status == 426) throw IncompatibleServerException("服务器版本过旧，不支持点歌队列，请升级服务端")
        if (status != 200) throw IOException("服务器能力探测失败（HTTP $status）")
        val json = JSONObject(body)
        val features = json.optJSONObject("features")
            ?: throw IncompatibleServerException("服务器未提供点歌队列能力，请升级服务端")
        if (json.optInt("protocol") != 2 || features.opt("queue") != true || features.opt("catalogSearch") != true) {
            throw IncompatibleServerException("服务器不支持点歌队列或曲库检索，请升级服务端")
        }
        return features.opt("chat") == true
    }

    private fun openSocket(context: SessionContext, recheck: Boolean = true) {
        if (recheck) {
            reconnect = scope.launch {
                try {
                    val chatEnabled = checkCapabilities(context.baseUrl)
                    if (context.generation != generation) return@launch
                    mutable.value = state.value.copy(chatEnabled = chatEnabled)
                    openSocket(context, recheck = false)
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) {
                    if (context.generation == generation) handleFailure(context, false, e)
                }
            }
            return
        }
        val url = context.baseUrl.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://") + "/ws/" + context.credentials.code
        socket = wsFactory.newWebSocket(Request.Builder().url(url).header("Authorization", "Bearer " + context.credentials.token).header(PROTOCOL_HEADER, "2").build(), object : WebSocketListener() {
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
                                        diag.sync(context.credentials.code, room?.track?.id, room?.version ?: -1L, sample.rttMs, offset)
                                        onState?.invoke()
                                    }
                                }
                            }
                        }
                        "state" -> {
                            if (json.optInt("protocol") != 2) {
                                failed(context, webSocket, false, IncompatibleServerException("服务器房间协议不兼容，请升级服务端"))
                                webSocket.close(1000, "protocol unsupported")
                                return@launch
                            }
                            val incoming = RoomState.parse(json)
                            // 同版本快照用于定期校准；只忽略更旧的状态。会话切换时房间为 null，不会把新房间误判为过期。
                            if (incoming.version >= (state.value.room?.version ?: -1)) {
                                mutable.value = state.value.copy(room = incoming)
                                onState?.invoke()
                            }
                        }
                        "queue.state" -> applyQueueSnapshot(json)
                        "chat.message" -> if (state.value.chatEnabled) applyChatMessage(ChatEntry.parse(json.getJSONObject("message")))
                        "chat.snapshot" -> if (state.value.chatEnabled) applyChatSnapshot(json)
                        "ack" -> resolveAck(json)
                        "error" -> resolveOperationError(json)
                    }
                } catch (_: Exception) { report("服务器消息格式错误") }
            } }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                // 426 = 服务端不再支持 v2（回滚/降级）：兼容性终态，不进入重连循环。
                when (response?.code) {
                    426 -> failed(context, webSocket, false, IncompatibleServerException("服务器不支持点歌队列，请升级服务端"))
                    401, 404 -> failed(context, webSocket, true, t)
                    else -> failed(context, webSocket, false, t)
                }
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { failed(context, webSocket, code == 1000, null) }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }
        })
    }

    private fun failed(context: SessionContext, failedSocket: WebSocket, terminal: Boolean, error: Throwable?) { scope.launch {
        if (context.generation != generation || socket !== failedSocket) return@launch
        handleFailure(context, terminal, error)
    } }

    private fun handleFailure(context: SessionContext, terminal: Boolean, error: Throwable?) {
        socket = null; syncJob?.cancel(); pendingClock = null
        clearSnapshots()
        // 断线后旧校时样本全部作废；恢复必须先取快照、再重新校时，才允许继续播放。
        clock.clear(); serverOffsetMs = 0
        diag.connection(if (terminal) "expired" else "reconnecting", context.credentials.code, (error?.javaClass?.simpleName ?: "") + " attempt=$attempt")
        when {
            // 会话中服务端回滚/降级为不支持 v2：兼容性终态，不重连、不重放命令。
            error is IncompatibleServerException ->
                mutable.value = state.value.copy(status = ConnectionStatus.Incompatible, message = error.message ?: "服务器不支持点歌队列，请升级服务端")
            terminal ->
                mutable.value = state.value.copy(status = ConnectionStatus.Expired, message = "房间或成员已失效，请退出后重新加入")
            else -> {
                mutable.value = state.value.copy(status = ConnectionStatus.Reconnecting, message = "连接断开，正在重试")
                reconnect?.cancel()
                // 重连复用同一会话上下文；退避 1/2/4/8/16 秒，一个会话至多一个活跃连接与重连任务。
                reconnect = scope.launch { delay((1000L shl attempt.coerceAtMost(4)).also { attempt++ }); if (context.generation == generation) openSocket(context) }
            }
        }
        onState?.invoke()
    }

    /** 用户手动重试：清退避、立即重开连接；只在等待重连时可用。 */
    fun retry() {
        val context = session ?: return
        if (state.value.status != ConnectionStatus.Reconnecting) return
        reconnect?.cancel(); reconnect = null; attempt = 0
        mutable.value = state.value.copy(status = ConnectionStatus.Connecting, message = "正在重新连接")
        onState?.invoke()
        openSocket(context)
    }

    fun command(action: String, positionMs: Long? = null) {
        val context = session ?: return
        if (!synchronized || !isHost) return
        require(action in listOf("play", "pause", "seek"))
        val requestId = newRequestId()
        val message = JSONObject().put("type", "command").put("action", action)
            .put("requestId", requestId).put("issuedAtMs", serverNow)
        positionMs?.let { message.put("positionMs", it) }
        if (socket?.send(message.toString()) != true) { report("操作未发送，请检查连接"); return }
        pendingOps[requestId] = scope.launch {
            delay(OPERATION_CONFIRM_MS)
            if (context.generation == generation && requestId in pendingOps) {
                clearQueuePending(requestId)
                report("操作暂未确认，正在核对播放状态")
                // 请求状态恢复，不自动重复副作用命令。
                if (pendingClock == null) {
                    pendingClock = monoMs()
                    socket?.send(JSONObject().put("type", "sync").put("clientTimeMs", pendingClock).toString())
                }
            }
        }
        diag.connection("command", context.credentials.code, action)
    }

    // ---- v2 队列操作：统一 requestId + issuedAtMs（校时后的服务端时间），5 秒确认超时 ----

    /** 已发送待确认的 v2 操作：requestId → 超时任务；局部处理态不冒充业务成功。 */
    private val pendingOps = mutableMapOf<String, Job>()
    private val pendingQueueTracks = mutableMapOf<String, String>()
    private val pendingQueueTypes = mutableMapOf<String, String>()
    private val pendingRandom = mutableSetOf<String>()
    private val pendingChatJobs = mutableMapOf<String, Job>()

    /** 清局部处理态；歌曲是否已加入只由 room / queue 的服务端快照决定。 */
    private fun clearQueuePending(requestId: String) {
        pendingOps.remove(requestId)?.cancel()
        pendingQueueTracks.remove(requestId)
        pendingQueueTypes.remove(requestId)
        pendingRandom.remove(requestId)
        mutable.value = state.value.copy(queueAdding = pendingQueueTracks.values.toSet(), randomAdding = pendingRandom.isNotEmpty())
    }

    private fun sendQueueOp(type: String, requestId: String, trackId: String? = null, build: JSONObject.() -> Unit) {
        val context = session ?: return
        // issuedAtMs 依赖校时结果，只有 Ready 可以发起新的副作用操作。
        if (!synchronized) { report("连接尚未就绪，请稍后再试"); return }
        val message = JSONObject().put("type", type).put("requestId", requestId)
            .put("issuedAtMs", serverNow)
        message.build()
        pendingQueueTypes[requestId] = type
        trackId?.let { pendingQueueTracks[requestId] = it }
        if (type == "queue.addRandom") pendingRandom += requestId
        mutable.value = state.value.copy(queueAdding = pendingQueueTracks.values.toSet(), randomAdding = pendingRandom.isNotEmpty())
        if (socket?.send(message.toString()) != true) {
            clearQueuePending(requestId)
            report("操作未发送，请检查连接后重试")
            return
        }
        // 超时提示核对状态，不自动重放；结束局部转圈，不能显示虚假的成功勾。
        pendingOps[requestId] = scope.launch {
            delay(OPERATION_CONFIRM_MS)
            if (requestId in pendingOps && context.generation == generation) {
                clearQueuePending(requestId)
                report("操作暂未确认，请核对队列当前状态")
                queueSync()
            }
        }
        diag.connection("queue-op", context.credentials.code, type)
    }

    /** 成员点歌（所有成员可用；重复/配额失败由服务端 ack 回业务错误）。 */
    fun queueAdd(trackId: String) {
        if (trackId in state.value.queueAdding) return
        val requestId = newRequestId()
        sendQueueOp("queue.add", requestId, trackId) { put("trackId", trackId) }
    }

    /** 随机加入 1 或 5 首（服务端全库抽样）。 */
    fun queueAddRandom(count: Int) {
        require(count == 1 || count == 5)
        if (state.value.randomAdding) return
        val requestId = newRequestId()
        sendQueueOp("queue.addRandom", requestId) { put("count", count) }
    }

    /** 撤回待播条目：成员限自己的点歌，房主任意。 */
    fun queueRemove(entryId: String) {
        val requestId = newRequestId()
        sendQueueOp("queue.remove", requestId) { put("entryId", entryId) }
    }

    /**
     * 房主重排：把 entry 移到 beforeEntryId 之前（null = 队尾）；expectedQueueVersion 冲突时
     * 服务端回 409 并补发最新 queue.state，客户端按新状态显示，不静默重放旧排序。
     */
    fun queueMove(entryId: String, beforeEntryId: String?, expectedQueueVersion: Long) {
        val requestId = newRequestId()
        sendQueueOp("queue.move", requestId) {
            put("entryId", entryId)
            put("beforeEntryId", beforeEntryId ?: JSONObject.NULL)
            put("expectedQueueVersion", expectedQueueVersion)
        }
    }

    /** 房主跳过当前曲（服务端消费队头，保留原播放意图）；通知栏下一首也走这里。 */
    fun skipNext() {
        val requestId = newRequestId()
        sendQueueOp("skip-next", requestId) { }
    }

    private fun newRequestId(): String = java.util.UUID.randomUUID().toString()

    private var chatRecovering = false
    private var queueRecovering = false
    private var completedChatSeq = -1L
    private val queueSnapshots = SnapshotCollector(scope, "entries", "queueVersion",
        { 512 * 1024 - snapshotBytes() }, { queueRecovering = false; queueSync() })
    private val chatSnapshots = SnapshotCollector(scope, "messages", "latestSeq",
        { 512 * 1024 - snapshotBytes() }, { chatRecovering = false; recoverChat() })
    private fun snapshotBytes(): Int = queueSnapshots.bytes + chatSnapshots.bytes

    private fun clearSnapshots() {
        queueSnapshots.clear(true); chatSnapshots.clear(true)
        queueRecovering = false; chatRecovering = false
    }

    private fun queueSync() {
        if (!state.value.connected || queueRecovering) return
        if (socket?.send(JSONObject().put("type", "queue.sync").toString()) == true) queueRecovering = true
    }

    private fun recoverChat() { if (!chatRecovering) chatSync() }

    private fun applyQueueSnapshot(json: JSONObject) {
        if (json.getLong("queueVersion") < (state.value.queue?.queueVersion ?: -1)) return
        val complete = queueSnapshots.accept(json) ?: return
        val incoming = QueueState.parse(complete)
        queueRecovering = false
        mutable.value = state.value.copy(queue = incoming)
    }

    /** ack 丢失也可用发送者与原操作 ID 对账，不能按相同文本猜测成功。 */
    private fun reconcilePending(entries: List<ChatEntry>): List<PendingChat> {
        val self = state.value.credentials?.memberId
        return state.value.chatPending.filterNot { pending ->
            val found = entries.any { it.messageId == pending.messageId ||
                (it.senderId == self && it.clientMessageId == pending.clientMessageId) }
            if (found) pendingChatJobs.remove(pending.clientMessageId)?.cancel()
            found
        }
    }

    private fun applyChatMessage(entry: ChatEntry) {
        if (entry.seq > state.value.chatLatestSeq + 1) recoverChat()
        val merged = (state.value.chat + entry).distinctBy { it.messageId }.sortedBy { it.seq }.takeLast(100)
        mutable.value = state.value.copy(chat = merged, chatLatestSeq = maxOf(state.value.chatLatestSeq, entry.seq),
            chatOldestSeq = merged.firstOrNull()?.seq, chatPending = reconcilePending(merged))
    }

    private fun applyChatSnapshot(json: JSONObject) {
        if (json.getLong("latestSeq") < completedChatSeq) return
        val complete = chatSnapshots.accept(json) ?: return
        val list = complete.getJSONArray("messages")
        val entries = (0 until list.length()).map { ChatEntry.parse(list.getJSONObject(it)) }
        val latest = complete.getLong("latestSeq")
        completedChatSeq = latest
        // 分块期间已经收到的新事件保留；历史窗口则以完整快照为准，允许补回缺失序号。
        val merged = (entries + state.value.chat.filter { it.seq > latest })
            .distinctBy { it.messageId }.sortedBy { it.seq }.takeLast(100)
        chatRecovering = false
        mutable.value = state.value.copy(
            chat = merged, chatLatestSeq = maxOf(latest, merged.lastOrNull()?.seq ?: 0),
            chatOldestSeq = merged.firstOrNull()?.seq,
            chatGap = complete.getBoolean("gap"), chatSnapshotReceived = true,
            chatInitialSeq = state.value.chatInitialSeq ?: latest,
            chatPending = reconcilePending(merged)
        )
    }

    /**
     * 接管聊天原文到本地气泡；未就绪或校验失败返回 false，界面必须保留草稿。
     * 文本以 Unicode 码点与 UTF-8 字节校验，不把 emoji 的 UTF-16 长度当字数。
     * 返回 true 表示原文已被本地气泡保存；发送拒绝和超时均保留它供用户核对或原 ID 重试。
     */
    fun chatSend(text: String): Boolean {
        val context = session
        if (!state.value.chatEnabled) { report("服务器暂未开放聊天"); return false }
        if (context == null || !synchronized) { report("连接尚未就绪，请稍后再发送"); return false }
        if (text.isBlank()) return false
        if (text.codePointCount(0, text.length) > 500 || text.toByteArray(Charsets.UTF_8).size > 2048) {
            report("消息最多 500 个字符、2048 字节，请缩短后发送")
            return false
        }
        val pending = PendingChat(newRequestId(), text, issuedAtMs = serverNow,
            expiresAtMonoMs = monoMs() + CHAT_RETRY_WINDOW_MS)
        mutable.value = state.value.copy(chatPending = state.value.chatPending + pending)
        sendPendingChat(context, pending)
        diag.connection("chat-send", context.credentials.code, "codePoints=${text.codePointCount(0, text.length)}")
        return true
    }

    /** 剩余限频等待（单调时钟毫秒）；界面可读它安排倒计时，不改变操作身份。 */
    fun chatRetryDelayMs(pending: PendingChat): Long = (pending.retryAtMonoMs - monoMs()).coerceAtLeast(0)

    /** 用户显式重试：同会话、已校时、未过期且限频等待结束时，重发完整原始操作。 */
    fun retryChat(clientMessageId: String): Boolean {
        val context = session ?: return false
        val pending = state.value.chatPending.firstOrNull { it.clientMessageId == clientMessageId } ?: return false
        if (!state.value.chatEnabled || !synchronized || pending.delivery == ChatDelivery.Sending || pending.delivery == ChatDelivery.Confirmed) return false
        if (monoMs() >= pending.expiresAtMonoMs) {
            updatePendingChat(clientMessageId) { it.copy(delivery = ChatDelivery.Failed, error = "操作已过期，请核对聊天记录") }
            return false
        }
        if (chatRetryDelayMs(pending) > 0) return false
        sendPendingChat(context, pending)
        return true
    }

    private fun updatePendingChat(clientMessageId: String, transform: (PendingChat) -> PendingChat) {
        mutable.value = state.value.copy(chatPending = state.value.chatPending.map {
            if (it.clientMessageId == clientMessageId) transform(it) else it
        })
    }

    private fun sendPendingChat(context: SessionContext, pending: PendingChat) {
        pendingChatJobs.remove(pending.clientMessageId)?.cancel()
        updatePendingChat(pending.clientMessageId) { it.copy(delivery = ChatDelivery.Sending, error = null) }
        val message = JSONObject().put("type", "chat.send").put("clientMessageId", pending.clientMessageId)
            .put("issuedAtMs", pending.issuedAtMs).put("text", pending.text)
        if (socket?.send(message.toString()) != true) {
            updatePendingChat(pending.clientMessageId) { it.copy(delivery = ChatDelivery.Failed, error = "消息未发送，请检查连接") }
            return
        }
        pendingChatJobs[pending.clientMessageId] = scope.launch {
            delay(OPERATION_CONFIRM_MS)
            if (context.generation == generation) {
                pendingChatJobs.remove(pending.clientMessageId)
                recoverChat()
                updatePendingChat(pending.clientMessageId) {
                    if (it.delivery == ChatDelivery.Sending) it.copy(delivery = ChatDelivery.Unconfirmed, error = "暂未确认") else it
                }
            }
        }
    }

    /** 恢复聊天窗口：服务端始终回保留窗口快照；lastSeq 仅用于缺口判定。 */
    fun chatSync() {
        session ?: return
        if (!state.value.connected || !state.value.chatEnabled) return
        val message = JSONObject().put("type", "chat.sync")
        state.value.chatLatestSeq.takeIf { it > 0 }?.let { message.put("lastSeq", it) }
        if (socket?.send(message.toString()) == true) chatRecovering = true
    }

    /**
     * ack 关联原操作；确认成功只从 result.messageId 对账，不伪造消息 seq / 时间。
     * 广播与 ack 任意顺序到达均保留原文；只有对应真实消息已到达才移除本地气泡。
     */
    private fun resolveAck(json: JSONObject) {
        val requestId = json.optString("requestId")
        val queueType = pendingQueueTypes[requestId]
        if (requestId.isNotEmpty()) clearQueuePending(requestId)
        val clientMessageId = json.optString("clientMessageId")
        if (clientMessageId.isNotEmpty()) {
            pendingChatJobs.remove(clientMessageId)?.cancel()
            val pending = state.value.chatPending.firstOrNull { it.clientMessageId == clientMessageId }
            if (pending != null) {
                val expiresAt = json.optLong("expiresAtMs", pending.issuedAtMs + CHAT_RETRY_WINDOW_MS)
                val remaining = (expiresAt - serverNow).coerceAtLeast(0).coerceAtMost(CHAT_RETRY_WINDOW_MS)
                if (json.optBoolean("ok")) {
                    val messageId = json.optJSONObject("result")?.optString("messageId")?.takeIf { it.isNotEmpty() }
                    if (messageId != null && state.value.chat.any { it.messageId == messageId }) {
                        mutable.value = state.value.copy(chatPending = state.value.chatPending.filterNot { it.clientMessageId == clientMessageId })
                    } else {
                        updatePendingChat(clientMessageId) { it.copy(delivery = ChatDelivery.Confirmed,
                            messageId = messageId, error = null, expiresAtMonoMs = minOf(it.expiresAtMonoMs, monoMs() + remaining)) }
                        recoverChat()
                    }
                } else {
                    val error = json.optJSONObject("error")
                    updatePendingChat(clientMessageId) { it.copy(delivery = ChatDelivery.Failed,
                        error = error?.optString("message", "发送失败") ?: "发送失败",
                        retryAtMonoMs = monoMs() + (error?.optLong("retryAfterMs", 0) ?: 0).coerceAtLeast(0),
                        expiresAtMonoMs = minOf(it.expiresAtMonoMs, monoMs() + remaining)) }
                }
            }
        }
        if (json.optBoolean("ok")) return
        val error = json.optJSONObject("error")
        report(if (queueType == "queue.move" && error?.optInt("status") == 409) "队列已更新，请再试一次"
            else error?.optString("message") ?: "操作失败")
    }

    /** 错误帧只更新明确关联的操作；存量无 clientMessageId 的 429 不猜测失败气泡。 */
    private fun resolveOperationError(json: JSONObject) {
        val requestId = json.optString("requestId")
        if (requestId.isNotEmpty()) clearQueuePending(requestId)
        val clientMessageId = json.optString("clientMessageId")
        if (clientMessageId.isNotEmpty()) {
            pendingChatJobs.remove(clientMessageId)?.cancel()
            updatePendingChat(clientMessageId) { it.copy(delivery = ChatDelivery.Failed,
                error = json.optString("message", "发送失败"),
                retryAtMonoMs = monoMs() + json.optLong("retryAfterMs", 0).coerceAtLeast(0)) }
        }
        report(json.optString("message", "操作失败"))
    }

    /**
     * 曲库检索（按页请求，v2 首屏不整库加载）：返回一页结果。
     * 曲库版本不匹配（409 CATALOG_CHANGED）抛 [CatalogChangedException]，调用方清页重查。
     */
    suspend fun searchCatalog(query: String, offset: Int, limit: Int = 30, revision: String? = null): CatalogPage {
        val context = session ?: throw IOException("未加入房间")
        val url = HttpUrl.Builder().scheme(context.baseUrl.toHttpUrl().scheme).host(context.baseUrl.toHttpUrl().host)
            .port(context.baseUrl.toHttpUrl().port)
            .addPathSegments("api/rooms/" + context.credentials.code + "/catalog/search")
            .addQueryParameter("q", query)
            .addQueryParameter("offset", offset.toString())
            .addQueryParameter("limit", limit.toString())
            .apply { revision?.let { addQueryParameter("revision", it) } }
            .build()
        return withContext(Dispatchers.IO) {
            val req = Request.Builder().url(url).header("Authorization", "Bearer " + context.credentials.token)
                .header(PROTOCOL_HEADER, "2").build()
            http.newCall(req).execute().use { response ->
                val text = response.body?.string() ?: ""
                if (response.code == 409) throw CatalogChangedException()
                if (!response.isSuccessful) throw IOException(runCatching { JSONObject(text).getString("message") }.getOrDefault("HTTP " + response.code))
                val json = JSONObject(text)
                val items = json.getJSONArray("items")
                CatalogPage(json.getString("catalogRevision"), json.getInt("total"), json.getInt("offset"),
                    (0 until items.length()).map { Track.parse(items.getJSONObject(it)) })
            }
        }
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

    /**
     * 拉取当前曲目的封面：内存 LruCache 命中即返回；否则磁盘文件/网络下载原始字节，
     * 按 [targetPx] 降采样解码并写入内存层。无封面 / 无会话 / 网络失败统一返回 null
     * （UI 静默回退为占位）。
     * 必须在协程中调用；本函数自己切到 IO 线程执行网络与文件 IO（内存命中可在主线程快速返回）。
     */
    suspend fun fetchCover(track: Track, targetPx: Int): Bitmap? {
        val context = session ?: return null
        if (!track.hasCover || track.coverVer == null) return null
        val key = coverCache.key(track) ?: return null
        coverCache.cached(key, targetPx)?.let { return it }
        val file = coverCache.file(key)
        if (file.exists()) return withContext(Dispatchers.IO) { runCatching { coverCache.decodeAndCache(key, targetPx, file.readBytes()) }.getOrNull() }
        return withContext(Dispatchers.IO) {
            runCatching {
                val req = Request.Builder()
                    .url(context.baseUrl + "/api/rooms/" + context.credentials.code + "/cover/" + track.id)
                    .header("Authorization", "Bearer " + context.credentials.token).build()
                http.newCall(req).execute().use { response ->
                    if (!response.isSuccessful) return@use null
                    val bytes = response.body?.bytes() ?: return@use null
                    file.writeBytes(bytes); coverCache.decodeAndCache(key, targetPx, bytes)
                }
            }.getOrNull()
        }
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
        pendingOps.values.forEach { it.cancel() }; pendingOps.clear()
        pendingQueueTracks.clear(); pendingQueueTypes.clear(); pendingRandom.clear()
        pendingChatJobs.values.forEach { it.cancel() }; pendingChatJobs.clear()
        clearSnapshots()
        completedChatSeq = -1L
        mutable.value = UiState()
        onState?.invoke()
        if (old != null) {
            diag.connection("leave", old.credentials.code, "generation=${old.generation}")
            scope.launch { runCatching { request(old, "DELETE", "/api/rooms/" + old.credentials.code + "/membership") } }
        }
    }

    /**
     * 拉取当前曲目的 LRC 歌词原文：缓存命中即读文件，未命中下载到 lyricsDir/<id>-<lyricsVer>.lrc；
     * 无会话 / 无歌词 / 网络失败统一返回 null（UI 显示占位文案）。
     * 必须在协程中调用；本函数自己切到 IO 线程执行网络与文件 IO。
     */
    suspend fun fetchLyrics(track: Track): String? {
        val context = session ?: return null
        if (!track.hasLyrics) return null
        val file = lrcCache.file(track.id, track.lyricsVer)
        if (file.exists()) return withContext(Dispatchers.IO) { runCatching { file.readText() }.getOrNull() }
        return withContext(Dispatchers.IO) {
            runCatching {
                val req = Request.Builder()
                    .url(context.baseUrl + "/api/rooms/" + context.credentials.code + "/lyrics/" + track.id)
                    .header("Authorization", "Bearer " + context.credentials.token).build()
                http.newCall(req).execute().use { response ->
                    if (!response.isSuccessful) return@use null
                    val text = response.body?.string() ?: return@use null
                    file.writeText(text); text
                }
            }.getOrNull()
        }
    }

    companion object {
        private const val OPERATION_CONFIRM_MS = 5_000L
        private const val CHAT_RETRY_WINDOW_MS = 10 * 60_000L

        /** 进程共享的 OkHttp：HTTP 与 WebSocket 共用连接池；15 秒调用超时，15 秒 WS ping 检测半开连接。 */
        private val sharedHttp: OkHttpClient by lazy {
            OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).pingInterval(15, TimeUnit.SECONDS).build()
        }

        /** 生产入口：SharedPreferences 存储、系统单调时钟、OkHttp 传输、Main.immediate 调度。 */
        fun create(context: Context, diag: Diagnostics): RoomClient {
            val http = sharedHttp
            return RoomClient(
                SharedPrefsStore(context), diag, SystemClock::elapsedRealtime,
                okHttpTransport(http), okHttpProbe(http), http, http, CoverCache(java.io.File(context.cacheDir, "covers")),
                LrcCache(java.io.File(context.cacheDir, "lyrics")),
                Dispatchers.Main.immediate
            )
        }
    }
}

/** 检索期间曲库更新：旧分页结果全部作废，调用方清页重查（协议「界面与检索流程」）。 */
internal class CatalogChangedException : IOException("曲库已更新，请重新搜索")
