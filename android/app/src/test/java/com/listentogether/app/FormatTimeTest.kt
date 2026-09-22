package com.listentogether.app

import org.junit.Assert.assertEquals
import org.junit.Test

/** 进度时间格式化：1 小时内 m:ss，超过 1 小时 h:mm:ss（demo-hour 70 分钟显示 1:10:00）。 */
class FormatTimeTest {
    @Test
    fun zeroFormatsAsMinuteSecond() {
        assertEquals("0:00", formatTime(0))
    }

    @Test
    fun subHourUsesMinuteSecond() {
        assertEquals("1:05", formatTime(65_000))
        assertEquals("10:56", formatTime(656_000))
    }

    @Test
    fun hourBoundaryFormatsWithHours() {
        assertEquals("1:00:00", formatTime(3_600_000))
        assertEquals("1:01:00", formatTime(3_660_000))
    }

    @Test
    fun longTrackFormatsWithHours() {
        assertEquals("1:10:00", formatTime(4_200_000))
    }
}
