package com.listentogether.app.ui

import android.os.SystemClock
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import com.listentogether.app.formatTime
import com.listentogether.app.network.ConnectionStatus
import com.listentogether.app.network.RoomClient
import com.listentogether.app.network.Track
import com.listentogether.app.network.UiState
import kotlin.math.abs
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * 房间播放器共享状态：mini 条与展开 Sheet 同读一份进度与 seek 预览，
 * 状态挂在房间会话作用域上，Sheet 关闭不中断 seek 确认与超时兜底。
 *
 * 进度显示来源优先级：拖动预览 dragged > 未确认目标 pendingSeek > 服务器进度 positionMs。
 * seek 确认模型（服务端仍是唯一事实来源，本机不提前 seek）：
 * 松手记录 pendingSeek 并发送指令，滑条停在目标处；收到 version 更新的快照且
 * 位置贴合目标（容忍窗口 = 确认以来经过时长 + 1500ms 含 RTT 补偿）即恢复跟随；
 * 5 秒未确认清除预览并提示重试，不自动重发。
 */
/** seek 确认的容忍余量（毫秒）：覆盖快照周期、RTT 与播放推进的估计误差。 */
internal const val SEEK_CONFIRM_TOLERANCE_MS = 1500L

/**
 * seek 是否已被快照确认（纯函数）：快照版本必须新于发起时刻记录的版本，
 * 且位置与目标贴合——容忍窗口 = 发起以来经过时长 + [SEEK_CONFIRM_TOLERANCE_MS]。
 * 用相对贴合而非 `positionMs >= target - 余量`：拖回开头等低目标时后者对任意非负位置恒真（E-07）。
 * elapsed 必须来自单调时钟（[RoomPlayerState.elapsedSinceSeekMs]）：墙钟会被系统对时改动，窗口失真。
 */
internal fun seekConfirmed(
    target: Long,
    snapshotVersion: Long,
    pendingSeekVersion: Long,
    snapshotPositionMs: Long,
    elapsedMs: Long,
): Boolean =
    snapshotVersion > pendingSeekVersion && abs(snapshotPositionMs - target) <= elapsedMs + SEEK_CONFIRM_TOLERANCE_MS

@UnstableApi
internal class RoomPlayerState internal constructor(
    private val client: RoomClient,
    private val nowMs: () -> Long = SystemClock::elapsedRealtime,
) {
    /** 服务器进度采样（毫秒），由 rememberRoomPlayer 内的订阅持续刷新。 */
    var positionMs by mutableLongStateOf(0L)
    /** 拖动中的瞬时预览位置；松手发起 seek 或切曲时清空。 */
    var dragged by mutableStateOf<Float?>(null)
    /** 已发送但未获快照确认的 seek 目标（毫秒）；null 表示无挂起跳转。 */
    var pendingSeek by mutableStateOf<Long?>(null)
    internal var pendingSeekVersion by mutableLongStateOf(-1L)
    /** 发起 seek 的时刻；与 [elapsedSinceSeekMs] 同用单调时钟（毫秒），不写墙钟。 */
    internal var pendingSeekTimeMs by mutableLongStateOf(0L)

    /** 当前应展示的进度（毫秒），含拖动与挂起 seek 的乐观预览。 */
    fun shownMs(): Long = (dragged ?: pendingSeek?.toFloat() ?: positionMs.toFloat()).toLong()

    /** 发起 seek 以来的单调流逝毫秒；确认窗口用它度量，系统对时跳变不影响判定。 */
    internal fun elapsedSinceSeekMs(): Long = nowMs() - pendingSeekTimeMs

    /** 发起 seek：发送指令并记录目标、快照版本与发起时刻。主线程调用。 */
    fun seek(target: Long, currentVersion: Long) {
        client.command("seek", positionMs = target)
        pendingSeek = target
        pendingSeekVersion = currentVersion
        pendingSeekTimeMs = nowMs()
        dragged = null
    }
}

