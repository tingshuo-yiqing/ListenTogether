package com.listentogether.app.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.listentogether.app.ui.theme.RowShape
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

internal enum class QueueSwipeResult { Closed, Revealed, Delete }

/** 两次独立左滑才删除；第一次即使滑很远也只展开，右滑收起，小幅拖动保持原态。 */
internal fun resolveQueueSwipe(revealed: Boolean, deltaPx: Float, thresholdPx: Float): QueueSwipeResult = when {
    deltaPx <= -thresholdPx -> if (revealed) QueueSwipeResult.Delete else QueueSwipeResult.Revealed
    deltaPx >= thresholdPx -> QueueSwipeResult.Closed
    revealed -> QueueSwipeResult.Revealed
    else -> QueueSwipeResult.Closed
}

/** 删除只提交真实队列操作，服务端回显前保留原行；没有权限的歌曲不注册侧滑手势。 */
@Composable
internal fun QueueSwipeRow(
    entryId: String,
    resetVersion: Long,
    enabled: Boolean,
    highlighted: Boolean,
    label: String,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    var revealed by rememberSaveable(entryId) { mutableStateOf(false) }
    var offset by remember { mutableFloatStateOf(0f) }
    var swiping by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    val width = with(LocalDensity.current) { 76.dp.toPx() }
    val threshold = with(LocalDensity.current) { 36.dp.toPx() }
    val scope = rememberCoroutineScope()
    val latestRemove by rememberUpdatedState(onRemove)
    val animatedOffset by animateFloatAsState(offset, if (swiping) snap() else tween(160), label = "queueSwipe")
    LaunchedEffect(enabled, resetVersion) { revealed = false; offset = 0f; pending = false; swiping = false }
    fun remove() {
        if (!enabled || pending) return
        pending = true
        latestRemove()
        scope.launch { delay(5_000); pending = false }
    }
    Box(modifier.clip(RowShape)) {
        if (enabled && (revealed || offset < 0f)) {
            Box(Modifier.matchParentSize(), contentAlignment = Alignment.CenterEnd) {
            Button(
                onClick = ::remove, enabled = !pending,
                modifier = Modifier.width(76.dp).fillMaxHeight(),
                shape = RowShape, contentPadding = PaddingValues(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.errorContainer, contentColor = MaterialTheme.colorScheme.onErrorContainer)
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    if (pending) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onErrorContainer)
                    else Icon(Icons.Outlined.DeleteOutline, null, Modifier.size(20.dp))
                    Text(label, style = MaterialTheme.typography.labelMedium)
                }
            }
            }
        }
        Surface(color = if (highlighted) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.background, shape = RowShape,
            modifier = Modifier.fillMaxWidth().offset { IntOffset(animatedOffset.roundToInt(), 0) }
                .semantics {
                    if (enabled && !pending) customActions = listOf(CustomAccessibilityAction("显示$label") { revealed = true; offset = -width; true })
                }
                .pointerInput(enabled, pending, revealed) {
                    if (!enabled || pending) return@pointerInput
                    var delta = 0f
                    val startedOpen = revealed
                    detectHorizontalDragGestures(
                        onDragStart = { swiping = true; delta = 0f },
                        onHorizontalDrag = { change, amount ->
                            change.consume(); delta += amount
                            offset = ((if (startedOpen) -width else 0f) + delta).coerceIn(-width * 1.65f, 0f)
                        },
                        onDragEnd = {
                            swiping = false
                            when (resolveQueueSwipe(startedOpen, delta, threshold)) {
                                QueueSwipeResult.Delete -> { revealed = true; offset = -width; remove() }
                                QueueSwipeResult.Revealed -> { revealed = true; offset = -width }
                                QueueSwipeResult.Closed -> { revealed = false; offset = 0f }
                            }
                        },
                        onDragCancel = { swiping = false; offset = if (revealed) -width else 0f }
                    )
                }) { content() }
    }
}
