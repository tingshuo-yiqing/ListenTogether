package com.listentogether.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.listentogether.app.network.ConnectionStatus
import com.listentogether.app.network.Member
import com.listentogether.app.network.RoomClient
import com.listentogether.app.network.Track
import com.listentogether.app.network.UiState
import com.listentogether.app.ui.theme.BannerShape
import com.listentogether.app.ui.theme.CardShape
import com.listentogether.app.ui.theme.RowShape
import com.listentogether.app.formatTime

/** 房间采用固定成员摘要与歌单表头，曲目在圆角面板内独立滚动；播放器由 Scaffold 固定在底部。 */
@Composable
internal fun RoomContent(client: RoomClient, ui: UiState, input: JoinInput, playback: PlaybackView, onLockedTap: () -> Unit) {
    val listState = rememberLazyListState()
    val currentTrackId = ui.room?.trackId
    LaunchedEffect(currentTrackId, ui.tracks) {
        val index = ui.tracks.indexOfFirst { it.id == currentTrackId }
        if (index < 0 || listState.isScrollInProgress) return@LaunchedEffect
        // 曲目列表不再混入标题/横幅，不需要推算头部偏移；用户正在滑动时不抢滚动控制权。
        if (listState.layoutInfo.visibleItemsInfo.none { it.key == "track:$currentTrackId" }) {
            listState.animateScrollToItem(index)
        }
    }
    Column(
        Modifier.widthIn(max = 560.dp).fillMaxSize().padding(horizontal = 20.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (showStatusNotice(ui, playback)) {
            StatusBanner(
                ui, playback,
                onRetry = { client.retry() },
                onRejoin = { client.join(input.address.trim(), composeNickname(null, input.name), ui.credentials?.code ?: client.lastRoom?.code) },
                onLeave = { client.leave() }
            )
        }
        // 多成员展开时限制高度，避免成员列表挤掉整个歌单；两块各自滚动。
        Column(Modifier.heightIn(max = 180.dp).verticalScroll(rememberScrollState())) {
            MembersSection(ui)
        }
        Surface(shape = CardShape, color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.weight(1f).fillMaxWidth()) {
            Column {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("歌单", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    Text("${ui.tracks.size} 首", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                LazyColumn(
                    Modifier.weight(1f).fillMaxWidth(), state = listState,
                    contentPadding = PaddingValues(8.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    PlaylistSection(client, ui, currentTrackId, ui.room?.playing == true && !ui.locallyPaused, onLockedTap)
                }
            }
        }
    }
}

/** 正常连接收进成员摘要；异常和本机中断保留文字及操作。 */
@Composable
private fun StatusBanner(ui: UiState, playback: PlaybackView, onRetry: () -> Unit, onRejoin: () -> Unit, onLeave: () -> Unit) {
    val failed = playback.failed && playback.mediaId == ui.room?.trackId
    val expired = ui.status == ConnectionStatus.Expired
    val error = failed || expired
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
            if (expired) TextButton(onClick = onRejoin, enabled = !ui.busy) { Text("重新加入房间") }
            if (expired || failed) TextButton(onClick = onLeave) { Text("退出房间") }
        }
    }
}

/**
 * 成员区默认压缩为一行：头像堆叠 + 人数与连接状态，整行点击展开成员列表；
 * 折叠状态只属于当前房间页面。
 */
@Composable
private fun MembersSection(ui: UiState) {
    var expanded by rememberSaveable(ui.credentials?.code) { mutableStateOf(false) }
    val members = ui.room?.members.orEmpty()
    val statusText = if (ui.status == ConnectionStatus.Ready) "已连接" else statusLabel(ui.status)
    Column {
        Row(
            Modifier.fillMaxWidth().clip(RowShape)
                // 用 clickable(onClickLabel) 而不是 selectable(selected=false)：后者对读屏恒为"未选中"，
                // 与展开/折叠的真实状态矛盾；展开动作改由 onClickLabel 表达。
                .clickable(role = Role.Button, onClickLabel = if (expanded) "收起成员" else "查看成员") { expanded = !expanded }
                .semantics { stateDescription = if (expanded) "已展开" else "已折叠" }
                .padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AvatarStack(members)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(members.count { it.online }.toString() + " 人一起听", style = MaterialTheme.typography.titleSmall)
                Text(
                    statusText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Icon(
                if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                // 纯装饰：读屏的 contentDescription 会盖掉整行合并文本（人数与最近动态就听不到了），
                // 展开语义由 onClickLabel + stateDescription 承担。
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (expanded) {
            members.forEach { member ->
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    MemberAvatar(memberId = member.id, name = member.name, online = member.online)
                    Spacer(Modifier.width(12.dp))
                    // 昵称里作为头像的那个 emoji 已占住头像位，文字行显示去掉前缀的昵称；
                    // 昵称只有一个 emoji 时文字行仍是它本身（不然成员行会没有名字）。
                    Text(memberDisplayName(member.name), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        (if (member.id == ui.room?.hostId) "房主 · " else "") + if (member.online) "在线" else "离线",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

        }
    }
}

/** 重叠头像堆：最多显示 5 个（后来者先绘制、前者压在上层，首个头像的状态点不被遮挡），超出部分以 +N 圆片收尾。 */
@Composable
private fun AvatarStack(members: List<Member>, maxVisible: Int = 5) {
    if (members.isEmpty()) return
    val shown = members.take(maxVisible)
    val extra = members.size - shown.size
    val step = 28.dp
    Box(
        Modifier
            .width(step * (shown.size - 1) + 40.dp + if (extra > 0) step + 8.dp else 0.dp)
            .height(40.dp)
    ) {
        if (extra > 0) {
            Box(
                Modifier.offset(x = step * shown.size + 8.dp).size(40.dp),
                contentAlignment = Alignment.Center
            ) {
                Box(
                    Modifier.size(36.dp).background(MaterialTheme.colorScheme.surfaceVariant, CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Text("+$extra", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        shown.reversed().forEachIndexed { index, member ->
            val position = shown.size - 1 - index
            MemberAvatar(member.id, member.name, member.online, Modifier.offset(x = step * position))
        }
    }
}

/** 歌单：服务端曲库顺序即播放顺序（切歌按环形顺序见 TrackQueue）；当前曲目高亮、计数基于完整列表。 */
private fun LazyListScope.PlaylistSection(client: RoomClient, ui: UiState, currentTrackId: String?, playingNow: Boolean, onLockedTap: () -> Unit) {
    if (ui.tracks.isEmpty()) {
        item { Text("还没有歌曲，联系房主添加后再来听。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        return
    }
    items(ui.tracks, key = { song -> "track:${song.id}" }, contentType = { _ -> "track" }) { song ->
        PlaylistRow(client, song, song.id == currentTrackId, playingNow && song.id == currentTrackId, ui.status == ConnectionStatus.Ready) {
            if (client.isHost) client.command("select", trackId = song.id) else onLockedTap()
        }
    }
}

/** 每行只接收展示所需数据，播放进度变化不会使整张歌单重组。 */
@Composable
private fun PlaylistRow(client: RoomClient, song: Track, current: Boolean, playing: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val durationLabel = remember(song.durationMs) { formatTime(song.durationMs) }
    val cover = rememberCoverBitmap(client, song, 44.dp)
    val coverShape = RoundedCornerShape(6.dp)
    Surface(
        shape = RowShape,
        color = if (current) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
        modifier = Modifier.fillMaxWidth()
            .semantics { if (current) stateDescription = "当前曲目" }
            .clickable(enabled = enabled, onClick = onClick)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 12.dp, vertical = 8.dp)) {
            // 左侧封面缩略图（44dp）：有图显示图，当前播放显示动效条，其余统一静态占位。
            Box(modifier = Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                if (cover != null) {
                    Image(bitmap = cover.asImageBitmap(), contentDescription = null, modifier = Modifier.size(44.dp).clip(coverShape))
                } else if (current && playing) {
                    PlayingIndicator(color = MaterialTheme.colorScheme.onPrimaryContainer)
                } else {
                    CoverPlaceholder(44.dp)
                }
            }
            Spacer(Modifier.size(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    song.title,
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (current) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                // 歌手副行：null/空时不占行高。
                if (!song.artist.isNullOrEmpty()) {
                    Text(
                        song.artist,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (current) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            Spacer(Modifier.width(12.dp))
            Text((if (current) "当前 · " else "") + durationLabel, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun statusLabel(status: ConnectionStatus): String = when (status) {
    ConnectionStatus.Idle -> ""
    ConnectionStatus.Joining -> "正在连接服务器"
    ConnectionStatus.Connecting -> "正在连接房间"
    ConnectionStatus.Calibrating -> "已连接，正在校时"
    ConnectionStatus.Ready -> "已同步"
    ConnectionStatus.Reconnecting -> "连接断开，正在重试"
    ConnectionStatus.Expired -> "房间或成员已失效，请退出后重新加入"
}
