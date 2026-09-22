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
    private val player = PlaybackView(connected = true, mediaId = "song")

    @Test fun roomIntentDoesNotPretendToBeAudible() {
        assertEquals("准备中", playbackLabel(ready, player))
        assertEquals("缓冲中", playbackLabel(ready, player.copy(buffering = true)))
        assertEquals("播放中", playbackLabel(ready, player.copy(playing = true)))
    }
    @Test fun connectedAudioFailureRemainsVisible() {
        val failed = player.copy(failed = true)
        assertTrue(showStatusNotice(ready, failed))
        assertEquals("播放失败", playbackLabel(ready, failed))
    }
    @Test fun localPauseAndDisconnectOverrideOldPlayingObservation() {
        val old = player.copy(playing = true)
        assertEquals("本机已暂停", playbackLabel(ready.copy(locallyPaused = true), old))
        assertEquals("等待连接", playbackLabel(ready.copy(status = ConnectionStatus.Reconnecting), old))
    }
    @Test fun oldTrackObservationCannotLabelNewTrack() {
        val old = player.copy(mediaId = "old", playing = true, failed = true)
        assertEquals("准备中", playbackLabel(ready, old))
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
