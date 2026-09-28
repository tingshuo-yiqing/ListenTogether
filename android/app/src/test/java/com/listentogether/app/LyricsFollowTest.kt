package com.listentogether.app

import com.listentogether.app.ui.LyricsFollowPosition
import com.listentogether.app.ui.lyricsFollowTargets
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/** 钉住暂停歌曲手动翻页后不归位的真机回归；测试实际被 UI 消费的目标流。 */
class LyricsFollowTest {
    @Test fun resumesSameLineWithoutPlaybackAdvancing() = runTest {
        val positions = listOf(
            LyricsFollowPosition(8, false),
            LyricsFollowPosition(8, true),
            LyricsFollowPosition(8, false),
        )
        assertEquals(listOf(8, null, 8), positions.asFlow().lyricsFollowTargets().toList())
    }

    @Test fun resumesAtLatestLineAfterManualBrowsing() = runTest {
        val positions = listOf(
            LyricsFollowPosition(8, false),
            LyricsFollowPosition(8, true),
            LyricsFollowPosition(9, true),
            LyricsFollowPosition(10, true),
            LyricsFollowPosition(10, false),
        )
        assertEquals(listOf(8, null, 10), positions.asFlow().lyricsFollowTargets().toList())
    }

    @Test fun doesNotRestartAnimationForUnchangedLine() = runTest {
        val positions = listOf(8, 8, 8, 9, 9).map { LyricsFollowPosition(it, false) }
        assertEquals(listOf(8, 9), positions.asFlow().lyricsFollowTargets().toList())
    }

    @Test fun beforeFirstLineCancelsFollowAndCanReturnToSameLine() = runTest {
        val positions = listOf(0, -1, -1, 0).map { LyricsFollowPosition(it, false) }
        assertEquals(listOf(0, null, 0), positions.asFlow().lyricsFollowTargets().toList())
    }
}
