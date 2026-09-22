package com.listentogether.app.sync

import kotlin.math.abs

object SyncMath {
    // 服务器时钟和手机时钟不能直接相减；收发时间中点估计偏移，所有单位为毫秒。
    fun offset(sent: Long, received: Long, server: Long): Long = server - (sent + (received - sent) / 2)
    fun target(position: Long, timestamp: Long, playing: Boolean, serverNow: Long, duration: Long): Long =
        (position + if (playing) (serverNow - timestamp).coerceAtLeast(0) else 0).coerceIn(0, duration)
    fun needsSeek(actual: Long, expected: Long): Boolean = abs(actual - expected) > 500
}
