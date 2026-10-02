package com.listentogether.app

import com.listentogether.app.network.CatalogChangedException
import com.listentogether.app.network.CatalogPage
import com.listentogether.app.network.Track
import com.listentogether.app.ui.CatalogSearchState
import com.listentogether.app.ui.appendCatalogPage
import com.listentogether.app.ui.queueEdgeScroll
import com.listentogether.app.ui.queueMoveAnchor
import com.listentogether.app.ui.QueueSwipeResult
import com.listentogether.app.ui.resolveQueueSwipe
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

/** UI 意图与异步恢复回归；假分页与虚拟时钟不访问设备或公网。 */
@OptIn(ExperimentalCoroutinesApi::class)
class RoomUiInteractionTest {
    @Test fun firstSwipeOnlyRevealsEvenWhenVeryLong() {
        assertEquals(QueueSwipeResult.Revealed, resolveQueueSwipe(false, -1000f, 36f))
        assertEquals(QueueSwipeResult.Closed, resolveQueueSwipe(false, -20f, 36f))
    }
    @Test fun secondSwipeDeletesButSmallMovementKeepsActionVisible() {
        assertEquals(QueueSwipeResult.Delete, resolveQueueSwipe(true, -60f, 36f))
        assertEquals(QueueSwipeResult.Revealed, resolveQueueSwipe(true, -20f, 36f))
    }
    @Test fun rightSwipeClosesWithoutDeleting() {
        assertEquals(QueueSwipeResult.Closed, resolveQueueSwipe(true, 60f, 36f))
        assertEquals(QueueSwipeResult.Closed, resolveQueueSwipe(false, 60f, 36f))
    }
    private fun page(offset: Int, count: Int, total: Int = 45, revision: String = "r1") = CatalogPage(revision, total, offset,
        (offset until offset + count).map { Track("t$it", "歌曲$it", 1000) })

    @Test fun dragAnchorUsesFinalOrderAtBothEnds() {
        assertEquals("a", queueMoveAnchor(listOf("a", "b", "c"), "c", 0))
        assertEquals("c", queueMoveAnchor(listOf("a", "b", "c"), "a", 1))
        assertNull(queueMoveAnchor(listOf("a", "b", "c"), "a", 2))
    }
    @Test fun edgeScrollHasDirectionAndBound() {
        assertEquals(-12f, queueEdgeScroll(-20f, 500f, 64f, 12f), 0f)
        assertEquals(0f, queueEdgeScroll(250f, 500f, 64f, 12f), 0f)
        assertEquals(12f, queueEdgeScroll(600f, 500f, 64f, 12f), 0f)
    }
    @Test fun pagingAppends45TracksAndDeduplicates() = runTest {
        val offsets = mutableListOf<Int>()
        val state = CatalogSearchState { _, offset, _ -> offsets += offset; page(offset, if (offset == 0) 30 else 15) }
        state.loadFirst(""); state.loadMore(""); state.loadMore("")
        assertEquals(45, state.page!!.items.size)
        assertEquals(listOf(0, 30), offsets)
        assertEquals(45, appendCatalogPage(page(0, 30), page(25, 20)).items.size)
    }
    @Test fun delayedMoreCannotOverwriteNewQuery() = runTest {
        val state = CatalogSearchState { query, offset, _ ->
            if (offset > 0) delay(1000)
            if (query == "new") page(99, 1, 1) else page(offset, if (offset == 0) 30 else 15)
        }
        state.loadFirst("old")
        val more = launch { state.loadMore("old") }; runCurrent()
        state.invalidate(); state.loadFirst("new")
        more.join()
        assertEquals(listOf("t99"), state.page!!.items.map { it.id })
    }
    @Test fun catalogChangedClearsPagesAndRestartsFirstPage() = runTest {
        val state = CatalogSearchState { _, offset, _ -> if (offset > 0) throw CatalogChangedException() else page(0, 30) }
        state.loadFirst(""); state.loadMore("")
        assertNull(state.page); assertEquals(1, state.reload)
        state.loadFirst(""); assertEquals(30, state.page!!.items.size)
    }
    @Test fun failedMoreKeepsFirstPageAndRetryOffset() = runTest {
        var fail = true
        val state = CatalogSearchState { _, offset, _ ->
            if (offset > 0 && fail) throw java.io.IOException("网络错误")
            page(offset, if (offset == 0) 30 else 15)
        }
        state.loadFirst(""); state.loadMore("")
        assertEquals(30, state.page!!.items.size); assertNotNull(state.error)
        fail = false; state.loadMore(""); assertEquals(45, state.page!!.items.size)
    }
    @Test fun thousandTracksUsesEveryOffsetOnce() = runTest {
        val state = CatalogSearchState { _, offset, _ -> page(offset, minOf(30, 1000 - offset), 1000) }
        state.loadFirst("")
        repeat(34) { state.loadMore("") }
        assertEquals(1000, state.page!!.items.size)
        assertEquals(1000, state.page!!.items.distinctBy { it.id }.size)
    }
}
