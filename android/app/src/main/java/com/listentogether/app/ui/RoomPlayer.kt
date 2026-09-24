package com.listentogether.app.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material.icons.outlined.SkipPrevious
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import com.listentogether.app.formatTime
import com.listentogether.app.network.ConnectionStatus
import com.listentogether.app.network.RoomClient
import com.listentogether.app.network.Track
import com.listentogether.app.network.UiState
import com.listentogether.app.sync.TrackQueue
import kotlin.math.abs
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
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
@UnstableApi
internal class RoomPlayerState internal constructor(private val client: RoomClient) {
    /** 服务器进度采样（毫秒），由 rememberRoomPlayer 内的订阅持续刷新。 */
    var positionMs by mutableLongStateOf(0L)
    /** 拖动中的瞬时预览位置；松手发起 seek 或切曲时清空。 */
    var dragged by mutableStateOf<Float?>(null)
    /** 已发送但未获快照确认的 seek 目标（毫秒）；null 表示无挂起跳转。 */
    var pendingSeek by mutableStateOf<Long?>(null)
    internal var pendingSeekVersion by mutableLongStateOf(-1L)
    internal var pendingSeekTimeMs by mutableLongStateOf(0L)

    /** 当前应展示的进度（毫秒），含拖动与挂起 seek 的乐观预览。 */
    fun shownMs(): Long = (dragged ?: pendingSeek?.toFloat() ?: positionMs.toFloat()).toLong()

    /** 发起 seek：发送指令并记录目标、快照版本与发起时刻。主线程调用。 */
    fun seek(target: Long, currentVersion: Long) {
        client.command("seek", positionMs = target)
        pendingSeek = target
        pendingSeekVersion = currentVersion
        pendingSeekTimeMs = System.currentTimeMillis()
        dragged = null
    }
}

/** 房间播放器状态工厂：随 client 与曲目切换重建；订阅进度、快照确认与 5 秒兜底都在房间作用域存活。 */
@Composable
@UnstableApi
internal fun rememberRoomPlayer(client: RoomClient, ui: UiState, track: Track?): RoomPlayerState {
    val state = remember(client) {
        RoomPlayerState(client).apply { positionMs = client.state.value.positionMs }
    }
    val positionFlow = remember(client) { client.state.map { it.positionMs }.distinctUntilChanged() }
    LaunchedEffect(state) { positionFlow.collect { state.positionMs = it } }
    LaunchedEffect(state, track?.id) { state.dragged = null }
    // 快照确认：命令之后任何 version 更新的快照，其位置贴合目标即视为跳转已生效。
    // 确认条件用相对推进量，避免 target 很小时 `positionMs >= target - 1500` 对任意非负位置恒真。
    LaunchedEffect(state, ui.room) {
        val snapshot = ui.room ?: return@LaunchedEffect
        val target = state.pendingSeek ?: return@LaunchedEffect
        if (snapshot.version <= state.pendingSeekVersion) return@LaunchedEffect
        val elapsed = System.currentTimeMillis() - state.pendingSeekTimeMs
        if (abs(snapshot.positionMs - target) <= elapsed + 1500) state.pendingSeek = null
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

/** 底部常驻 mini 播放器：细进度条 + 歌名与状态 + 播放键；整条点击进入展开页。 */
@Composable
@UnstableApi
internal fun MiniPlayer(
    client: RoomClient,
    ui: UiState,
    state: RoomPlayerState,
    track: Track?,
    playback: PlaybackView,
    onExpand: () -> Unit,
) {
    val duration = (track?.durationMs ?: 1).coerceAtLeast(1).toFloat()
    val playing = ui.room?.playing == true && !ui.locallyPaused
    val shown = state.shownMs().toFloat().coerceIn(0f, duration)
    val fraction = if (track != null) shown / duration else 0f
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
        modifier = Modifier.fillMaxWidth().navigationBarsPadding(),
    ) {
        Column {
            Box(
                Modifier.fillMaxWidth().height(3.dp)
                    .background(MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Box(
                    Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).fillMaxHeight()
                        .background(MaterialTheme.colorScheme.primary)
                )
            }
            Row(
                Modifier.fillMaxWidth().pointerInput(Unit) { detectTapGestures { onExpand() } }
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        track?.title ?: if (client.isHost) "选一首喜欢的歌" else "等待房主选歌",
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        playbackLabel(ui, playback),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Spacer(Modifier.width(12.dp))
                PlayPauseButton(client, ui, track, playing, size = 44.dp)
            }
        }
    }
}

/** 展开播放页内容：完整进度拖拽、切歌、时间显示与同步说明；由 MainActivity 挂进 ModalBottomSheet。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
@UnstableApi
internal fun PlayerSheet(
    client: RoomClient,
    ui: UiState,
    state: RoomPlayerState,
    track: Track?,
    playback: PlaybackView,
    onLockedTap: () -> Unit,
    onDismiss: () -> Unit,
) {
    val duration = (track?.durationMs ?: 1).coerceAtLeast(1).toFloat()
    val playing = ui.room?.playing == true && !ui.locallyPaused
    val shown = state.shownMs().toFloat().coerceIn(0f, duration)
    // 切歌只认连接就绪且歌单非空；房主发 select 指令（环形顺序见 TrackQueue），非房主交给调用方提示。
    val canSkip = ui.status == ConnectionStatus.Ready && ui.tracks.isNotEmpty()
    val skip: (Int) -> Unit = { direction ->
        if (client.isHost) TrackQueue.skip(ui.tracks, ui.room?.trackId, direction)?.let { client.command("select", trackId = it) }
        else onLockedTap()
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.surfaceContainer,
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("当前歌曲", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(playbackLabel(ui, playback), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    track?.title ?: if (client.isHost) "选一首喜欢的歌" else "等待房主选歌",
                    style = MaterialTheme.typography.headlineSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(12.dp))
                SkipButton(Icons.Outlined.SkipPrevious, "上一首", canSkip) { skip(-1) }
                Spacer(Modifier.width(6.dp))
                PlayPauseButton(client, ui, track, playing, size = 56.dp)
                Spacer(Modifier.width(6.dp))
                SkipButton(Icons.Outlined.SkipNext, "下一首", canSkip) { skip(1) }
            }
            SliderRow(client, ui, state, track, duration, shown)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(formatTime(shown.toLong()), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(formatTime(track?.durationMs ?: 0), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (track != null) {
                Text(
                    if (ui.status != ConnectionStatus.Ready) "连接就绪后即可播放" else if (client.isHost) "播放与暂停同步给所有人" else "暂停只影响自己 · 进度由房主控制",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
@UnstableApi
private fun PlayPauseButton(client: RoomClient, ui: UiState, track: Track?, playing: Boolean, size: Dp) {
    FilledIconButton(
        onClick = { client.setPlaying(!playing) },
        enabled = ui.status == ConnectionStatus.Ready && track != null,
        modifier = Modifier.size(size),
        colors = IconButtonDefaults.filledIconButtonColors(
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary
        )
    ) {
        Icon(
            if (playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
            contentDescription = if (playing) "暂停" else "播放",
            modifier = Modifier.size(size * 0.6f)
        )
    }
}

/** 切歌键：上一首/下一首共用的 48dp 圆钮；禁用态由 canSkip 控制。 */
@Composable
private fun SkipButton(icon: ImageVector, label: String, enabled: Boolean, onClick: () -> Unit) {
    FilledTonalIconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(48.dp)) {
        Icon(imageVector = icon, contentDescription = label)
    }
}

