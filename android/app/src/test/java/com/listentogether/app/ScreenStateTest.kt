package com.listentogether.app

import com.listentogether.app.network.ConnectionStatus
import com.listentogether.app.network.Credentials
import com.listentogether.app.network.RoomState
import com.listentogether.app.network.Track
import com.listentogether.app.network.UiState
import com.listentogether.app.ui.screenStates
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/** 验证进度隔离不会吞掉切歌、断线、退出和 seek 确认快照。 */
class ScreenStateTest {
    @Test fun positionSamplesDoNotRefreshScreen() = runTest {
        val base = UiState(status = ConnectionStatus.Ready)
        val result = (0..100).map { base.copy(positionMs = it * 500L) }.asFlow().screenStates().toList()
        assertEquals(listOf(base), result)
    }

    @Test fun businessChangesStillReachScreen() = runTest {
        val base = UiState(credentials = Credentials("12345678", "member", "token"))
        val states = listOf(base, base.copy(tracks = listOf(Track("a", "歌曲", 120000))),
            base.copy(status = ConnectionStatus.Reconnecting, message = "断线"),
            base.copy(locallyPaused = true), UiState())
        assertEquals(states, states.asFlow().screenStates().toList())
    }

    @Test fun seekConfirmationVersionAndPositionArePreserved() = runTest {
        val room = RoomState("host", emptyList(), "a", true, 40000, 1000, 1)
        val before = UiState(room = room)
        val after = before.copy(room = room.copy(positionMs = 0, version = 2), positionMs = 900)
        val result = listOf(before, after).asFlow().screenStates().toList()
        assertEquals(2, result.size)
        assertEquals(after.room, result.last().room)
    }
}
