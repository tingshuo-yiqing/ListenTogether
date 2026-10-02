package com.listentogether.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.listentogether.app.network.ConnectionStatus
import com.listentogether.app.network.RoomClient
import com.listentogether.app.network.UiState
import com.listentogether.app.ui.theme.BannerShape

/** 房间入口委派至会话布局；异常反馈与播放逻辑沿用现有业务状态。 */
@Composable
internal fun RoomContent(client: RoomClient, ui: UiState, input: JoinInput, playback: PlaybackView) {
    RoomLayout(client, ui, input, playback)
}

/** 正常连接收进成员摘要；异常和本机中断保留文字及操作。 */
@Composable
internal fun StatusBanner(ui: UiState, playback: PlaybackView, onRetry: () -> Unit, onRejoin: () -> Unit, onLeave: () -> Unit) {
    val failed = playback.failed && playback.mediaId == ui.room?.track?.id
    val expired = ui.status == ConnectionStatus.Expired
    val incompatible = ui.status == ConnectionStatus.Incompatible
    val error = failed || expired || incompatible
    val label = when {
        failed -> ui.message.takeUnless { it.isBlank() || it == "已同步" } ?: "播放失败，请重试"
        ui.locallyPaused -> ui.message.takeUnless { it.isBlank() || it == "已同步" } ?: "已暂停跟听，点击播放恢复"
        else -> ui.message.ifBlank { statusLabel(ui.status) }
    }
    Surface(
        shape = BannerShape,
        color = if (error) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant,
        contentColor = if (error) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(if (error) Icons.Outlined.ErrorOutline else Icons.Outlined.Info, contentDescription = null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            }
            if (ui.status == ConnectionStatus.Reconnecting) TextButton(onClick = onRetry) { Text("立即重试") }
            if (expired) TextButton(onClick = onRejoin) { Text("重新加入房间") }
            if (expired || incompatible) TextButton(onClick = onLeave) { Text("退出房间") }
        }
    }
}

internal fun statusLabel(status: ConnectionStatus): String = when (status) {
    ConnectionStatus.Idle -> ""
    ConnectionStatus.Joining -> "正在连接服务器"
    ConnectionStatus.Connecting -> "正在连接房间"
    ConnectionStatus.Calibrating -> "已连接，正在校时"
    ConnectionStatus.Ready -> "已同步"
    ConnectionStatus.Reconnecting -> "连接断开，正在重试"
    ConnectionStatus.Expired -> "房间或成员已失效，请退出后重新加入"
    ConnectionStatus.Incompatible -> "服务器不支持点歌队列，请升级服务端"
}
