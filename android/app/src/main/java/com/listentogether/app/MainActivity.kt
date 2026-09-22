package com.listentogether.app

import android.Manifest
import android.content.ClipData
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ExitToApp
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.listentogether.app.network.ConnectionStatus
import com.listentogether.app.network.RoomClient
import com.listentogether.app.network.RoomState
import com.listentogether.app.network.Track
import com.listentogether.app.network.UiState
import com.listentogether.app.playback.PlaybackService
import com.listentogether.app.ui.theme.ListenTogetherTheme
import com.listentogether.app.ui.theme.StatusAmber
import com.listentogether.app.ui.theme.StatusGreen
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

/** 入房表单的可变输入；进程重建后丢失属可接受（地址会从偏好重新预填）。 */
private class JoinInput {
    var address by mutableStateOf("")
    var name by mutableStateOf("")
    var code by mutableStateOf("")
    var dragged by mutableStateOf<Float?>(null)
}

@UnstableApi
class MainActivity : ComponentActivity() {
    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        val client = (application as ListenApplication).roomClient
        setContent {
            ListenTogetherTheme {
                val ui by client.state.collectAsState()
                // Controller 保持与 Service 连接；Activity 销毁只释放控制器，不销毁后台播放器。
                DisposableEffect(ui.credentials?.token) {
                    val future = if (ui.credentials != null) {
                        startService(Intent(this@MainActivity, PlaybackService::class.java))
                        MediaController.Builder(this@MainActivity, SessionToken(this@MainActivity, ComponentName(this@MainActivity, PlaybackService::class.java))).buildAsync()
                    } else null
                    onDispose { future?.let { MediaController.releaseFuture(it) } }
                }
                val input = remember { JoinInput().apply { address = client.baseUrl } }
                // 软键盘弹出时给内容区加 IME 内边距，避免输入框与按钮被顶出视野；
                // 点空白处收起键盘（实测该设备 ESC 无法关闭输入法）。
                val focusManager = LocalFocusManager.current
                val snackbar = remember { SnackbarHostState() }
                Scaffold(
                    topBar = { TopBar(ui, snackbar) },
                    snackbarHost = { SnackbarHost(snackbar) },
                    containerColor = MaterialTheme.colorScheme.background
                ) { padding ->
                    LazyColumn(
                        Modifier.fillMaxSize().padding(padding).imePadding().pointerInput(Unit) {
                            detectTapGestures { focusManager.clearFocus() }
                        },
                        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Content(client, ui, input)
                    }
                }
            }
        }
    }
}

