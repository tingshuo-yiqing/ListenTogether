package com.listentogether.app

import com.listentogether.app.network.*
import com.listentogether.app.ui.*
import org.junit.Assert.*
import org.junit.Test

/** 覆盖连接成功但音频失败、换曲迟到观测与入房错误的界面回归。 */
class PlaybackViewTest {
    private val ready = UiState(
        status = ConnectionStatus.Ready, message = "已同步",
        room = RoomState("host", emptyList(), "song", true, 0, 0, 1)
    )
    private val player = PlaybackView(mediaId = "song")

    @Test fun connectedAudioFailureRemainsVisible() {
        assertTrue(showStatusNotice(ready, player.copy(failed = true)))
    }
    @Test fun oldTrackObservationCannotNoticeNewTrack() {
        val old = player.copy(mediaId = "old", failed = true)
        assertFalse(showStatusNotice(ready, old))
    }
    @Test fun normalSyncIsCompactButPauseAndNoticeAreNotHidden() {
        assertFalse(showStatusNotice(ready, player))
        assertTrue(showStatusNotice(ready.copy(locallyPaused = true), player))
        assertTrue(showStatusNotice(ready.copy(message = "进度跳转未确认，请重试"), player))
    }
    @Test fun failedJoinHasInlineFeedbackWithoutCredentials() {
        assertEquals("连接失败", joinError(UiState(message = "连接失败")))
        assertNull(joinError(UiState(status = ConnectionStatus.Joining, message = "正在连接服务器")))
        assertNull(joinError(UiState()))
    }
}
