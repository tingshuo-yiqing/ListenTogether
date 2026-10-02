package com.listentogether.app

import com.listentogether.app.network.SnapshotCollector
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SnapshotCollectorTest {
    private fun chunk(id: String = "id", version: Long = 1, index: Int = 0, count: Int = 2, text: String = "entry") =
        JSONObject().put("type", "queue.state").put("snapshotId", id).put("queueVersion", version)
            .put("chunkIndex", index).put("chunkCount", count).put("entries", JSONArray().put(text))

    @Test fun outOfOrderChunksAreAtomicAndRepeatedChunksDoNotCompleteEarly() = runTest {
        var recovered = 0
        val c = SnapshotCollector(this, "entries", "queueVersion", { 512 * 1024 }, { recovered++ })
        assertNull(c.accept(chunk(index = 1, text = "second")))
        assertNull(c.accept(chunk(index = 1, text = "second")))
        val result = c.accept(chunk(text = "first"))!!
        assertEquals(listOf("first", "second"), (0..1).map { result.getJSONArray("entries").getString(it) })
        assertEquals(0, c.bytes); assertEquals(0, recovered)
        advanceTimeBy(5001); runCurrent(); assertEquals(0, recovered)
        assertNull(c.accept(chunk()))
    }

    @Test fun missingChunkClearsBudgetAndRequestsRecoveryOnce() = runTest {
        var recovered = 0
        val c = SnapshotCollector(this, "entries", "queueVersion", { 512 * 1024 }, { recovered++ })
        c.accept(chunk()); assertTrue(c.bytes > 0)
        advanceTimeBy(5001); runCurrent()
        assertEquals(0, c.bytes); assertEquals(1, recovered)
        advanceTimeBy(5001); runCurrent(); assertEquals(1, recovered)
    }

    @Test fun newVersionRetiresOldAssemblyRegardlessOfRandomId() = runTest {
        val c = SnapshotCollector(this, "entries", "queueVersion", { 512 * 1024 }, {})
        c.accept(chunk(id = "zz", version = 1))
        c.accept(chunk(id = "aa", version = 2))
        assertNull(c.accept(chunk(id = "zz", version = 1, index = 1)))
        assertEquals(2L, c.accept(chunk(id = "aa", version = 2, index = 1))!!.getLong("queueVersion"))
    }

    @Test fun metadataMismatchAndConflictingDuplicateRecoverWithoutPublishing() = runTest {
        var recovered = 0
        val c = SnapshotCollector(this, "entries", "queueVersion", { 512 * 1024 }, { recovered++ })
        c.accept(chunk()); assertNull(c.accept(chunk(version = 2, index = 1)))
        assertEquals(1, recovered); assertEquals(0, c.bytes)
        c.accept(chunk(id = "second")); assertNull(c.accept(chunk(id = "second", text = "changed")))
        assertEquals(2, recovered); assertEquals(0, c.bytes)
    }

    @Test fun sharedBudgetAndMaximumFrameAreCheckedBeforeRetaining() = runTest {
        var recovered = 0
        lateinit var c: SnapshotCollector
        c = SnapshotCollector(this, "entries", "queueVersion", { 512 * 1024 - c.bytes }, { recovered++ })
        for (i in 0..17) c.accept(chunk(index = i, count = 100, text = "x".repeat(30000)))
        assertEquals(1, recovered); assertEquals(0, c.bytes)
        assertNull(c.accept(chunk(id = "oversize", text = "x".repeat(32768))))
        assertEquals(2, recovered); assertEquals(0, c.bytes)
    }

    @Test fun sessionResetCancelsDeadlineAndAllowsSameIdInNewSession() = runTest {
        var recovered = 0
        val c = SnapshotCollector(this, "entries", "queueVersion", { 512 * 1024 }, { recovered++ })
        c.accept(chunk()); c.clear(true)
        advanceTimeBy(5001); runCurrent(); assertEquals(0, recovered)
        assertNotNull(c.accept(chunk(count = 1)))
    }

    @Test fun invalidIndexCannotBeCountedAsComplete() = runTest {
        val c = SnapshotCollector(this, "entries", "queueVersion", { 512 * 1024 }, {})
        for (bad in listOf(chunk(index = -1), chunk(index = 2), chunk(count = 0), chunk(count = 101))) {
            assertThrows(IllegalArgumentException::class.java) { c.accept(bad) }
        }
        assertEquals(0, c.bytes)
    }
}