/** 房间播放器状态工厂：随 client 与房间会话重建；订阅进度、快照确认与 5 秒兜底都在房间作用域存活。 */
@Composable
@UnstableApi
internal fun rememberRoomPlayer(client: RoomClient, ui: UiState, track: Track?): RoomPlayerState {
    // 必须以房间会话（token）为 key：pendingSeek 记着上一间房的快照 version，新房 version 从 0 起，
    // 会让确认分支永远不成立——滑条停在上一个房间的目标值，5 秒后新房凭空弹出"未确认，请重试"。
    val state = remember(client, ui.credentials?.token) {
        RoomPlayerState(client).apply { positionMs = client.state.value.positionMs }
    }
    val positionFlow = remember(client) { client.state.map { it.positionMs }.distinctUntilChanged() }
    LaunchedEffect(state) { positionFlow.collect { state.positionMs = it } }
    LaunchedEffect(state, track?.id, ui.room?.entryId) {
        // 切曲或队列耗尽时只清 UI 预览，不能把上一条目的目标带到新曲。
        state.dragged = null
        state.pendingSeek = null
        state.pendingSeekVersion = -1L
    }
    // 快照确认：命令之后任何 version 更新的快照，其位置贴合目标即视为跳转已生效。
    // 确认条件用相对推进量，避免 target 很小时 `positionMs >= target - 1500` 对任意非负位置恒真。
    LaunchedEffect(state, ui.room) {
        val snapshot = ui.room ?: return@LaunchedEffect
        val target = state.pendingSeek ?: return@LaunchedEffect
        val elapsed = state.elapsedSinceSeekMs()
        if (seekConfirmed(target, snapshot.version, state.pendingSeekVersion, snapshot.positionMs, elapsed)) {
            state.pendingSeek = null
        }
    }
    // 兜底：5 秒未确认按约定提示"未确认，请重试"，不自动重发。
    LaunchedEffect(state, state.pendingSeek) {
        if (state.pendingSeek != null) {
            delay(5_000)
            if (state.pendingSeek != null) {
                state.pendingSeek = null
                client.report("进度跳转未确认，请重试")
            }
        }
    }
    return state
}

