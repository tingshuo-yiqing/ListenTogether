package com.listentogether.app.ui

import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.QueueMusic
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.listentogether.app.network.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** 房主长按预览拖排，放手提交一次锚点操作；取消、换版本或失去权限则恢复服务端列表。 */
@Composable
internal fun QueueScreen(client: RoomClient, ui: UiState, onSearch: () -> Unit) {
    val entries = ui.queue?.entries.orEmpty()
    val version = ui.queue?.queueVersion ?: 0L
    val host = ui.room?.hostId == ui.credentials?.memberId
    val ready = ui.status == ConnectionStatus.Ready
    val list = rememberLazyListState()
    var preview by remember(version) { mutableStateOf(entries) }
    var dragging by remember { mutableStateOf<String?>(null) }
    var center by remember { mutableFloatStateOf(0f) }
    var waiting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    val edge = with(LocalDensity.current) { 64.dp.toPx() }
    val maxStep = with(LocalDensity.current) { 12.dp.toPx() }
    val latestEntries by rememberUpdatedState(entries)
    val latestVersion by rememberUpdatedState(version)
    LaunchedEffect(version, host, ready) { preview = entries; dragging = null; waiting = false }

    fun updateTarget() {
        val id = dragging ?: return
        val from = preview.indexOfFirst { it.entryId == id }
        val target = list.layoutInfo.visibleItemsInfo.minByOrNull { kotlin.math.abs(it.offset + it.size / 2f - center) } ?: return
        if (from < 0 || target.index !in preview.indices || from == target.index) return
        preview = preview.toMutableList().apply { add(target.index, removeAt(from)) }
    }
    fun commit(id: String, target: Int) {
        val original = latestEntries.map { it.entryId }
        if (original.indexOf(id) == target || id !in original) { preview = latestEntries; return }
        waiting = true
        val sentVersion = latestVersion
        client.queueMove(id, queueMoveAnchor(original, id, target), sentVersion)
        scope.launch { delay(5_000); if (latestVersion == sentVersion) { waiting = false; preview = latestEntries } }
    }
    LaunchedEffect(dragging) {
        while (isActive && dragging != null) {
            withFrameNanos { }
            val step = queueEdgeScroll(center, list.layoutInfo.viewportEndOffset.toFloat(), edge, maxStep)
            if (step != 0f) { list.scrollBy(step); updateTarget() }
        }
    }
    if (entries.isEmpty()) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.AutoMirrored.Outlined.QueueMusic, null, Modifier.size(44.dp), tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(16.dp))
            Text("还没有待播歌曲", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            Text("点一首喜欢的歌，一起听。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(20.dp))
            Button(onClick = onSearch) { Text("去点歌") }
        }
        return
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("待播队列", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            if (waiting) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        }
        LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            items(preview, key = { it.entryId }, contentType = { "queue" }) { entry ->
                val mine = entry.requestedBy == ui.credentials?.memberId
                val index = preview.indexOfFirst { it.entryId == entry.entryId }
                val track = remember(entry) { Track(entry.trackId, entry.title, entry.durationMs, entry.artist, entry.hasCover, entry.coverVer) }
                QueueSwipeRow(entry.entryId, version, enabled = ready && !waiting && dragging == null && (host || mine),
                    highlighted = dragging == entry.entryId, label = if (host) "删除" else "撤回", onRemove = { client.queueRemove(entry.entryId) },
                    modifier = Modifier.fillMaxWidth().zIndex(if (dragging == entry.entryId) 1f else 0f).graphicsLayer {
                        if (dragging == entry.entryId) {
                            val position = list.layoutInfo.visibleItemsInfo.firstOrNull { it.key == entry.entryId }
                            translationY = if (position == null) 0f else center - position.offset - position.size / 2f
                        }
                    }.pointerInput(host, ready, version, entry.entryId) {
                        if (!host || !ready) return@pointerInput
                        detectDragGesturesAfterLongPress(
                            onDragStart = {
                                if (!waiting) {
                                    val item = list.layoutInfo.visibleItemsInfo.firstOrNull { it.key == entry.entryId }
                                    if (item != null) {
                                        dragging = entry.entryId; center = item.offset + item.size / 2f
                                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                    }
                                }
                            },
                            onDrag = { change, amount -> if (dragging != null) { change.consume(); center += amount.y; updateTarget() } },
                            onDragEnd = { dragging?.let { id -> commit(id, preview.indexOfFirst { it.entryId == id }) }; dragging = null },
                            onDragCancel = { dragging = null; preview = latestEntries }
                        )
                    }.semantics {
                        if (host && ready && !waiting) customActions = buildList {
                            if (index > 0) add(CustomAccessibilityAction("向前移动 ${entry.title}") { commit(entry.entryId, index - 1); true })
                            if (index < preview.lastIndex) add(CustomAccessibilityAction("向后移动 ${entry.title}") { commit(entry.entryId, index + 1); true })
                        }
                        if (dragging == entry.entryId) stateDescription = "正在排序"
                    }) {
                    Row(Modifier.heightIn(min = 68.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        SongCover(client, track)
                        SongCopy(entry.title, entry.artist, Modifier.weight(1f).padding(horizontal = 12.dp))
                        Spacer(Modifier.width(12.dp))
                    }
                }
            }
        }
    }
}