/** 顶栏：入房页显示应用名；房间页显示房间码与角色，附复制邀请码入口（复制后有 Snackbar 反馈）。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TopBar(ui: UiState, snackbar: SnackbarHostState) {
    CenterAlignedTopAppBar(
        colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = MaterialTheme.colorScheme.background),
        title = {
            if (ui.credentials == null) {
                Text("一起听歌", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("房间 " + ui.credentials.code, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Text(
                        if (ui.room?.hostId == ui.credentials.memberId) "你是房主 · 操作同步全房间" else "跟听模式 · 暂停仅影响自己",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        },
        actions = {
            if (ui.credentials != null) {
                val clipboard = LocalClipboard.current
                val scope = rememberCoroutineScope()
                IconButton(onClick = {
                    scope.launch {
                        clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("code", ui.credentials.code)))
                        snackbar.showSnackbar("邀请码已复制")
                    }
                }) {
                    Icon(Icons.Filled.ContentCopy, contentDescription = "复制邀请码", tint = MaterialTheme.colorScheme.primary)
                }
            }
        }
    )
}

/** 内容主体：按是否在房间切换入房表单与房间内容。 */
private fun LazyListScope.Content(client: RoomClient, ui: UiState, input: JoinInput) {
    val room = ui.room
    val track = ui.tracks.find { it.id == room?.trackId }
    if (ui.credentials == null) {
        JoinForm(client, ui, input)
    } else {
        item { StatusBanner(ui, onRetry = { client.retry() }, onLeave = { client.leave() }) }
        item { NowPlayingCard(client, ui, input, track) }
        MembersSection(room)
        PlaylistSection(client, ui, room?.trackId)
        item {
            OutlinedButton(
                onClick = { client.leave() },
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(24.dp)
            ) {
                Icon(Icons.AutoMirrored.Outlined.ExitToApp, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text("退出房间")
            }
        }
    }
}

/** 入房表单：Google 风格圆角输入框、胶囊按钮。 */
private fun LazyListScope.JoinForm(client: RoomClient, ui: UiState, input: JoinInput) {
    item {
        Column {
            Text("和朋友分享同一段旋律", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.size(4.dp))
            Text("创建房间，或用 8 位邀请码加入好友", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    item {
        OutlinedTextField(
            value = input.address,
            onValueChange = { input.address = it },
            label = { Text("服务器地址") },
            placeholder = { Text("https://music.example.com") },
            leadingIcon = { Icon(Icons.Outlined.Language, contentDescription = null) },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth()
        )
    }
    item {
        OutlinedTextField(
            value = input.name,
            onValueChange = { input.name = it.take(24) },
            label = { Text("昵称") },
            leadingIcon = { Icon(Icons.Outlined.Person, contentDescription = null) },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth()
        )
    }
    item {
        Button(
            onClick = { client.join(input.address, input.name, null) },
            enabled = !ui.busy && input.name.isNotBlank(),
            shape = RoundedCornerShape(26.dp),
            modifier = Modifier.fillMaxWidth().height(52.dp)
        ) {
            Text("创建房间", style = MaterialTheme.typography.labelLarge)
        }
    }
    item {
        OutlinedTextField(
            value = input.code,
            onValueChange = { input.code = it.uppercase().take(8) },
            label = { Text("8 位邀请码") },
            leadingIcon = { Icon(Icons.Outlined.Tag, contentDescription = null) },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth()
        )
    }
    item {
        OutlinedButton(
            onClick = { client.join(input.address, input.name, input.code) },
            enabled = !ui.busy && input.name.isNotBlank() && input.code.length == 8,
            shape = RoundedCornerShape(26.dp),
            modifier = Modifier.fillMaxWidth().height(52.dp)
        ) {
            Text("加入房间", style = MaterialTheme.typography.labelLarge)
        }
    }
    if (ui.busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
    item { Text("地址只填服务器根目录，不要带 /api 后缀。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
}

/** 连接状态横幅：颜色随状态；重连中附“立即重试”，已过期附“退出房间”形成操作闭环。 */
@Composable
private fun StatusBanner(ui: UiState, onRetry: () -> Unit, onLeave: () -> Unit) {
    val label = ui.message.ifBlank { statusLabel(ui.status) }
    if (label.isBlank()) return
    val reconnecting = ui.status == ConnectionStatus.Reconnecting
    val expired = ui.status == ConnectionStatus.Expired
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = when (ui.status) {
            ConnectionStatus.Ready -> MaterialTheme.colorScheme.secondaryContainer
            ConnectionStatus.Expired -> MaterialTheme.colorScheme.errorContainer
            else -> MaterialTheme.colorScheme.surfaceVariant
        },
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(start = 14.dp, end = if (reconnecting || expired) 4.dp else 14.dp, top = 6.dp, bottom = 6.dp)
        ) {
            Box(
                Modifier.size(9.dp).clip(CircleShape).background(
                    when (ui.status) {
                        ConnectionStatus.Ready -> StatusGreen
                        ConnectionStatus.Reconnecting -> StatusAmber
                        ConnectionStatus.Expired -> MaterialTheme.colorScheme.error
                        else -> MaterialTheme.colorScheme.outline
                    }
                )
            )
            Spacer(Modifier.size(10.dp))
            Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            if (reconnecting) TextButton(onClick = onRetry) { Text("立即重试") }
            if (expired) TextButton(onClick = onLeave) { Text("退出房间") }
        }
    }
}

/**
 * 正在播放卡片：曲目、进度拖动、大号播放按钮。
 *
 * 进度拖动的确认模型（服务端仍是唯一事实来源，本机不提前 seek）：
 * 松手时把目标位置记为 pendingSeek 并发送指令，滑条停在目标处，
 * 避免"跳回旧位置→等广播→再跳走"的大延迟观感；
 * 收到 version 更新的快照且位置贴合目标后恢复跟随服务器进度；
 * 5 秒仍未确认则清除预览并提示重试，不自动重发。
 */
@Composable
private fun NowPlayingCard(client: RoomClient, ui: UiState, input: JoinInput, track: Track?) {
    val room = ui.room
    val duration = (track?.durationMs ?: 1).coerceAtLeast(1).toFloat()
    val playing = room?.playing == true && !ui.locallyPaused
    var pendingSeek by remember { mutableStateOf<Long?>(null) }
    var pendingSeekVersion by remember { mutableStateOf(-1L) }

    // 快照确认：命令之后任何 version 更新的快照，其位置贴合目标即视为跳转已生效。
    LaunchedEffect(ui.room) {
        val snapshot = ui.room ?: return@LaunchedEffect
        val target = pendingSeek ?: return@LaunchedEffect
        val confirmed = snapshot.version > pendingSeekVersion &&
            ((snapshot.playing && snapshot.positionMs >= target - 1500) ||
                (!snapshot.playing && abs(snapshot.positionMs - target) <= 1500))
        if (confirmed) pendingSeek = null
    }
    // 兜底：5 秒未确认按约定提示"未确认，请重试"，不自动重发。
    LaunchedEffect(pendingSeek) {
        if (pendingSeek != null) {
            delay(5_000)
            if (pendingSeek != null) {
                pendingSeek = null
                client.report("进度跳转未确认，请重试")
            }
        }
    }
    ElevatedCard(shape = RoundedCornerShape(24.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("正在播放", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                track?.title ?: "等待选择歌曲",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.size(6.dp))
            Slider(
                value = (input.dragged ?: pendingSeek?.toFloat() ?: ui.positionMs.toFloat()).coerceIn(0f, duration),
                onValueChange = { input.dragged = it },
                onValueChangeFinished = {
                    input.dragged?.let { dragged ->
                        val target = dragged.toLong().coerceIn(0L, duration.toLong())
                        client.command("seek", positionMs = target)
                        pendingSeek = target
                        pendingSeekVersion = room?.version ?: -1L
                    }
                    input.dragged = null
                },
                valueRange = 0f..duration,
                enabled = client.isHost && ui.connected && track != null
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                // 数字与滑块显示同一来源：拖动中跟随手指，确认前停在目标，其余跟随服务器进度。
                Text(
                    formatTime((input.dragged ?: pendingSeek?.toFloat() ?: ui.positionMs.toFloat()).toLong()),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(formatTime(track?.durationMs ?: 0), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            // 滑块被禁用时说明原因，避免跟听者/断线时误以为界面失灵。
            if (track != null && !(client.isHost && ui.connected)) {
                Text(
                    if (!ui.connected) "连接未就绪，暂不可拖动进度" else "跟听模式，进度由房主控制",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                FilledIconButton(
                    onClick = { client.setPlaying(!playing) },
                    enabled = ui.connected && track != null,
                    modifier = Modifier.size(64.dp),
                    colors = IconButtonDefaults.filledIconButtonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary
                    )
                ) {
                    Icon(
                        if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                        contentDescription = if (playing) "暂停" else "播放",
                        modifier = Modifier.size(32.dp)
                    )
                }
            }
        }
    }
}

/** 成员列表：首字母头像、房主徽标、在线状态点。 */
private fun LazyListScope.MembersSection(room: RoomState?) {
    item {
        Text("成员 " + (room?.members?.size ?: 0) + "/15", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }
    items(room?.members ?: emptyList(), key = { it.id }) { member ->
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
            Surface(shape = CircleShape, color = if (member.online) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(40.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        member.name.take(1),
                        style = MaterialTheme.typography.titleMedium,
                        color = if (member.online) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Spacer(Modifier.size(12.dp))
            Text(member.name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (member.id == room?.hostId) {
                Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                    Text("房主", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
                }
                Spacer(Modifier.size(8.dp))
            }
            Box(Modifier.size(9.dp).clip(CircleShape).background(if (member.online) StatusGreen else MaterialTheme.colorScheme.outline))
        }
    }
}

/** 歌单：当前曲目高亮；仅房主可点选。 */
@OptIn(ExperimentalMaterial3Api::class)
private fun LazyListScope.PlaylistSection(client: RoomClient, ui: UiState, currentTrackId: String?) {
    item {
        Text("歌单", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }
    if (ui.tracks.isEmpty()) {
        item { Text("曲库为空，请管理员上传 MP3 并更新曲库清单。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
    items(ui.tracks, key = { it.id }) { song ->
        val current = song.id == currentTrackId
        Card(
            onClick = { client.command("select", trackId = song.id) },
            enabled = client.isHost && ui.connected,
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(
                containerColor = if (current) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
            )
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp)) {
                Icon(
                    if (current) Icons.Rounded.PlayArrow else Icons.Outlined.MusicNote,
                    contentDescription = null,
                    tint = if (current) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(Modifier.size(12.dp))
                Text(
                    song.title,
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (current) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Text(formatTime(song.durationMs), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
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

internal fun formatTime(ms: Long): String {
    val totalSeconds = ms / 1000
    val h = totalSeconds / 3600
    return if (h > 0) "%d:%02d:%02d".format(h, totalSeconds / 60 % 60, totalSeconds % 60)
    else "%d:%02d".format(totalSeconds / 60, totalSeconds % 60)
}
