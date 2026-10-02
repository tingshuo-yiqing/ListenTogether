package com.listentogether.app.ui

import android.os.SystemClock
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.listentogether.app.network.*
import com.listentogether.app.ui.theme.FieldShape
import com.listentogether.app.ui.theme.RowShape
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first

/** 草稿由房间持有；失败原文由 RoomClient 保留，重试只使用原消息身份。 */
@Composable
internal fun ConversationScreen(client: RoomClient, ui: UiState, draft: String, onDraft: (String) -> Unit, lastReadSeq: Long, onRead: (Long) -> Unit) {
    val list = rememberLazyListState()
    var positioned by rememberSaveable { mutableStateOf(false) }
    var followBottom by rememberSaveable { mutableStateOf(true) }
    var sendTrigger by remember { mutableIntStateOf(0) }
    val atBottom by remember { derivedStateOf { !list.canScrollForward } }
    val currentUi by rememberUpdatedState(ui)
    val currentOnRead by rememberUpdatedState(onRead)
    val itemCount = ui.chat.size + ui.chatPending.size
    LaunchedEffect(ui.credentials?.token, ui.chatGap) { if (ui.connected) client.chatSync() }
    LaunchedEffect(list) {
        snapshotFlow {
            if (list.layoutInfo.totalItemsCount == 0 || list.layoutInfo.visibleItemsInfo.isEmpty()) null
            else (!list.canScrollForward) to list.isScrollInProgress
        }.filterNotNull().distinctUntilChanged().collect { (bottom, scrolling) ->
            if (bottom || scrolling) followBottom = bottom
            if (bottom && positioned) currentOnRead(currentUi.chatLatestSeq)
        }
    }
    LaunchedEffect(ui.chatLatestSeq, ui.chatPending.size, sendTrigger) {
        if (itemCount > 0 && (!positioned || followBottom || sendTrigger > 0)) {
            snapshotFlow { list.layoutInfo.totalItemsCount > 0 }.first { it }
            list.scrollToItem(itemCount - 1)
            positioned = true; sendTrigger = 0
            onRead(ui.chatLatestSeq)
        }
    }
    val newMessages = ui.chat.count { it.seq > lastReadSeq && it.senderId != ui.credentials?.memberId }
    Column(Modifier.fillMaxSize()) {
        if (ui.chatGap) Text("较早的消息已超出保留窗口。", Modifier.padding(vertical = 8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (itemCount == 0) Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            Text("和朋友聊聊这首歌吧", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        else LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, contentPadding = PaddingValues(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            items(ui.chat, key = { "message:" + it.messageId }, contentType = { "message" }) { entry ->
                MessageBubble(entry.senderId, entry.senderName, entry.text, entry.senderId == ui.credentials?.memberId,
                    avatarId = entry.senderAvatarId ?: ui.room?.members?.firstOrNull { it.id == entry.senderId }?.avatarId)
            }
            items(ui.chatPending, key = { "pending:" + it.clientMessageId }, contentType = { "pending" }) { pending ->
                val name = ui.room?.members?.firstOrNull { it.id == ui.credentials?.memberId }?.name ?: "我"
                MessageBubble(ui.credentials?.memberId.orEmpty(), name, pending.text, mine = true) { DeliveryNotice(client, pending, ui.status == ConnectionStatus.Ready) }
            }
        }
        if (!atBottom && newMessages > 0) {
            val scope = rememberCoroutineScope()
            TextButton(onClick = { scope.launchScrollToEnd(list, itemCount) { onRead(ui.chatLatestSeq) } }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text("有 $newMessages 条新消息")
            }
        }
        Row(Modifier.fillMaxWidth().padding(bottom = 12.dp, top = 8.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(value = draft, onValueChange = onDraft, maxLines = 3, shape = FieldShape, label = { Text("消息") }, placeholder = { Text("说点什么…") }, modifier = Modifier.weight(1f))
            FilledIconButton(onClick = { if (client.chatSend(draft)) { onDraft(""); sendTrigger++ } }, enabled = ui.status == ConnectionStatus.Ready && draft.isNotBlank(), modifier = Modifier.padding(bottom = 4.dp).size(48.dp)) {
                Icon(Icons.AutoMirrored.Outlined.Send, "发送消息")
            }
        }
    }
}

@Composable
private fun MessageBubble(senderId: String, senderName: String, text: String, mine: Boolean, avatarId: String? = null, footer: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Top) {
        if (!mine) { MemberAvatar(senderId, senderName, online = null, avatarId = avatarId); Spacer(Modifier.width(8.dp)) }
        Column(Modifier.widthIn(max = 280.dp).weight(1f, fill = false), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
            Text(memberDisplayName(senderName), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 4.dp))
            Surface(shape = RowShape, color = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerLow,
                contentColor = if (mine) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface) {
                Column(Modifier.padding(12.dp)) { Text(text, style = MaterialTheme.typography.bodyLarge); footer?.invoke() }
            }
        }
    }
}

@Composable
private fun DeliveryNotice(client: RoomClient, pending: PendingChat, connected: Boolean) {
    var retryDelay by remember(pending) { mutableLongStateOf(client.chatRetryDelayMs(pending)) }
    var expired by remember(pending) { mutableStateOf(SystemClock.elapsedRealtime() >= pending.expiresAtMonoMs) }
    LaunchedEffect(pending) {
        while (!expired) { delay(1_000); retryDelay = client.chatRetryDelayMs(pending); expired = SystemClock.elapsedRealtime() >= pending.expiresAtMonoMs }
    }
    if (pending.delivery == ChatDelivery.Confirmed) {
        Text("已发送，正在恢复记录", Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    val failed = pending.delivery == ChatDelivery.Failed
    Column(Modifier.padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Polite }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(if (failed) Icons.Outlined.ErrorOutline else Icons.Outlined.Schedule, null, Modifier.size(14.dp), tint = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(4.dp))
            Text(when (pending.delivery) {
                ChatDelivery.Sending -> "发送中…"
                ChatDelivery.Unconfirmed -> "暂未确认"
                ChatDelivery.Failed -> "发送失败"
                ChatDelivery.Confirmed -> ""
            }, style = MaterialTheme.typography.bodySmall, color = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        pending.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (pending.delivery != ChatDelivery.Sending) TextButton(onClick = { client.retryChat(pending.clientMessageId) }, enabled = connected && retryDelay == 0L && !expired, contentPadding = PaddingValues(horizontal = 8.dp)) {
            Text(if (expired) "已过期，请先核对消息" else if (retryDelay > 0) "${(retryDelay + 999) / 1000} 秒后重试" else "重试")
        }
    }
}

private fun kotlinx.coroutines.CoroutineScope.launchScrollToEnd(list: androidx.compose.foundation.lazy.LazyListState, count: Int, onRead: () -> Unit) {
    launch { if (count > 0) list.animateScrollToItem(count - 1); onRead() }
}
