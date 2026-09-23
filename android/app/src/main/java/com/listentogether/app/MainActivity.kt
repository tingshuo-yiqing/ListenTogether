package com.listentogether.app

import android.Manifest
import android.content.ClipData
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ExitToApp
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.listentogether.app.network.ConnectionStatus
import com.listentogether.app.network.RoomClient
import com.listentogether.app.network.Track
import com.listentogether.app.network.UiState
import com.listentogether.app.playback.PlaybackService
import com.listentogether.app.ui.PlaybackView
import com.listentogether.app.ui.joinError
import com.listentogether.app.ui.playbackLabel
import com.listentogether.app.ui.showStatusNotice
import com.listentogether.app.ui.theme.BannerShape
import com.listentogether.app.ui.theme.CardShape
import com.listentogether.app.ui.theme.FieldShape
import com.listentogether.app.ui.theme.ListenTogetherTheme
import com.listentogether.app.ui.theme.PillShape
import com.listentogether.app.ui.theme.RowShape
import java.util.Locale
import kotlin.math.abs
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** 入房表单的可变输入；进程重建后丢失属可接受（地址会从偏好重新预填）。 */
private class JoinInput {
    var address by mutableStateOf("")
    var name by mutableStateOf("")
    var code by mutableStateOf("")
    var dragged by mutableStateOf<Float?>(null)
    var joining by mutableStateOf(false)
}

@UnstableApi
class MainActivity : ComponentActivity() {
    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val client = (application as ListenApplication).roomClient
        setContent {
            ListenTogetherTheme {
                val ui by client.state.collectAsState()
                // 通知权限延迟到有实际播放场景（入房成功）再申请，避免冷启动弹窗；每次安装只问一次。
                var notificationAsked by rememberSaveable { mutableStateOf(false) }
                LaunchedEffect(ui.credentials != null) {
                    if (ui.credentials != null && Build.VERSION.SDK_INT >= 33 && !notificationAsked) {
                        notificationAsked = true
                        permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                }
                // 房间内按返回只退出界面：播放由 Service 继续，提示用户去通知栏停止。
                if (ui.credentials != null) BackHandler {
                    Toast.makeText(this@MainActivity, "仍在后台播放，可在通知栏停止", Toast.LENGTH_SHORT).show()
                    finish()
                }
                var playback by remember(ui.credentials?.token) { mutableStateOf(PlaybackView()) }
                // Controller 保持与 Service 连接；Activity 销毁只释放控制器，不销毁后台播放器。
                DisposableEffect(ui.credentials?.token) {
                    var disposed = false
                    val future = if (ui.credentials != null) {
                        startService(Intent(this@MainActivity, PlaybackService::class.java))
                        MediaController.Builder(this@MainActivity, SessionToken(this@MainActivity, ComponentName(this@MainActivity, PlaybackService::class.java)))
                            .setListener(object : MediaController.Listener {
                                override fun onDisconnected(controller: MediaController) {
                                    if (!disposed) playback = PlaybackView()
                                }
                            }).buildAsync()
                    } else null
                    var bound: MediaController? = null
                    fun readPlayer(player: Player) {
                        if (disposed) return
                        playback = PlaybackView(
                            connected = true, mediaId = player.currentMediaItem?.mediaId,
                            playing = player.isPlaying, buffering = player.playbackState == Player.STATE_BUFFERING,
                            failed = player.playerError != null
                        )
                    }
                    val listener = object : Player.Listener {
                        override fun onEvents(player: Player, events: Player.Events) = readPlayer(player)
                    }
                    future?.addListener({
                        // 迟到的控制器结果不能更新已离开的页面会话。
                        if (!disposed) runCatching {
                            future.get().also { bound = it; it.addListener(listener); readPlayer(it) }
                        }.onFailure { playback = PlaybackView() }
                    }, ContextCompat.getMainExecutor(this@MainActivity))
                    onDispose {
                        disposed = true
                        bound?.removeListener(listener)
                        future?.let { MediaController.releaseFuture(it) }
                    }
                }
                val input = remember(ui.credentials?.token) { JoinInput().apply { address = client.baseUrl } }
                // 软键盘弹出时给内容区加 IME 内边距，避免输入框与按钮被顶出视野；
                // 点空白处收起键盘（实测该设备 ESC 无法关闭输入法）。
                val focusManager = LocalFocusManager.current
                val snackbar = remember { SnackbarHostState() }
                val scope = rememberCoroutineScope()
                var showLeaveConfirm by rememberSaveable { mutableStateOf(false) }
                Scaffold(
                    topBar = { TopBar(ui, snackbar, onLeaveRequest = { showLeaveConfirm = true }) },
                    snackbarHost = { SnackbarHost(snackbar) },
                    containerColor = MaterialTheme.colorScheme.background
                ) { padding ->
                    // 大屏上限宽居中，避免表单与卡片被横向拉伸；窄屏行为不变。
                    Box(
                        Modifier.fillMaxSize().padding(padding).imePadding().pointerInput(Unit) {
                            detectTapGestures { focusManager.clearFocus() }
                        },
                        contentAlignment = Alignment.TopCenter
                    ) {
                        LazyColumn(
                            Modifier.fillMaxWidth().widthIn(max = 560.dp),
                            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Content(client, ui, input, playback, onLockedTap = {
                                scope.launch { snackbar.showSnackbar("只有房主可以切歌") }
                            })
                        }
                    }
                }
                if (showLeaveConfirm && ui.credentials != null) {
                    AlertDialog(
                        onDismissRequest = { showLeaveConfirm = false },
                        title = { Text("退出房间？") },
                        text = { Text("退出后需要重新输入邀请码才能回来。") },
                        confirmButton = {
                            TextButton(onClick = { showLeaveConfirm = false; client.leave() }) { Text("退出房间") }
                        },
                        dismissButton = { TextButton(onClick = { showLeaveConfirm = false }) { Text("取消") } }
                    )
                }
            }
        }
    }
}

