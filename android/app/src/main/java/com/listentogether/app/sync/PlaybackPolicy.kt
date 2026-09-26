package com.listentogether.app.sync

import kotlin.math.abs

object PlaybackPolicy {
    // 本地中断优先于共享播放状态，房主也不例外；只有明确恢复动作清除中断。
    fun shouldPlay(synchronized: Boolean, roomPlaying: Boolean, locallyPaused: Boolean): Boolean =
        synchronized && roomPlaying && !locallyPaused

    /**
     * 以播放器实际倍速为基准决定纠正倍速；漂移单位为毫秒（目标减实际）。
     * 暂停/换曲强制原速，缓冲中保留当前倍速；大漂移 seek 同时复位，避免缓存与播放器脱节。
     */
    fun correctionSpeed(currentSpeed: Float, driftMs: Long, buffering: Boolean, reset: Boolean): Float {
        if (reset) return 1.0f
        if (buffering) return currentSpeed
        if (abs(driftMs) > SyncMath.SPEED_MAX_DRIFT_MS || abs(driftMs) <= SyncMath.SPEED_DONE_MS) return 1.0f
        if (!SyncMath.needsSeek(0, driftMs)) return currentSpeed
        val desired = SyncMath.catchupSpeed(driftMs)
        return if (abs(desired - currentSpeed) >= 0.01f) desired else currentSpeed
    }
}
