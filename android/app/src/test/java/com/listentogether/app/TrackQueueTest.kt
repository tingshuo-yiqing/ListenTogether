package com.listentogether.app

import com.listentogether.app.network.Track
import com.listentogether.app.sync.TrackQueue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** 房间歌单切歌顺序回归（纯 JVM，不依赖 Android）。 */
class TrackQueueTest {

    private fun tracks(vararg ids: String) = ids.map { Track(it, "标题-$it", 60_000) }

    @Test
    fun emptyPlaylistReturnsNull() {
        assertNull(TrackQueue.skip(emptyList(), "a", 1))
        assertNull(TrackQueue.skip(emptyList(), null, -1))
    }

    @Test
    fun nextAndPreviousWalkInOrder() {
        val list = tracks("a", "b", "c")
        assertEquals("b", TrackQueue.skip(list, "a", 1))
        assertEquals("a", TrackQueue.skip(list, "b", -1))
        assertEquals("c", TrackQueue.skip(list, "b", 1))
    }

    @Test
    fun skipWrapsAroundAtBothEnds() {
        val list = tracks("a", "b", "c")
        assertEquals("a", TrackQueue.skip(list, "c", 1))
        assertEquals("c", TrackQueue.skip(list, "a", -1))
    }

    @Test
    fun missingCurrentFallsToEdge() {
        val list = tracks("a", "b", "c")
        assertEquals("a", TrackQueue.skip(list, null, 1))
        assertEquals("c", TrackQueue.skip(list, null, -1))
        assertEquals("a", TrackQueue.skip(list, "not-in-list", 1))
    }

    @Test
    fun singleTrackSkipsToItself() {
        val list = tracks("only")
        assertEquals("only", TrackQueue.skip(list, "only", 1))
        assertEquals("only", TrackQueue.skip(list, "only", -1))
    }
}
