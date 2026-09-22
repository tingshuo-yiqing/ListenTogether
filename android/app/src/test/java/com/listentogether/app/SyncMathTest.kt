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
}