/** 顶栏：入房页显示应用名；房间页显示房间码与角色，附分享/复制邀请码与退出房间入口（退出走确认弹窗）。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TopBar(ui: UiState, snackbar: SnackbarHostState, onLeaveRequest: () -> Unit) {
    CenterAlignedTopAppBar(
        colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = MaterialTheme.colorScheme.background),
        title = {
            if (ui.credentials == null) {
                Text("一起听歌", style = MaterialTheme.typography.titleLarge)
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    // 房间码等宽显示，降低 B/8、0/O 误读概率。
                    Text(ui.credentials.code, style = MaterialTheme.typography.titleMedium, fontFamily = FontFamily.Monospace)
                    Text(
                        if (ui.room?.hostId == ui.credentials.memberId) "房主" else "一起听歌",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        },
        actions = {
            if (ui.credentials != null) {
                val context = LocalContext.current
                val clipboard = LocalClipboard.current
                val scope = rememberCoroutineScope()
                IconButton(onClick = {
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, "来一起听歌，房间邀请码 ${ui.credentials.code}")
                    }
                    context.startActivity(Intent.createChooser(send, "分享邀请码"))
                }) {
                    Icon(Icons.Outlined.Share, contentDescription = "分享邀请码", tint = MaterialTheme.colorScheme.primary)
                }
                IconButton(onClick = {
                    scope.launch {
                        clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("code", ui.credentials.code)))
                        snackbar.showSnackbar("邀请码已复制")
                    }
                }) {
                    Icon(Icons.Outlined.ContentCopy, contentDescription = "复制邀请码", tint = MaterialTheme.colorScheme.primary)
                }
                IconButton(onClick = onLeaveRequest) {
                    Icon(Icons.AutoMirrored.Outlined.ExitToApp, contentDescription = "退出房间", tint = MaterialTheme.colorScheme.primary)
                }
            }
        }
    )
}

/** 内容主体：按是否在房间切换入房表单与房间内容；退出房间统一走顶栏确认弹窗。 */
private fun LazyListScope.Content(client: RoomClient, ui: UiState, input: JoinInput, playback: PlaybackView, onLockedTap: () -> Unit) {
    val room = ui.room
    val track = ui.tracks.find { it.id == room?.trackId }
    if (ui.credentials == null) {
        JoinForm(client, ui, input)
    } else {
        if (showStatusNotice(ui, playback)) item { StatusBanner(ui, playback, onRetry = { client.retry() }, onLeave = { client.leave() }) }
        item { MembersSection(ui) }
        item { NowPlayingCard(client, ui, input, track, playback) }
        PlaylistSection(client, ui, room?.trackId, onLockedTap)
    }
}