/** 圆点端点 + 细轨道的进度拖拽条（默认 M3 Slider 手柄 4×44dp 竖条观感突兀）。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
@UnstableApi
private fun SliderRow(client: RoomClient, ui: UiState, state: RoomPlayerState, track: Track?, duration: Float, shown: Float) {
    val sliderColors = SliderDefaults.colors()
    val sliderEnabled = client.isHost && ui.status == ConnectionStatus.Ready && track != null
    Slider(
        value = shown,
        onValueChange = { state.dragged = it },
        onValueChangeFinished = {
            state.dragged?.let { dragged ->
                state.seek(dragged.toLong().coerceIn(0L, duration.toLong()), ui.room?.version ?: -1L)
            }
        },
        valueRange = 0f..duration,
        enabled = sliderEnabled,
        thumb = {
            Box(
                Modifier.size(14.dp)
                    .clip(CircleShape)
                    .background(if (sliderEnabled) sliderColors.thumbColor else sliderColors.disabledThumbColor)
            )
        },
        track = {
            val played = if (duration > 0f) shown / duration else 0f
            Box(
                Modifier.fillMaxWidth().height(5.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(if (sliderEnabled) sliderColors.inactiveTrackColor else sliderColors.disabledInactiveTrackColor)
            ) {
                Box(
                    Modifier.fillMaxWidth(played).fillMaxHeight()
                        .background(if (sliderEnabled) sliderColors.activeTrackColor else sliderColors.disabledActiveTrackColor)
                )
            }
        }
    )
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
    Row(
        modifier.size(20.dp).padding(2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.Bottom
    ) {
        bars.forEach { bar ->
            Box(
                Modifier.width(3.dp).height((5 + 11 * bar.value).dp)
                    .clip(RoundedCornerShape(1.5.dp))
                    .background(color)
            )
        }
    }
}
