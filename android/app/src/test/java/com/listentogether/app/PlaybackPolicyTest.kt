package com.listentogether.app

import com.listentogether.app.sync.PlaybackPolicy
import org.junit.Assert.*
import org.junit.Test

class PlaybackPolicyTest {
    @Test fun disconnectPausesEvenWhenRoomIsPlaying() { assertFalse(PlaybackPolicy.shouldPlay(false, true, false)) }
    @Test fun interruptionSurvivesFurtherPlayingSnapshots() { repeat(5) { assertFalse(PlaybackPolicy.shouldPlay(true, true, true)) } }
    @Test fun explicitResumeFollowsPlayingRoom() { assertTrue(PlaybackPolicy.shouldPlay(true, true, false)) }
    @Test fun localResumeCannotOverridePausedRoom() { assertFalse(PlaybackPolicy.shouldPlay(true, false, false)) }

    @Test fun loadAndPauseResetActualPlayerSpeedEvenDuringBuffering() {
        for (speed in listOf(0.88f, 1.12f)) {
            assertEquals(1.0f, PlaybackPolicy.correctionSpeed(speed, 1000, true, true), 0f)
        }
    }
    @Test fun hardSeekResetsBothFastAndSlowCorrection() {
        assertEquals(1.0f, PlaybackPolicy.correctionSpeed(1.12f, 3000, false, false), 0f)
        assertEquals(1.0f, PlaybackPolicy.correctionSpeed(0.88f, -3000, false, false), 0f)
    }
    @Test fun bufferingDefersCorrectionUnlessExplicitlyReset() {
        assertEquals(1.12f, PlaybackPolicy.correctionSpeed(1.12f, 3000, true, false), 0f)
    }
    @Test fun catchupFinishesAtBoundaryAndPreservesHysteresis() {
        assertEquals(1.0f, PlaybackPolicy.correctionSpeed(1.12f, 300, false, false), 0f)
        assertEquals(1.12f, PlaybackPolicy.correctionSpeed(1.12f, 400, false, false), 0f)
    }
    @Test fun smallDriftUsesBoundedSpeedInBothDirections() {
        assertEquals(1.04f, PlaybackPolicy.correctionSpeed(1.0f, 1000, false, false), 0.0001f)
        assertEquals(0.96f, PlaybackPolicy.correctionSpeed(1.0f, -1000, false, false), 0.0001f)
    }
}
