package com.listentogether.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.QueueMusic
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import com.listentogether.app.network.RoomClient
import com.listentogether.app.network.UiState
import com.listentogether.app.ui.theme.RowShape
import kotlinx.coroutines.launch

/** 房间会话持有三页输入与滚动；页面只收集意图，播放仍由服务控制。 */
@Composable
internal fun RoomLayout(client: RoomClient, ui: UiState, input: JoinInput, playback: PlaybackView) {
    var tab by rememberSaveable(ui.credentials?.token) { mutableIntStateOf(0) }
    var draft by rememberSaveable(ui.credentials?.token) { mutableStateOf("") }
    var query by rememberSaveable(ui.credentials?.token) { mutableStateOf("") }
    var membersOpen by rememberSaveable(ui.credentials?.token) { mutableStateOf(false) }
    var lastSeenSeq by rememberSaveable(ui.credentials?.token) { mutableLongStateOf(-1L) }
    LaunchedEffect(ui.chatEnabled) { if (!ui.chatEnabled && tab == 2) tab = 0 }
    // 首次快照是历史；翻看时只有回到底部才更新已读水位。
    LaunchedEffect(ui.chatInitialSeq) { if (lastSeenSeq < 0) ui.chatInitialSeq?.let { lastSeenSeq = it } }
    val unread = ui.chat.count { it.seq > lastSeenSeq && lastSeenSeq >= 0 && it.senderId != ui.credentials?.memberId }
    val holder = rememberSaveableStateHolder()
    val search = remember(ui.credentials?.token) { CatalogSearchState { text, offset, revision -> client.searchCatalog(text, offset, revision = revision) } }
    val scope = rememberCoroutineScope()
    LaunchedEffect(query, ui.credentials?.token, search.reload) { search.loadFirst(query) }
    Column(Modifier.widthIn(max = 560.dp).fillMaxSize().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (showStatusNotice(ui, playback)) StatusBanner(ui, playback,
            onRetry = client::retry,
            onRejoin = { client.join(input.address.trim(), composeNickname(null, input.name), ui.credentials?.code ?: client.lastRoom?.code) },
            onLeave = client::leave)
        Row(Modifier.fillMaxWidth().heightIn(min = 60.dp).clickable(role = Role.Button, onClickLabel = "查看成员与邀请朋友") { membersOpen = true }, verticalAlignment = Alignment.CenterVertically) {
            AvatarStack(ui.room?.members.orEmpty())
            Column(Modifier.weight(1f).padding(start = 8.dp)) {
                Text("${ui.room?.members?.count { it.online } ?: 0} 人一起听", style = MaterialTheme.typography.titleSmall)
                Text(statusLabel(ui.status), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Outlined.ExpandMore, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Row(Modifier.fillMaxWidth().selectableGroup(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            listOf(Icons.AutoMirrored.Outlined.QueueMusic, Icons.Outlined.MusicNote, Icons.Outlined.ChatBubbleOutline).take(if (ui.chatEnabled) 3 else 2).forEachIndexed { index, icon ->
                val label = listOf("待播队列", "点歌", "聊天")[index]
                Surface(shape = RowShape, color = if (tab == index) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.background, modifier = Modifier.weight(1f)) {
                    Box(Modifier.fillMaxWidth().height(52.dp).clickable(role = Role.Tab, onClickLabel = label) { tab = index }
                        .semantics { contentDescription = if (index == 2 && unread > 0) "$label，$unread 条未读消息" else label; selected = tab == index }, contentAlignment = Alignment.Center) {
                        BadgedBox(badge = { if (index == 2 && unread > 0) Badge { Text(unread.toString()) } }) {
                            Icon(icon, null, tint = if (tab == index) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            holder.SaveableStateProvider(tab) {
                when (tab) {
                    0 -> QueueScreen(client, ui) { tab = 1 }
                    1 -> CatalogScreen(client, ui, search, query, { search.invalidate(); query = it }, onMore = { scope.launch { search.loadMore(query) } })
                    2 -> if (ui.chatEnabled) ConversationScreen(client, ui, draft, { draft = it }, lastSeenSeq, onRead = { lastSeenSeq = it })
                }
            }
        }
    }
    if (membersOpen) MembersSheet(client, ui) { membersOpen = false }
}
