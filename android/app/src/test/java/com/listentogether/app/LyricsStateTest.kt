package com.listentogether.app

import com.listentogether.app.network.Track
import com.listentogether.app.ui.LyricsUiState
import com.listentogether.app.ui.lyricsPlaceholderText
import com.listentogether.app.ui.lyricsUiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 歌词区状态判定回归（纯函数、无 IO、无协程）。
 *
 * 钉住的真实缺陷：原实现在"取值为空"分支里又按 `track.hasLyrics` 二分，而 hasLyrics=true 时
 * produceState 初值是 ""（加载中），于是**取值失败**（服务端 404 / 引用文件缺失 / 网络错误）
 * 永远停在「歌词加载中」，「这首歌还没有歌词」实际不可达——真机曾观察到歌词区卡死两分钟以上。
 * 因此这里显式区分"还在取"（""）与"取完没有"（null），并断言两者文案不同。
 */
class LyricsStateTest {

    private fun track(hasLyrics: Boolean) = Track(
        id = "song-1", title = "曲名", durationMs = 1000L, artist = null,
        hasCover = false, coverVer = null, hasLyrics = hasLyrics
    )

    @Test
    fun noTrackIsEmpty() {
        assertEquals(LyricsUiState.Empty, lyricsUiState(hasTrack = false, lyricText = null, hasLyrics = false, lineCount = 0))
        assertNull(lyricsPlaceholderText(LyricsUiState.Empty))
    }

    @Test
    fun emptyTextWithFlagIsLoading() {
        // "" 是 produceState 的初值：还在取，显示加载中
        assertEquals(LyricsUiState.Loading, lyricsUiState(track(hasLyrics = true), "", 0))
        assertEquals("歌词加载中", lyricsPlaceholderText(LyricsUiState.Loading))
    }

    @Test
    fun nullAfterFetchFailureOffersRetryState() {
        // 有歌词引用但读取失败独立显示失败状态，不能停在加载中或误报为没有歌词
        assertEquals(LyricsUiState.Failed, lyricsUiState(track(hasLyrics = true), null, 0))
        assertEquals("歌词暂时没读到", lyricsPlaceholderText(LyricsUiState.Failed))
    }

    @Test
    fun noFlagShowsNoLyrics() {
        // hasLyrics=false 时不请求网络，服务端明确没有歌词引用
        assertEquals(LyricsUiState.NoLyrics, lyricsUiState(track(hasLyrics = false), null, 0))
    }

    @Test
    fun textWithoutTimestampsShowsNoTimeline() {
        // 占位 .lrc（只有注释行，parseLrc 得到 0 行）走"没有时间轴"文案
        assertEquals(LyricsUiState.NoTimeline, lyricsUiState(track(hasLyrics = true), "; 占位说明", 0))
        assertEquals("这首歌的歌词没有时间轴，暂时没法逐行跟随", lyricsPlaceholderText(LyricsUiState.NoTimeline))
    }

    @Test
    fun parsedLinesAreReady() {
        val state = lyricsUiState(track(hasLyrics = true), "[00:01.00] 第一行", 1)
        assertEquals(LyricsUiState.Ready, state)
        assertNull(lyricsPlaceholderText(state)) // Ready 不显示占位文案
    }

    @Test
    fun loadingAndFailureTextsDiffer() {
        // 两条文案不得相同：这正是原缺陷的表现（失败态被当成加载态）
        val loading = lyricsPlaceholderText(LyricsUiState.Loading)
        val failed = lyricsPlaceholderText(LyricsUiState.Failed)
        assertEquals(true, loading != failed)
    }
}
