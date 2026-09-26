package com.listentogether.app

import com.listentogether.app.ui.SEEK_CONFIRM_TOLERANCE_MS
import com.listentogether.app.ui.seekConfirmed
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * seek 快照确认判定（E-07 确认模型的纯函数化）：
 * 用相对贴合而非单向 `positionMs >= target - 余量`，避免低目标 seek 对任意非负位置恒真；
 * elapsed 由 [com.listentogether.app.ui.RoomPlayerState.elapsedSinceSeekMs] 以单调时钟提供，墙钟不得参与。
 */
class SeekConfirmTest {

    @Test fun olderOrSameSnapshotNeverConfirms() {
        assertFalse(seekConfirmed(10_000, snapshotVersion = 5, pendingSeekVersion = 5, snapshotPositionMs = 10_000, elapsedMs = 0))
        assertFalse(seekConfirmed(10_000, snapshotVersion = 4, pendingSeekVersion = 5, snapshotPositionMs = 10_000, elapsedMs = 0))
    }

    @Test fun newPositionWithinWindowConfirms() {
        assertTrue(seekConfirmed(10_000, snapshotVersion = 6, pendingSeekVersion = 5, snapshotPositionMs = 10_400, elapsedMs = 0))
        assertTrue(
            seekConfirmed(
                10_000, snapshotVersion = 6, pendingSeekVersion = 5,
                snapshotPositionMs = 10_000 + SEEK_CONFIRM_TOLERANCE_MS + 800, elapsedMs = 800
            )
        )
    }

    @Test fun distantPositionNeedsPlaybackToEnterWindow() {
        // 拖回开头：快照仍在 2 秒处且 elapsed 尚短 → 不确认；播放推进使距离进入窗口后才确认。
        assertFalse(seekConfirmed(0, snapshotVersion = 6, pendingSeekVersion = 5, snapshotPositionMs = 2_000, elapsedMs = 0))
        assertTrue(seekConfirmed(0, snapshotVersion = 6, pendingSeekVersion = 5, snapshotPositionMs = 2_000, elapsedMs = 600))
    }

    @Test fun negativeElapsedCannotConfirmArbitraryPosition() {
        // 墙钟回拨会产生负 elapsed；单调时钟下不应出现，但判定本身不得因此放行任意位置。
        assertFalse(seekConfirmed(0, snapshotVersion = 6, pendingSeekVersion = 5, snapshotPositionMs = 60_000, elapsedMs = -55_000))
    }
}
