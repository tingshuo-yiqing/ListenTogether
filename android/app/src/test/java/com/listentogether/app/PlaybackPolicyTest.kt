package com.listentogether.app

import com.listentogether.app.sync.PlaybackPolicy
import org.junit.Assert.*
import org.junit.Test

class PlaybackPolicyTest {
    @Test fun disconnectPausesEvenWhenRoomIsPlaying() { assertFalse(PlaybackPolicy.shouldPlay(false, true, false)) }
    @Test fun interruptionSurvivesFurtherPlayingSnapshots() { repeat(5) { assertFalse(PlaybackPolicy.shouldPlay(true, true, true)) } }
    @Test fun explicitResumeFollowsPlayingRoom() { assertTrue(PlaybackPolicy.shouldPlay(true, true, false)) }
    @Test fun localResumeCannotOverridePausedRoom() { assertFalse(PlaybackPolicy.shouldPlay(true, false, false)) }
}
