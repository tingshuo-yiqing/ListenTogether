package com.listentogether.app.ui

import com.listentogether.app.network.Track

/**
 * 歌词区要显示什么：把"取值结果 + 曲目提示 + 解析结果"映射成一个纯枚举，便于确定性单测。
 *
 * 存在的理由（真实缺陷回归）：原实现在 `lyricText == null` 分支里又按 `track.hasLyrics` 二分，
 * 于是 hasLyrics=true 的歌曲在**取值失败**（404 / 网络错误 / 引用文件缺失）时永远停在"加载中"，
 * "这首歌还没有歌词"这句文案实际不可达。真机曾观察到歌词区卡在"加载中"两分钟以上。
 */
enum class LyricsUiState {
    /** 还没有当前曲目。 */
    Empty,

    /** hasLyrics=true 且尚未取到文本：加载中。 */
    Loading,

    /** 服务端明确没有歌词引用。 */
    NoLyrics,

    /** 服务端有歌词引用但读取返回 null，提供重试而不伪报为没有歌词。 */
    Failed,

    /** 取到文本但没有一行时间戳（如仅有注释的占位 .lrc）。 */
    NoTimeline,

    /** 有带时间戳的歌词行，可逐行跟随。 */
    Ready,
}

/**
 * @param lyricText 取值结果："" = 仍在加载（produceState 初值）；null = 取值结束但没拿到；
 *                  非空 = LRC 原文。
 * @param hasLyrics 服务端下发的布尔提示。
 * @param lineCount 解析出的歌词行数。
 */
fun lyricsUiState(hasTrack: Boolean, lyricText: String?, hasLyrics: Boolean, lineCount: Int): LyricsUiState = when {
    !hasTrack -> LyricsUiState.Empty
    // 只有 "" 算加载中：它是 produceState 的初值，唯一含义是"还在取"。
    lyricText == "" -> LyricsUiState.Loading
    // 无引用与读取失败分开：失败不能退回加载态，也不把有引用误报为无歌词。
    lyricText == null -> if (hasLyrics) LyricsUiState.Failed else LyricsUiState.NoLyrics
    lineCount == 0 -> LyricsUiState.NoTimeline
    else -> LyricsUiState.Ready
}

/** 歌词区占位文案；Ready 返回 null（由调用方渲染歌词列表）。 */
fun lyricsPlaceholderText(state: LyricsUiState): String? = when (state) {
    LyricsUiState.Loading -> "歌词加载中"
    LyricsUiState.NoLyrics -> "这首歌还没有歌词"
    LyricsUiState.Failed -> "歌词暂时没读到"
    LyricsUiState.NoTimeline -> "这首歌的歌词没有时间轴，暂时没法逐行跟随"
    LyricsUiState.Empty, LyricsUiState.Ready -> null
}

/** 便捷重载：直接由曲目与取值结果判定。 */
fun lyricsUiState(track: Track?, lyricText: String?, lineCount: Int): LyricsUiState =
    lyricsUiState(track != null, lyricText, track?.hasLyrics == true, lineCount)
