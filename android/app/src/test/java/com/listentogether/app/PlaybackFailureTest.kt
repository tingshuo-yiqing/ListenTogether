package com.listentogether.app

import com.listentogether.app.playback.PlaybackFailure
import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackFailureTest {
    @Test fun tokenExpiredPromptsRejoin() =
        assertEquals("登录已失效，请退出房间后重新加入", PlaybackFailure.message(401, "ERROR_CODE_IO_BAD_HTTP_STATUS"))

    @Test fun missingFileReportedDirectly() =
        assertEquals("音乐文件缺失，暂时无法播放", PlaybackFailure.message(404, "ERROR_CODE_IO_BAD_HTTP_STATUS"))

    @Test fun otherHttpStatusKeepsErrorNameForRetry() =
        assertEquals("音频播放失败：ERROR_CODE_IO_BAD_HTTP_STATUS，点击播放重试", PlaybackFailure.message(500, "ERROR_CODE_IO_BAD_HTTP_STATUS"))

    @Test fun networkErrorWithoutStatusKeepsErrorName() =
        assertEquals("音频播放失败：ERROR_CODE_IO_NETWORK_CONNECTION_FAILED，点击播放重试", PlaybackFailure.message(null, "ERROR_CODE_IO_NETWORK_CONNECTION_FAILED"))
}
