package com.listentogether.app.sync

object PlaybackPolicy {
    // 本地中断优先于共享播放状态，房主也不例外；只有明确恢复动作清除中断。
    fun shouldPlay(synchronized: Boolean, roomPlaying: Boolean, locallyPaused: Boolean): Boolean =
        synchronized && roomPlaying && !locallyPaused
}
