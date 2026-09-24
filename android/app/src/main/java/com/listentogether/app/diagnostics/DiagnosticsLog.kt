package com.listentogether.app.diagnostics

import android.content.Context
import android.os.Build
import android.os.SystemClock
import com.listentogether.app.BuildConfig
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * 诊断边界：网络与播放模块只依赖此接口，不依赖具体落盘实现；
 * JVM 单测可替换为空实现或内存记录，保证会话竞态测试不触碰文件系统。
 */
interface Diagnostics {
    fun connection(event: String, roomCode: String?, detail: String)
    fun sync(roomCode: String, trackId: String?, version: Long, rttMs: Long, offsetMs: Long)
    fun playback(roomCode: String?, trackId: String?, version: Long, playerPositionMs: Long, targetPositionMs: Long, driftMs: Long, buffering: Boolean, localPause: Boolean, correction: String, estimatedServerMs: Long)
}

/**
 * Debug 客户端本地诊断日志（JSONL），用于双机同步与稳定性测试的事后对齐分析。
 *
 * - 仅 debug 构建启用；release 构建所有方法为空操作，不进入生产协议，也不上传。
 * - 不写入令牌、Authorization 或完整请求头；只有房间码、曲目 ID、状态版本等测试字段。
 * - 每次进程启动写一个文件：filesDir/diagnostics/diag-<启动时刻>.jsonl。
 * - 限制：单文件 20MB、采集窗口 60 分钟，超限后停止写入；测试结束后由人工导出/删除。
 * - 写入在单线程后台执行，失败静默：诊断自身的问题不允许影响网络或播放。
 *
 * 可替换边界：[wallMs]/[monoMs]/[dir]/[executor] 可通过内部构造器注入，
 * JVM 单测可控制时钟与文件系统，不依赖 Android 框架。
 */
class DiagnosticsLog internal constructor(
    private val enabled: Boolean,
    private val deviceLabel: String,
    private val dir: File,
    private val wallMs: () -> Long,
    private val monoMs: () -> Long,
    private val executor: ExecutorService,
    private val maxBytes: Long = MAX_BYTES,
    private val maxWindowMs: Long = MAX_WINDOW_MS
) : Diagnostics {
    private val startedWallMs = wallMs()
    private var file: File? = null
    private var writtenBytes = 0L

    /** 生产入口：SharedPreferences 存储、系统时钟、单线程守护线程执行器。 */
    constructor(context: Context) : this(
        BuildConfig.DEBUG,
        Build.MANUFACTURER.trim() + " " + Build.MODEL,
        File(context.filesDir, "diagnostics"),
        System::currentTimeMillis,
        SystemClock::elapsedRealtime,
        Executors.newSingleThreadExecutor { task -> Thread(task, "diagnostics").apply { isDaemon = true } }
    )

    /** 连接事件：入房、Socket 打开/断开、重连、指令等；detail 只含代次、错误类名等非敏感信息。 */
    override fun connection(event: String, roomCode: String?, detail: String) =
        event("connection", mapOf("event" to event, "roomCode" to roomCode, "detail" to detail))

    /**
     * 校时事件：记录本次样本 RTT 与当前估计偏移（毫秒）。
     * estimatedServerMs 用手机单调时钟加偏移推算，两台设备按它对齐比较进度。
     */
    override fun sync(roomCode: String, trackId: String?, version: Long, rttMs: Long, offsetMs: Long) = event(
        "sync",
        mapOf(
            "roomCode" to roomCode, "trackId" to trackId, "version" to version,
            "rttMs" to rttMs, "offsetMs" to offsetMs,
            "estimatedServerMs" to monoMs() + offsetMs
        )
    )

    /**
     * 播放事件：记录目标位置、实际位置、偏差、缓冲与本地暂停，以及本次纠正方式。
     * correction 取值：load（装载新曲目）、seek（漂移超过 2.5s 的硬纠正）、
     * speed（500ms–2.5s 之间的连续变速追赶，不出声缺口）、
     * buffering（缓冲状态变化）、error:XXX（播放错误）、空串（无需纠正）。
     */
    override fun playback(roomCode: String?, trackId: String?, version: Long, playerPositionMs: Long, targetPositionMs: Long, driftMs: Long, buffering: Boolean, localPause: Boolean, correction: String, estimatedServerMs: Long) = event(
        "playback",
        mapOf(
            "roomCode" to roomCode, "trackId" to trackId, "version" to version,
            "playerPositionMs" to playerPositionMs, "targetPositionMs" to targetPositionMs, "driftMs" to driftMs,
            "buffering" to buffering, "localPause" to localPause, "correction" to correction,
            "estimatedServerMs" to estimatedServerMs
        )
    )

    private fun event(type: String, fields: Map<String, Any?>) {
        if (!enabled) return
        executor.execute {
            runCatching {
                if (wallMs() - startedWallMs > maxWindowMs) return@execute
                if (writtenBytes > maxBytes) return@execute
                val target = file ?: newFile().also { file = it }
                val line = JSONObject().apply {
                    put("type", type)
                    put("deviceLabel", deviceLabel)
                    put("wallClockMs", wallMs())
                    put("monotonicMs", monoMs())
                    fields.forEach { (key, value) -> if (value != null) put(key, value) }
                }.toString() + "\n"
                target.appendText(line)
                writtenBytes += line.toByteArray().size
            }
        }
    }

    private fun newFile(): File {
        dir.mkdirs()
        return File(dir, "diag-" + SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date(startedWallMs)) + ".jsonl")
    }

    companion object {
        const val MAX_BYTES = 20L * 1024 * 1024
        const val MAX_WINDOW_MS = 60L * 60 * 1000
    }
}
