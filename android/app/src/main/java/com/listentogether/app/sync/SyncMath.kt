package com.listentogether.app.sync

import kotlin.math.abs

object SyncMath {
    // 服务器时钟和手机时钟不能直接相减；收发时间中点估计偏移，所有单位为毫秒。
    fun offset(sent: Long, received: Long, server: Long): Long = server - (sent + (received - sent) / 2)
    fun target(position: Long, timestamp: Long, playing: Boolean, serverNow: Long, duration: Long): Long =
        (position + if (playing) (serverNow - timestamp).coerceAtLeast(0) else 0).coerceIn(0, duration)
    fun needsSeek(actual: Long, expected: Long): Boolean = abs(actual - expected) > 500

    /**
     * 纠正手段分级边界：|漂移|超过此值（毫秒）才允许真正 seek。
     * 真机实测（2026-09-23，PHQ110）发现"渲染欠载型漂移"：省电降频/后台负载让音频位置以 ~0.86x
     * 慢于服务端，期间无缓冲、无暂停。若每次超过 500ms 就 seek，会形成
     * "seek → 丢弃已缓冲数据 → 重新起流 → 声音缺口 → 又落后"的 seek 风暴（实测每 5 秒一次、贯穿全程）。
     * 因此 500ms 仍是 needsSeek 的"需要纠正"触发线，但 500ms–2.5s 之间改用连续变速追赶。
     */
    const val SPEED_MAX_DRIFT_MS = 2_500L

    /** 漂移回到此值（毫秒）以内即恢复 1.0 倍速。 */
    const val SPEED_DONE_MS = 300L

    /**
     * 连续变速追赶的目标倍速（变速不变调，Sonic 处理）。
     * 追赶系数 = 漂移 / 25 秒，限制在 ±4%~±12%：小漂移保底 ±4% 保证仍在推进，
     * 大漂移封顶 ±12% 避免可闻的快放；回 [SPEED_DONE_MS] 内恢复原速。
     * 正漂移（落后于服务端）加速，负漂移（领先）减速；返回值恒为正且有限。
     */
    fun catchupSpeed(driftMs: Long): Float {
        if (abs(driftMs) <= SPEED_DONE_MS) return 1.0f
        val ratio = (driftMs / 25_000.0).coerceIn(-0.12, 0.12)
        val floor = if (driftMs > 0) 0.04 else -0.04
        val step = if (abs(ratio) < 0.04) floor else ratio
        return (1.0 + step).toFloat()
    }
}
