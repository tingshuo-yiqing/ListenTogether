package com.listentogether.app

import com.listentogether.app.sync.ClockEstimator
import org.junit.Assert.*
import org.junit.Test

class ClockEstimatorTest {
    // 可控单调时钟：测试直接推进时间，不 sleep、不依赖系统时钟。
    private class FakeClock(var now: Long = 1_000) { fun tick(ms: Long) { now += ms } }

    private fun estimator(clock: FakeClock, config: ClockEstimator.Config = ClockEstimator.Config()) =
        ClockEstimator({ clock.now }, config)

    @Test fun picksSampleWithShortestRoundTrip() {
        val clock = FakeClock(); val e = estimator(clock)
        e.add(1_000, 1_800, 9_000) // RTT 800 → offset 7600
        clock.tick(10)
        e.add(1_010, 1_210, 9_100) // RTT 200 → offset 7990，应被选中
        clock.tick(10)
        e.add(1_020, 1_920, 9_000) // RTT 900 → offset 7530
        assertEquals(7_990L, e.offsetMs())
    }

    @Test fun rejectsNegativeRoundTripAndInvalidTimes() {
        val clock = FakeClock(); val e = estimator(clock)
        assertNull(e.add(1_500, 1_400, 9_000)) // received < sent：负 RTT
        assertNull(e.add(0, 1_400, 9_000))     // 发送时间非法
        assertNull(e.add(1_400, 1_500, 0))     // 服务器时间非法
        assertNull(e.offsetMs())
    }

    @Test fun ignoresRttAboveLimit() {
        val clock = FakeClock()
        val e = estimator(clock, ClockEstimator.Config(maxRttMs = 1_500))
        e.add(1_000, 2_500, 9_000) // RTT 1500：达标 → offset 7250
        clock.tick(5)
        e.add(1_005, 2_510, 9_000) // RTT 1505：超标，不参与估计
        assertEquals(7_250L, e.offsetMs())
    }

    @Test fun dropsSamplesAfterTtl() {
        val clock = FakeClock(); val e = estimator(clock)
        e.add(1_000, 1_200, 9_000)
        clock.tick(45_001)
        assertNull(e.offsetMs())
    }

    @Test fun keepsOnlyLatestWindow() {
        val clock = FakeClock()
        val e = estimator(clock, ClockEstimator.Config(maxSamples = 2))
        e.add(1_000, 1_100, 9_000) // RTT 100 → offset 7950，随后被挤出窗口
        clock.tick(5)
        e.add(1_005, 1_305, 9_000) // RTT 300 → offset 7845
        clock.tick(5)
        e.add(1_010, 1_510, 9_000) // RTT 500 → offset 7740
        assertEquals(7_845L, e.offsetMs())
    }

    @Test fun clearDropsEverythingForNewSession() {
        val clock = FakeClock(); val e = estimator(clock)
        e.add(1_000, 1_200, 9_000)
        e.clear()
        assertNull(e.offsetMs())
    }
}
