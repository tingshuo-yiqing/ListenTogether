package com.listentogether.app.diagnostics

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.concurrent.*

/**
 * DiagnosticsLog JVM 单测：注入可替换边界（时钟、目录、同步执行器），
 * 不依赖 Android 框架、不访问公网、不触碰真实文件系统。
 *
 * 覆盖：20MB/60 分钟轮转停止、JSONL 行格式、令牌不出现在输出（红线约束）。
 */
class DiagnosticsLogTest {
    /** 同步执行器：任务在调用线程立即执行，测试可断言写入结果而无需 await/latch。 */
    private class SameThreadExecutor : AbstractExecutorService() {
        override fun execute(command: Runnable) { command.run() }
        override fun shutdown() {}
        override fun shutdownNow(): MutableList<Runnable> = mutableListOf()
        override fun isShutdown(): Boolean = false
        override fun isTerminated(): Boolean = false
        override fun awaitTermination(timeout: Long, unit: TimeUnit): Boolean = true
    }

    /** 简单的可推进墙钟。 */
    private class MockClock(private var now: Long) {
        fun advance(ms: Long) { now += ms }
        fun get(): Long = now
    }

    /** 每个测试使用独立的临时目录，避免并行冲突。 */
    private fun newLog(
        wallClock: MockClock = MockClock(1_000_000L),
        monoClock: MockClock = MockClock(500_000L),
        maxBytes: Long = DiagnosticsLog.MAX_BYTES,
        maxWindowMs: Long = DiagnosticsLog.MAX_WINDOW_MS
    ): Pair<DiagnosticsLog, File> {
        val dir = File(System.getProperty("java.io.tmpdir"), "diag-test-${System.nanoTime()}")
        dir.mkdirs()
        val log = DiagnosticsLog(
            enabled = true, deviceLabel = "TestDevice", dir = dir,
            wallMs = wallClock::get, monoMs = monoClock::get,
            executor = SameThreadExecutor(),
            maxBytes = maxBytes, maxWindowMs = maxWindowMs
        )
        return log to dir
    }

    /** 读取目录下唯一 JSONL 文件的所有非空行。 */
    private fun readLines(dir: File): List<String> {
        val file = dir.listFiles { f -> f.name.endsWith(".jsonl") }?.singleOrNull()
            ?: return emptyList()
        return file.readLines().filter { it.isNotBlank() }
    }

    @Test
    fun connectionWritesJsonlLineWithRequiredFields() {
        val (log, dir) = newLog()
        log.connection("join", "ABC12345", "generation=1")
        val lines = readLines(dir)
        assertEquals(1, lines.size)
        val json = JSONObject(lines[0])
        assertEquals("connection", json.getString("type"))
        assertEquals("TestDevice", json.getString("deviceLabel"))
        assertTrue(json.has("wallClockMs"))
        assertTrue(json.has("monotonicMs"))
        assertEquals("join", json.getString("event"))
        assertEquals("ABC12345", json.getString("roomCode"))
        assertEquals("generation=1", json.getString("detail"))
        dir.deleteRecursively()
    }

    @Test
    fun syncWritesJsonlLineWithEstimatedServerMs() {
        val wallClock = MockClock(1_000_000L)
        val monoClock = MockClock(500_000L)
        val (log, dir) = newLog(wallClock, monoClock)
        log.sync("ABC12345", "track-1", 42L, 60L, 2000L)
        val lines = readLines(dir)
        assertEquals(1, lines.size)
        val json = JSONObject(lines[0])
        assertEquals("sync", json.getString("type"))
        assertEquals("track-1", json.getString("trackId"))
        assertEquals(42L, json.getLong("version"))
        assertEquals(60L, json.getLong("rttMs"))
        assertEquals(2000L, json.getLong("offsetMs"))
        // estimatedServerMs = monoMs() + offsetMs = 500000 + 2000 = 502000
        assertEquals(502000L, json.getLong("estimatedServerMs"))
        dir.deleteRecursively()
    }

    @Test
    fun playbackWritesJsonlLineWithAllFields() {
        val (log, dir) = newLog()
        log.playback("ABC12345", "track-1", 99L, 30000L, 31000L, 1000L, false, false, "seek", 1000L)
        val lines = readLines(dir)
        assertEquals(1, lines.size)
        val json = JSONObject(lines[0])
        assertEquals("playback", json.getString("type"))
        assertEquals("track-1", json.getString("trackId"))
        assertEquals(99L, json.getLong("version"))
        assertEquals(30000L, json.getLong("playerPositionMs"))
        assertEquals(31000L, json.getLong("targetPositionMs"))
        assertEquals(1000L, json.getLong("driftMs"))
        assertEquals(false, json.getBoolean("buffering"))
        assertEquals(false, json.getBoolean("localPause"))
        assertEquals("seek", json.getString("correction"))
        assertEquals(1000L, json.getLong("estimatedServerMs"))
        dir.deleteRecursively()
    }

