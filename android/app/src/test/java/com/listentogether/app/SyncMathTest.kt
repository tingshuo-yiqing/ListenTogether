package com.listentogether.app

import com.listentogether.app.sync.SyncMath
import org.junit.Assert.*
import org.junit.Test

class SyncMathTest {
    @Test fun accountsForClockDifferenceAndHalfRoundTrip() { assertEquals(990L, SyncMath.offset(100, 120, 1100)) }
    @Test fun pausedDoesNotAdvance() { assertEquals(3000L, SyncMath.target(3000, 1000, false, 9000, 20000)) }
    @Test fun clampsAtSongEnd() { assertEquals(10000L, SyncMath.target(9000, 1000, true, 5000, 10000)) }
    @Test fun futureBaselineDoesNotGoBackwards() { assertEquals(3000L, SyncMath.target(3000, 9000, true, 1000, 10000)) }
    @Test fun toleratesSmallDrift() { assertFalse(SyncMath.needsSeek(1000, 1500)); assertTrue(SyncMath.needsSeek(1000, 1501)) }

    @Test fun catchupSpeedNormalWithinDoneBand() {
        assertEquals(1.0f, SyncMath.catchupSpeed(0), 1e-6f)
        assertEquals(1.0f, SyncMath.catchupSpeed(300), 1e-6f)
        assertEquals(1.0f, SyncMath.catchupSpeed(-300), 1e-6f)
    }
    @Test fun catchupSpeedUsesFloorForSmallDrift() {
        assertEquals(1.04f, SyncMath.catchupSpeed(400), 1e-6f)
        assertEquals(1.04f, SyncMath.catchupSpeed(700), 0.001f)
        assertEquals(0.96f, SyncMath.catchupSpeed(-700), 0.001f)
    }
    @Test fun catchupSpeedCapsForLargeDrift() {
        assertEquals(1.12f, SyncMath.catchupSpeed(5_000), 1e-6f)
        assertEquals(1.12f, SyncMath.catchupSpeed(120_000), 1e-6f)
        assertEquals(0.88f, SyncMath.catchupSpeed(-5_000), 1e-6f)
    }
}
