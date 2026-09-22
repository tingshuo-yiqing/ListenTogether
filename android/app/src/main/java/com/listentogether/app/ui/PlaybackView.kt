package com.listentogether.app.ui

import com.listentogether.app.network.ConnectionStatus
import com.listentogether.app.network.UiState

/** 页面从 MediaController 读取的本机观测值；不发指令，不参与服务端同步。 */
internal data class PlaybackView(
    val connected: Boolean = false, val mediaId: String? = null,
    val playing: Boolean = false, val buffering: Boolean = false, val failed: Boolean = false
)

/** 换曲后的旧控制器数据不能用于新曲目；房间播放意图不等于本机出声。 */
internal fun playbackLabel(ui: UiState, player: PlaybackView): String = when {
    ui.room?.trackId == null -> "待选歌"
    ui.status != ConnectionStatus.Ready -> "等待连接"
    player.mediaId == ui.room.trackId && player.failed -> "播放失败"
    ui.locallyPaused -> "本机已暂停"
    !player.connected || player.mediaId != ui.room.trackId -> "准备中"
    player.buffering -> "缓冲中"
    player.playing -> "播放中"
    ui.room.playing -> "准备中"
    else -> "已暂停"
}

/** 正常同步不占横幅；本机中断、错误与非默认消息始终有可见位置。 */
internal fun showStatusNotice(ui: UiState, player: PlaybackView): Boolean =
    ui.status != ConnectionStatus.Ready || ui.locallyPaused ||
        (player.failed && player.mediaId == ui.room?.trackId) ||
        (ui.message.isNotBlank() && ui.message != "已同步")

/** 入房失败留在表单附近；进行中状态由按钮和进度条承担。 */
internal fun joinError(ui: UiState): String? =
    ui.message.takeIf { ui.credentials == null && !ui.busy && it.isNotBlank() }
