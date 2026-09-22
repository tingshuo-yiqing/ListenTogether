package com.listentogether.app.playback

/**
 * 播放失败提示分类。
 *
 * 音频接口返回 401（令牌失效）或 404（音乐文件缺失）时给出可操作的针对性提示，
 * 其余错误保留 ExoPlayer 错误码并统一引导用户点击播放重试。
 * 只做字符串决策，不依赖 Android 运行时，便于 JVM 单测覆盖失败分类。
 */
object PlaybackFailure {
    fun message(httpResponseCode: Int?, errorCodeName: String): String = when (httpResponseCode) {
        401 -> "登录已失效，请退出房间后重新加入"
        404 -> "音乐文件缺失，暂时无法播放"
        else -> "音频播放失败：$errorCodeName，点击播放重试"
    }
}