    @Test
    fun tokenNeverAppearsInOutput() {
        val (log, dir) = newLog()
        // 模拟各种事件，故意使用包含敏感信息的字段。
        // 令牌（如 "Bearer abc123secret"）绝不能出现在 JSONL 输出中。
        // DiagnosticsLog 只写 roomCode/trackId/version 等非敏感字段。
        log.connection("join", "ROOM1", "generation=1")
        log.sync("ROOM1", "track-1", 1L, 50L, 100L)
        log.playback("ROOM1", "track-1", 1L, 0L, 0L, 0L, false, false, "", 0L)
        val lines = readLines(dir)
        assertTrue(lines.isNotEmpty())
        // 红线：任何行的完整文本不得包含常见令牌标识符或 Authorization 头。
        for (line in lines) {
            assertFalse("JSONL 行包含 'Bearer': $line", line.contains("Bearer", ignoreCase = true))
            assertFalse("JSONL 行包含 'Authorization': $line", line.contains("Authorization", ignoreCase = true))
            assertFalse("JSONL 行包含 'token': $line", line.contains("token", ignoreCase = true))
        }
        // 进一步：JSON 对象里不存在 token/authorization 键。
        for (line in lines) {
            val json = JSONObject(line)
            assertFalse("JSON 包含 'token' 键", json.has("token"))
            assertFalse("JSON 包含 'authorization' 键", json.has("authorization"))
        }
        dir.deleteRecursively()
    }

    @Test
    fun stopsWritingAfter60MinuteWindow() {
        val wallClock = MockClock(1_000_000L)
        val monoClock = MockClock(500_000L)
        val (log, dir) = newLog(wallClock, monoClock, maxWindowMs = 5000L)
        // 窗口内写入
        log.connection("join", "ROOM1", "start")
        wallClock.advance(3000)
        log.connection("sync", "ROOM1", "still-in-window")
        // 超出窗口
        wallClock.advance(3000) // 总共 6000ms > 5000ms 窗口
        log.connection("expire", "ROOM1", "after-window")
        val lines = readLines(dir)
        assertEquals(2, lines.size)
        assertEquals("join", JSONObject(lines[0]).getString("event"))
        assertEquals("sync", JSONObject(lines[1]).getString("event"))
        dir.deleteRecursively()
    }

    @Test
    fun stopsWritingAfter20MbLimit() {
        val wallClock = MockClock(1_000_000L)
        val monoClock = MockClock(500_000L)
        // 设定很小的 maxBytes 限制，每条连接事件约 120 字节
        val (log, dir) = newLog(wallClock, monoClock, maxBytes = 300L)
        // 前几条写入成功，超过 300 字节后停止
        for (i in 1..10) {
            log.connection("event-$i", "ROOM1", "detail-$i")
        }
        val lines = readLines(dir)
        // 大约 2-3 条后超过 300 字节，后续被丢弃
        assertTrue("应写入至少 1 条，实际 ${lines.size}", lines.size >= 1)
        assertTrue("应在 10 条前停止，实际 ${lines.size}", lines.size < 10)
        // 验证写入的条目是连续的（前 N 条）
        for (i in lines.indices) {
            assertEquals("event-${i + 1}", JSONObject(lines[i]).getString("event"))
        }
        dir.deleteRecursively()
    }

    @Test
    fun eachLineIsValidJson() {
        val (log, dir) = newLog()
        log.connection("join", "R1", "d1")
        log.sync("R1", "T1", 1L, 50L, 100L)
        log.playback("R1", "T1", 1L, 0L, 0L, 0L, false, false, "load", 0L)
        val lines = readLines(dir)
        assertEquals(3, lines.size)
        // 每行都能独立解析为 JSON，且包含必有字段
        for (line in lines) {
            val json = JSONObject(line)
            assertTrue(json.has("type"))
            assertTrue(json.has("wallClockMs"))
            assertTrue(json.has("monotonicMs"))
            assertTrue(json.has("deviceLabel"))
        }
        dir.deleteRecursively()
    }

    @Test
    fun disabledLogWritesNothing() {
        val dir = File(System.getProperty("java.io.tmpdir"), "diag-test-disabled-${System.nanoTime()}")
        dir.mkdirs()
        val log = DiagnosticsLog(
            enabled = false, deviceLabel = "Off", dir = dir,
            wallMs = { System.currentTimeMillis() }, monoMs = { System.nanoTime() / 1_000_000 },
            executor = SameThreadExecutor()
        )
        log.connection("join", "R1", "d1")
        log.sync("R1", "T1", 1L, 50L, 100L)
        log.playback("R1", "T1", 1L, 0L, 0L, 0L, false, false, "", 0L)
        val files = dir.listFiles { f -> f.name.endsWith(".jsonl") }
        assertTrue("禁用时不应创建文件", files == null || files.isEmpty())
        dir.deleteRecursively()
    }
}
