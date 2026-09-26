package com.listentogether.app.ui

import com.listentogether.app.network.ConnectionStatus
import com.listentogether.app.network.UiState

/** 页面从 MediaController 读取的本机观测值；不发指令，不参与服务端同步。 */
internal data class PlaybackView(
    val mediaId: String? = null, val failed: Boolean = false
)

/** 正常同步不占横幅；本机中断、错误与非默认消息始终有可见位置。 */
internal fun showStatusNotice(ui: UiState, player: PlaybackView): Boolean =
    ui.status != ConnectionStatus.Ready || ui.locallyPaused ||
        (player.failed && player.mediaId == ui.room?.trackId) ||
        (ui.message.isNotBlank() && ui.message != "已同步")

/** 入房失败留在表单附近；进行中状态由按钮和进度条承担。 */
internal fun joinError(ui: UiState): String? =
    ui.message.takeIf { ui.credentials == null && !ui.busy && it.isNotBlank() }