/** 当前曲唯一常驻入口：真实封面、曲名和歌手展开播放器，独立播放键不会触发展开。 */
@Composable
@UnstableApi
internal fun MiniPlayer(
    client: RoomClient,
    ui: UiState,
    state: RoomPlayerState,
    track: Track?,
    onExpand: () -> Unit,
) {
    if (track == null) return
    val duration = track.durationMs.coerceAtLeast(1).toFloat()
    val playing = ui.room?.playing == true && !ui.locallyPaused
    val fraction = (state.shownMs().toFloat() / duration).coerceIn(0f, 1f)
    val playerColor = MaterialTheme.colorScheme.primary
    val playerInk = MaterialTheme.colorScheme.onPrimary
    Box(Modifier.fillMaxWidth().navigationBarsPadding(), contentAlignment = Alignment.Center) {
        Surface(
            color = playerColor,
            contentColor = playerInk,
            shape = RoundedCornerShape(20.dp),
            modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Box {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Row(
                        Modifier.weight(1f).clip(RoundedCornerShape(12.dp))
                            .clickable(role = Role.Button, onClickLabel = "展开播放器", onClick = onExpand)
                            .padding(horizontal = 4.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        val cover = rememberCoverBitmap(client, track, 44.dp)
                        if (cover != null) {
                            Image(
                                bitmap = cover.asImageBitmap(), contentDescription = null,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)),
                            )
                        } else CoverPlaceholder(44.dp, corner = 10.dp)
                        Column(Modifier.weight(1f)) {
                            Text(
                                track.title, style = MaterialTheme.typography.titleMedium,
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                            if (!track.artist.isNullOrBlank()) {
                                Text(
                                    track.artist, style = MaterialTheme.typography.bodySmall,
                                    color = playerInk, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                    PlayPauseButton(client, ui, track, playing, 48.dp, onPlayerBar = true)
                    if (client.isHost) {
                        NextButton(ui.status == ConnectionStatus.Ready, playerInk) { client.skipNext() }
                    }
                }
                Box(
                    Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(2.dp)
                        .background(playerInk.copy(alpha = 0.25f)),
                ) {
                    Box(Modifier.fillMaxWidth(fraction).fillMaxHeight().background(playerInk))
                }
            }
        }
    }
}

/**
 * 竖屏展开页：主体可滚动，关闭及播放控制固定；只发送 RoomClient 意图，不持有播放器。
 * 封面和歌词始终按顺序呈现，空当前曲退出弹层，避免队列耗尽后残留旧曲控制。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
@UnstableApi
internal fun PlayerSheet(
    client: RoomClient,
    ui: UiState,
    state: RoomPlayerState,
    track: Track?,
    @Suppress("UNUSED_PARAMETER") onLockedTap: () -> Unit,
    onDismiss: () -> Unit,
) {
    if (track == null) {
        LaunchedEffect(Unit) { onDismiss() }
        return
    }
    val playing = ui.room?.playing == true && !ui.locallyPaused
    val duration = track.durationMs.coerceAtLeast(1).toFloat()
    val shown = state.shownMs().toFloat().coerceIn(0f, duration)
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    DisposableEffect(state) {
        // 弹层关闭可取消正在拖动的显示预览；已发出的 pendingSeek 仍在房间作用域等待确认。
        onDispose { state.dragged = null }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        dragHandle = null,
    ) {
        Column(
            Modifier.fillMaxWidth().fillMaxHeight(0.96f),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.End,
            ) {
                IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Outlined.KeyboardArrowDown, contentDescription = "收起播放器")
                }
            }
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                // 可用高度决定封面，而主控制区不参与滚动；矮屏仍留出歌词观看区。
                val coverSize = (maxHeight - 250.dp).coerceIn(132.dp, 252.dp)
                val lyricHeight = (maxHeight - coverSize - 112.dp).coerceAtLeast(132.dp)
                Column(
                    Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
                        .padding(horizontal = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    val cover = rememberCoverBitmap(client, track, coverSize)
                    if (cover != null) {
                        Image(
                            bitmap = cover.asImageBitmap(), contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.size(coverSize).clip(RoundedCornerShape(24.dp)),
                        )
                    } else CoverPlaceholder(coverSize, corner = 24.dp)
                    Spacer(Modifier.height(20.dp))
                    Text(
                        track.title, style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.SemiBold, maxLines = 2,
                        overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                    )
                    if (!track.artist.isNullOrBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            track.artist, style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                        )
                    }
                    Spacer(Modifier.height(16.dp))
                    // lyricsVer 同样重建子树：同曲换词也不短暂露出旧缓存与滚动位置。
                    key(track.id, track.hasLyrics, track.lyricsVer) {
                        LyricsSection(client, track, shown.toLong(), lyricHeight)
                    }
                }
            }
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                SliderRow(client, ui, state, track, duration, shown)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(28.dp),
                ) {
                    Spacer(Modifier.size(48.dp))
                    PlayPauseButton(client, ui, track, playing, size = 68.dp)
                    if (client.isHost) {
                        NextButton(ui.status == ConnectionStatus.Ready) { client.skipNext() }
                    } else Spacer(Modifier.size(48.dp))
                }
            }
        }
    }
}

@Composable
@UnstableApi
private fun PlayPauseButton(
    client: RoomClient,
    ui: UiState,
    track: Track?,
    playing: Boolean,
    size: Dp,
    onPlayerBar: Boolean = false,
) {
    val haptics = LocalHapticFeedback.current
    val label = if (client.isHost) {
        if (playing) "暂停播放" else "播放"
    } else if (playing) "暂停本机" else "恢复跟听"
    val action = {
        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        client.setPlaying(!playing)
    }
    val enabled = ui.status == ConnectionStatus.Ready && track != null
    val icon = if (playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow
    if (onPlayerBar) {
        IconButton(onClick = action, enabled = enabled, modifier = Modifier.size(size)) {
            Icon(icon, contentDescription = label, modifier = Modifier.size(24.dp))
        }
    } else {
        FilledIconButton(
            onClick = action, enabled = enabled, modifier = Modifier.size(size),
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ),
        ) {
            Icon(icon, contentDescription = label, modifier = Modifier.size(32.dp))
        }
    }
}

/** 房主下一首允许在待播为空时清掉当前曲；不添加客户端猜测的队列状态。 */
@Composable
private fun NextButton(
    enabled: Boolean,
    color: Color = MaterialTheme.colorScheme.onSurface,
    onClick: () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    IconButton(
        onClick = { haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove); onClick() },
        enabled = enabled, modifier = Modifier.size(48.dp),
    ) {
        Icon(Icons.Outlined.SkipNext, contentDescription = "下一首", tint = color.copy(alpha = if (enabled) 1f else 0.38f))
    }
}

/** 原生滑条保留触控、键盘与读屏进度；视觉时间仅在操作时出现，seek 仍等待服务端确认。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
@UnstableApi
private fun SliderRow(client: RoomClient, ui: UiState, state: RoomPlayerState, track: Track, duration: Float, shown: Float) {
    val sliderEnabled = client.isHost && ui.status == ConnectionStatus.Ready
    val interactions = remember { MutableInteractionSource() }
    val dragging by interactions.collectIsDraggedAsState()
    val pressed by interactions.collectIsPressedAsState()
    val focused by interactions.collectIsFocusedAsState()
    val inputMode = LocalInputModeManager.current.inputMode
    val operating = sliderEnabled && (state.dragged != null || dragging || pressed || (focused && inputMode == InputMode.Keyboard))
    val sliderColors = SliderDefaults.colors(
        activeTrackColor = MaterialTheme.colorScheme.primary,
        inactiveTrackColor = MaterialTheme.colorScheme.outlineVariant,
    )
    val haptics = LocalHapticFeedback.current
    Column(Modifier.fillMaxWidth()) {
        Slider(
            value = shown,
            onValueChange = { state.dragged = it },
            onValueChangeFinished = {
                state.dragged?.let { target ->
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    state.seek(target.toLong().coerceIn(0L, duration.toLong()), ui.room?.version ?: -1L)
                }
            },
            modifier = Modifier.fillMaxWidth().height(48.dp).semantics {
                contentDescription = "播放进度"
                stateDescription = "${formatTime(shown.toLong())}，共 ${formatTime(track.durationMs)}"
            },
            valueRange = 0f..duration, enabled = sliderEnabled, interactionSource = interactions,
            thumb = {
                Box(
                    Modifier.size(12.dp).clip(CircleShape)
                        .background(if (operating) sliderColors.thumbColor else Color.Transparent),
                )
            },
            track = {
                Box(
                    Modifier.fillMaxWidth().height(3.dp).clip(CircleShape)
                        .background(sliderColors.inactiveTrackColor),
                ) {
                    Box(
                        Modifier.fillMaxWidth((shown / duration).coerceIn(0f, 1f)).fillMaxHeight()
                            .background(sliderColors.activeTrackColor),
                    )
                }
            },
        )
        // 占位高度固定，时间显隐不会把播放键推到指尖之外。
        Box(Modifier.fillMaxWidth().height(20.dp)) {
            if (operating) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(formatTime(shown.toLong()), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(formatTime(track.durationMs), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

/**
 * 真实 LRC 逐行跟随：仅当前行/恢复跟随时滚动，用户手势与惯性结束 3 秒后回位。
 * 读取失败独立反馈并允许重试；不会用示意歌词或页面时间生成歌词内容。
 */
@Composable
private fun LyricsSection(client: RoomClient, track: Track, positionMs: Long, height: Dp) {
    var retryVersion by remember { mutableIntStateOf(0) }
    val lyricText = produceState<String?>(if (track.hasLyrics) "" else null, track.id, track.lyricsVer, retryVersion) {
        if (!track.hasLyrics) { value = null; return@produceState }
        value = ""
        client.state.first { it.credentials != null }
        value = client.fetchLyrics(track)?.takeIf { it.isNotEmpty() }
    }.value
    val lines = remember(track.id, lyricText) { lyricText?.let { parseLrc(it) } ?: emptyList() }
    val listState = rememberLazyListState()
    val current = indexAt(lines, positionMs)
    var manualPaused by remember(track.id) { mutableStateOf(false) }
    var resumeTick by remember(track.id) { mutableIntStateOf(0) }
    val latestCurrent by rememberUpdatedState(current)
    val followStopper = Modifier.nestedScroll(object : NestedScrollConnection {
        override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
            if (source == NestedScrollSource.UserInput && (consumed.x != 0f || consumed.y != 0f)) {
                manualPaused = true
                resumeTick++
            }
            return Offset.Zero
        }
    })
    val scrolling = listState.isScrollInProgress
    LaunchedEffect(resumeTick, scrolling) {
        if (!manualPaused || scrolling) return@LaunchedEffect
        delay(3_000)
        manualPaused = false
    }
    LaunchedEffect(listState, lines) {
        snapshotFlow { LyricsFollowPosition(latestCurrent, manualPaused) }
            .lyricsFollowTargets()
            .collectLatest { target ->
                if (target != null && target in lines.indices) listState.animateScrollToItem(target)
            }
    }
    Box(Modifier.fillMaxWidth().height(height), contentAlignment = Alignment.Center) {
        val uiState = lyricsUiState(track, lyricText, lines.size)
        if (uiState == LyricsUiState.Ready) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxWidth().fillMaxHeight().then(followStopper),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                contentPadding = PaddingValues(top = 44.dp, bottom = height - 44.dp),
            ) {
                // 按行下标区分同时间/同文本的合法重复行，避免重复 key 导致 LazyColumn 崩溃。
                itemsIndexed(lines, key = { index, line -> "$index-${line.timeMs}" }) { index, line ->
                    val active = index == current
                    Text(
                        line.text,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)
                            .semantics { if (active) stateDescription = "当前歌词" },
                    )
                }
            }
        } else {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                lyricsPlaceholderText(uiState)?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                }
                if (uiState == LyricsUiState.Failed) {
                    TextButton(onClick = { retryVersion++ }) { Text("重试歌词") }
                }
            }
        }
    }
}

/** 当前曲目播放中标记：3 根错相跳动的竖条；暂停时静止在低位，与图标同尺寸可互换。 */
@Composable
fun PlayingIndicator(modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.primary) {
    val transition = rememberInfiniteTransition(label = "playing-bars")
    val phases = listOf(0, 150, 300)
    val bars = phases.map { delayMs ->
        transition.animateFloat(
            initialValue = 0.25f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 500, delayMillis = delayMs, easing = LinearEasing),
                repeatMode = RepeatMode.Reverse
            ),
            label = "bar$delayMs"
        )
    }
    // 动画值只在绘制阶段读取：不再逐帧修改 Box.height，避免滚动时反复测量当前曲目行。
    Canvas(modifier.size(20.dp).padding(2.dp)) {
        val barWidth = 3.dp.toPx()
        val gap = 2.dp.toPx()
        val left = (size.width - 3 * barWidth - 2 * gap) / 2
        bars.forEachIndexed { index, bar ->
            val height = (5 + 11 * bar.value).dp.toPx()
            drawRoundRect(
                color = color,
                topLeft = Offset(left + index * (barWidth + gap), size.height - height),
                size = Size(barWidth, height),
                cornerRadius = CornerRadius(1.5.dp.toPx())
            )
        }
    }
}