/** 创建和加入分为两条路径，错误留在表单内；切换路径保留已填信息。 */
private fun LazyListScope.JoinForm(client: RoomClient, ui: UiState, input: JoinInput) {
    item {
        Column(Modifier.padding(vertical = 12.dp)) {
            Text("此刻，一起听", style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(8.dp))
            Text("和朋友分享同一段旋律", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    item {
        TabRow(selectedTabIndex = if (input.joining) 1 else 0, containerColor = Color.Transparent) {
            Tab(selected = !input.joining, onClick = { input.joining = false }, enabled = !ui.busy, text = { Text("创建房间") })
            Tab(selected = input.joining, onClick = { input.joining = true }, enabled = !ui.busy, text = { Text("加入房间") })
        }
    }
    item {
        OutlinedTextField(
            value = input.name, onValueChange = { input.name = it.take(24) },
            label = { Text("怎么称呼你") }, singleLine = true, enabled = !ui.busy,
            shape = FieldShape, modifier = Modifier.fillMaxWidth()
        )
    }
    if (input.joining) item {
        OutlinedTextField(
            value = input.code, onValueChange = { input.code = it.trim().uppercase().take(8) },
            label = { Text("8 位邀请码") }, singleLine = true, enabled = !ui.busy,
            supportingText = { Text("向房主获取邀请码") },
            shape = FieldShape, modifier = Modifier.fillMaxWidth()
        )
    }
    item {
        // 服务器地址属基础设施细节，默认收起以保持主路径干净；
        // 地址为空（首次使用或未记住）时自动展开，避免用户不知道去哪填。
        var showAdvanced by rememberSaveable { mutableStateOf(false) }
        Column {
            if (showAdvanced || input.address.isBlank()) {
                OutlinedTextField(
                    value = input.address, onValueChange = { input.address = it },
                    label = { Text("服务器地址") }, placeholder = { Text("https://music.example.com") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    singleLine = true, enabled = !ui.busy, shape = FieldShape,
                    supportingText = { Text("与好友使用同一个服务器地址") }, modifier = Modifier.fillMaxWidth()
                )
            } else {
                TextButton(onClick = { showAdvanced = true }, enabled = !ui.busy) {
                    Text("高级设置：更换服务器地址")
                }
            }
        }
    }
    joinError(ui)?.let { message ->
        item {
            Surface(color = MaterialTheme.colorScheme.errorContainer, shape = BannerShape) {
                Text(message, color = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.fillMaxWidth().padding(14.dp).semantics { liveRegion = LiveRegionMode.Polite })
            }
        }
    }
    item {
        val focus = LocalFocusManager.current
        Button(
            onClick = {
                focus.clearFocus()
                client.join(input.address.trim(), input.name.trim(), if (input.joining) input.code else null)
            },
            enabled = !ui.busy && input.name.isNotBlank() && input.address.isNotBlank() &&
                (!input.joining || input.code.matches(Regex("[0-9A-F]{8}"))),
            shape = PillShape, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
        ) { Text(if (ui.busy) "正在连接…" else if (input.joining) "加入，一起听" else "创建房间") }
    }
    if (ui.busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
}

/** 正常连接收进成员摘要；异常和本机中断保留文字及操作。 */
@Composable
private fun StatusBanner(ui: UiState, playback: PlaybackView, onRetry: () -> Unit, onLeave: () -> Unit) {
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
            if (expired || failed) TextButton(onClick = onLeave) { Text("退出房间") }
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
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NowPlayingCard(client: RoomClient, ui: UiState, input: JoinInput, track: Track?, playback: PlaybackView) {
    val room = ui.room
    val duration = (track?.durationMs ?: 1).coerceAtLeast(1).toFloat()
    val playing = room?.playing == true && !ui.locallyPaused
    var pendingSeek by remember(ui.credentials?.token, track?.id) { mutableStateOf<Long?>(null) }
    var pendingSeekVersion by remember(ui.credentials?.token, track?.id) { mutableStateOf(-1L) }

    LaunchedEffect(track?.id) { input.dragged = null }
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
    ElevatedCard(shape = CardShape, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("当前歌曲", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(playbackLabel(ui, playback), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(
                track?.title ?: if (client.isHost) "选一首喜欢的歌" else "等待房主选歌",
                style = MaterialTheme.typography.headlineSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.size(6.dp))
            // 默认 M3 Slider 手柄是 4×44dp 竖长条，观感突兀且占竖向空间；改用圆点端点 + 细轨道。
            val sliderColors = SliderDefaults.colors()
            val sliderEnabled = client.isHost && ui.status == ConnectionStatus.Ready && track != null
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
                enabled = sliderEnabled,
                thumb = {
                    Box(
                        Modifier.size(14.dp)
                            .clip(CircleShape)
                            .background(if (sliderEnabled) sliderColors.thumbColor else sliderColors.disabledThumbColor)
                    )
                },
                track = {
                    val shown = (input.dragged ?: pendingSeek?.toFloat() ?: ui.positionMs.toFloat()).coerceIn(0f, duration)
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
            if (track != null) {
                Text(
                    if (ui.status != ConnectionStatus.Ready) "连接就绪后即可播放" else if (client.isHost) "播放与暂停同步给所有人" else "暂停只影响自己 · 进度由房主控制",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                FilledIconButton(
                    onClick = { client.setPlaying(!playing) },
                    enabled = ui.status == ConnectionStatus.Ready && track != null,
                    modifier = Modifier.size(64.dp),
                    colors = IconButtonDefaults.filledIconButtonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary
                    )
                ) {
                    Icon(
                        if (playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                        contentDescription = if (playing) "暂停" else "播放",
                        modifier = Modifier.size(32.dp)
                    )
                }
            }
        }
    }
}

/** 默认显示人数摘要，展开后查看成员；折叠状态只属于当前房间页面。 */
@Composable
private fun MembersSection(ui: UiState) {
    var expanded by rememberSaveable(ui.credentials?.code) { mutableStateOf(false) }
    val members = ui.room?.members.orEmpty()
    Column {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(members.count { it.online }.toString() + " 人一起听", style = MaterialTheme.typography.titleSmall)
                Text(if (ui.status == ConnectionStatus.Ready) "已连接" else statusLabel(ui.status),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "收起成员" else "查看成员") }
        }
        if (expanded) members.forEach { member ->
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = CircleShape, color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.size(32.dp)) {
                    Box(contentAlignment = Alignment.Center) { Text(member.name.take(1)) }
                }
                Spacer(Modifier.width(12.dp))
                Text(member.name, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    (if (member.id == ui.room?.hostId) "房主 · " else "") + if (member.online) "在线" else "离线",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/** 歌单：当前曲目高亮；仅房主可切歌，非房主点击给出提示而不是静默无响应。 */
@OptIn(ExperimentalMaterial3Api::class)
private fun LazyListScope.PlaylistSection(client: RoomClient, ui: UiState, currentTrackId: String?, onLockedTap: () -> Unit) {
    item {
        Text("歌单", style = MaterialTheme.typography.titleMedium)
    }
    if (ui.tracks.isEmpty()) {
        item { Text("还没有歌曲，联系房主添加后再来听。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
    items(ui.tracks, key = { it.id }) { song ->
        val current = song.id == currentTrackId
        Surface(
            shape = RowShape,
            color = if (current) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
            modifier = Modifier.fillMaxWidth()
                .semantics { if (current) stateDescription = "当前曲目" }
                .clickable(enabled = ui.status == ConnectionStatus.Ready) {
                    if (client.isHost) client.command("select", trackId = song.id) else onLockedTap()
                }
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 12.dp, vertical = 10.dp)) {
                Icon(
                    Icons.Outlined.MusicNote,
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
                Spacer(Modifier.width(12.dp))
                Text((if (current) "当前 · " else "") + formatTime(song.durationMs), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
    return if (h > 0) String.format(Locale.ROOT, "%d:%02d:%02d", h, totalSeconds / 60 % 60, totalSeconds % 60)
    else String.format(Locale.ROOT, "%d:%02d", totalSeconds / 60, totalSeconds % 60)
}
