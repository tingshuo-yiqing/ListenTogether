package com.listentogether.app.ui

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/** 页面主线程采样的歌词跟随状态；current 为行下标，-1 表示尚未进入首行。 */
internal data class LyricsFollowPosition(val current: Int, val manualPaused: Boolean)

/**
 * 当前行变化或手动翻看结束时重新给出跟随目标；null 通知调用方取消正在进行的滚动。
 * 暂停标记必须参与去重：暂停前后即使仍是同一行，也要再次发出该行，不能等下一句才归位。
 * 不做 IO 或定时；恢复时机由界面在手势与惯性滚动全部停止后决定。
 */
internal fun Flow<LyricsFollowPosition>.lyricsFollowTargets(): Flow<Int?> =
    map { if (it.manualPaused || it.current < 0) null else it.current }.distinctUntilChanged()
