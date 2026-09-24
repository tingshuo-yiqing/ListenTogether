package com.listentogether.app

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ExitToApp
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.key
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
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
import com.listentogether.app.network.Member
import com.listentogether.app.network.RoomClient
import com.listentogether.app.network.Track
import com.listentogether.app.network.UiState
import com.listentogether.app.playback.PlaybackService
import com.listentogether.app.ui.MemberAvatar
import com.listentogether.app.ui.MiniPlayer
import com.listentogether.app.ui.PlaybackView
import com.listentogether.app.ui.PlayerSheet
import com.listentogether.app.ui.PlayingIndicator
import com.listentogether.app.ui.joinError
import com.listentogether.app.ui.rememberRoomPlayer
import com.listentogether.app.ui.showStatusNotice
import com.listentogether.app.ui.screenStates
import com.listentogether.app.ui.theme.BannerShape
import com.listentogether.app.ui.theme.CardShape
import com.listentogether.app.ui.theme.FieldShape
import com.listentogether.app.ui.theme.ListenTogetherTheme
import com.listentogether.app.ui.theme.PillShape
import com.listentogether.app.ui.theme.RowShape
import java.util.Locale
import kotlinx.coroutines.launch

/** 入房表单的可变输入；进程重建后丢失属可接受（地址会从偏好重新预填）。 */
private class JoinInput {
    var address by mutableStateOf("")
    var name by mutableStateOf("")
    var code by mutableStateOf("")
    var joining by mutableStateOf(false)
    /** 粘贴/识别出的邀请确认卡；null 为手填模式。手动编辑输入框即拆卡回手填。 */
    var invite by mutableStateOf<InviteCode.Invite?>(null)

    /** 识别成功后接管表单：房间码与地址取自口令（口令无地址时沿用当前已填/已存值），并展开确认卡。 */
    fun accept(invite: InviteCode.Invite) {
        code = invite.code
        invite.server?.let { address = it }
        this.invite = invite
    }
}

@UnstableApi
class MainActivity : ComponentActivity() {
    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val client = (application as ListenApplication).roomClient
        setContent {
            ListenTogetherTheme {
                val screenState = remember(client) { client.state.screenStates() }
                val initialScreen = remember(client) { client.state.value.copy(positionMs = 0) }
                val ui by screenState.collectAsState(initial = initialScreen)
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
                // 非房主点切歌入口的统一提示；展开播放页与歌单共用同一份。
                val onLockedTap: () -> Unit = { scope.launch { snackbar.showSnackbar("只有房主可以切歌") } }
                var showLeaveConfirm by rememberSaveable { mutableStateOf(false) }
                val room = ui.room
                val track = ui.tracks.find { it.id == room?.trackId }
                // 播放器状态挂在房间会话作用域：mini 条与展开 Sheet 共享，Sheet 关闭不中断 seek 确认。
                val playerState = rememberRoomPlayer(client, ui, track)
                var showPlayerSheet by rememberSaveable(ui.credentials?.token) { mutableStateOf(false) }
                Scaffold(
                    topBar = { TopBar(ui, client.baseUrl, onLeaveRequest = { showLeaveConfirm = true }) },
                    bottomBar = {
                        if (ui.credentials != null) {
                            MiniPlayer(client, ui, playerState, track, playback, onExpand = { showPlayerSheet = true })
                        }
                    },
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
                        key(ui.credentials?.token) {
                            LazyColumn(
                                Modifier.widthIn(max = 560.dp).fillMaxSize(),
                                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Content(client, ui, input, playback, snackbar, onLockedTap)
                            }
                        }
                    }
                }
                if (ui.credentials != null && showPlayerSheet) {
                    PlayerSheet(client, ui, playerState, track, playback, onLockedTap, onDismiss = { showPlayerSheet = false })
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

/** 顶栏：始终显示应用名；房间页额外提供分享与退出入口（退出走确认弹窗）。邀请统一走分享口令，顶栏不再展示房间码。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TopBar(ui: UiState, baseUrl: String, onLeaveRequest: () -> Unit) {
    val context = LocalContext.current
    // 口令唯一来源：分享入口使用 encode 产物，避免硬编码漂移；
    // 口令只含房间码与服务器地址（公开信息，默认端口在口令里省略），绝不包含成员令牌。
    val inviteText = ui.credentials?.let { InviteCode.encode(it.code, baseUrl) }.orEmpty()
    TopAppBar(
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
        title = {
            Text("一起听歌", style = MaterialTheme.typography.titleLarge)
        },
        actions = {
            if (ui.credentials != null) {
                IconButton(onClick = {
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, inviteText)
                    }
                    context.startActivity(Intent.createChooser(send, "分享邀请"))
                }) {
                    Icon(Icons.Outlined.Share, contentDescription = "分享邀请口令", tint = MaterialTheme.colorScheme.primary)
                }
                IconButton(onClick = onLeaveRequest) {
                    Icon(Icons.AutoMirrored.Outlined.ExitToApp, contentDescription = "退出房间", tint = MaterialTheme.colorScheme.primary)
                }
            }
        }
    )
}

/** 内容主体：按是否在房间切换入房表单与房间内容；播放器常驻底部（MiniPlayer/Sheet），不再占列表位。 */
private fun LazyListScope.Content(client: RoomClient, ui: UiState, input: JoinInput, playback: PlaybackView, snackbar: SnackbarHostState, onLockedTap: () -> Unit) {
    val room = ui.room
    if (ui.credentials == null) {
        JoinForm(client, ui, input, snackbar)
    } else {
        if (showStatusNotice(ui, playback)) item(key = "status", contentType = "status") { StatusBanner(ui, playback, onRetry = { client.retry() }, onLeave = { client.leave() }) }
        item(key = "members", contentType = "members") { MembersSection(ui) }
        PlaylistSection(client, ui, room?.trackId, room?.playing == true && !ui.locallyPaused, onLockedTap)
    }
}

/**
 * 创建和加入分为两条路径，错误留在表单内；切换路径保留已填信息。
 * 布局收拢为"标题区 + 单卡片表单"：标签、输入、错误与主按钮同处一张卡，
 * 视线在一个动作区内完成"选路径→填信息→点按钮"，不再逐块平铺。
 */
private fun LazyListScope.JoinForm(client: RoomClient, ui: UiState, input: JoinInput, snackbar: SnackbarHostState) {
    item(key = "join-heading", contentType = "heading") {
        Column(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 4.dp)) {
            Text("此刻，一起听", style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(4.dp))
            Text("和朋友分享同一段旋律", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    item(key = "join-card", contentType = "form") {
        Surface(shape = CardShape, color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth().clip(FieldShape).background(MaterialTheme.colorScheme.surface).padding(4.dp)) {
                    listOf("创建房间", "加入房间").forEachIndexed { index, label ->
                        val selected = input.joining == (index == 1)
                        Box(
                            Modifier.weight(1f).clip(RowShape)
                                .background(if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)
                                .selectable(selected = selected, enabled = !ui.busy, role = Role.Tab) { input.joining = index == 1 }
                                .heightIn(min = 48.dp).padding(8.dp),
                            contentAlignment = Alignment.Center
                        ) { Text(label, style = MaterialTheme.typography.titleSmall, color = if (selected) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
                OutlinedTextField(
                    value = input.name, onValueChange = { input.name = it.take(24) },
                    label = { Text("怎么称呼你") }, singleLine = true, enabled = !ui.busy,
                    shape = FieldShape, modifier = Modifier.fillMaxWidth()
                )
                if (input.joining) {
                    val clipboard = LocalClipboard.current
                    val scope = rememberCoroutineScope()
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(
                            onClick = {
                                scope.launch {
                                    // 只读一次剪贴板；Android 13+ 粘贴后系统会自行提示，成功不再额外弹告知。
                                    val text = clipboard.getClipEntry()?.clipData?.let { data ->
                                        (0 until data.itemCount).asSequence()
                                            .mapNotNull { data.getItemAt(it).text?.toString() }
                                            .firstOrNull { it.isNotBlank() }
                                    } ?: ""
                                    val parsed = InviteCode.decode(text)
                                    if (parsed == null) snackbar.showSnackbar("未识别到有效邀请，请复制完整邀请后重试")
                                    else input.accept(parsed)
                                }
                            },
                            enabled = !ui.busy,
                            shape = PillShape,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 40.dp)
                        ) {
                            Icon(Icons.Outlined.ContentPaste, contentDescription = null, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("粘贴邀请")
                        }
                        // 解析成功用确认卡替换手填输入框；与下方错误横幅互斥展示——入房失败时优先显示横幅，
                        // 确认卡数据保留（不销毁已填昵称），横幅消失（重新入房）后恢复显示。
                        val invite = input.invite
                        if (invite != null && joinError(ui) == null) {
                            InviteConfirmCard(
                                invite = invite,
                                rememberedAddress = client.baseUrl,
                                busy = ui.busy,
                                onReset = { input.invite = null }
                            )
                        } else {
                            OutlinedTextField(
                                value = input.code,
                                onValueChange = { raw ->
                                    if (raw.length > 8 && raw.contains("房间码")) {
                                        // 智能识别兜底：整段口令可能被直接粘进邀请码框；解析失败保留用户输入不动。
                                        InviteCode.decode(raw)?.let { input.accept(it) }
                                    } else {
                                        input.code = raw.trim().uppercase().take(8)
                                        input.invite = null
                                    }
                                },
                                label = { Text("8 位邀请码") }, singleLine = true, enabled = !ui.busy,
                                supportingText = { Text("向房主获取邀请码") },
                                shape = FieldShape, modifier = Modifier.fillMaxWidth()
                            )
                        }
                    }
                }
                // 服务器地址属基础设施细节，默认收起以保持主路径干净；
                // 地址为空（首次使用或未记住）时自动展开，避免用户不知道去哪填。
                var showAdvanced by rememberSaveable { mutableStateOf(false) }
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
                        Text("高级设置：更换服务器地址", style = MaterialTheme.typography.bodySmall)
                    }
                }
                // 入房错误横幅在卡内按钮上方；与确认卡互斥展示（确认卡侧在 joinError 存在时回退为输入框）。
                joinError(ui)?.let { message ->
                    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = BannerShape) {
                        Text(message, color = MaterialTheme.colorScheme.onErrorContainer,
                            modifier = Modifier.fillMaxWidth().padding(14.dp).semantics { liveRegion = LiveRegionMode.Polite })
                    }
                }
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
        }
    }
    if (ui.busy) item(key = "join-progress", contentType = "progress") { LinearProgressIndicator(Modifier.fillMaxWidth()) }
}

/**
 * 邀请确认卡：粘贴/识别成功后替代邀请码输入框，展示将用于本次入房的房间码与服务器地址。
 * 容器 liveRegion=Polite 供读屏在内容出现时播报；「重新输入」拆卡回手填，已填昵称与地址保留。
 */
@Composable
private fun InviteConfirmCard(invite: InviteCode.Invite, rememberedAddress: String, busy: Boolean, onReset: () -> Unit) {
    val fromInvite = invite.server != null && invite.server != rememberedAddress
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = BannerShape,
        modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }
    ) {
        Column(Modifier.padding(14.dp)) {
            // 房间码等宽显示，与顶栏一致，降低 0/O、B/8 误读。
            Text(invite.code, style = MaterialTheme.typography.titleMedium, fontFamily = FontFamily.Monospace)
            if (invite.server != null) {
                Spacer(Modifier.height(2.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // 地址与已记住地址不同时给提示（不阻断，入房以口令地址为准）；图标旁有同义文字，读屏不重复播报。
                    if (fromInvite) {
                        Icon(Icons.Outlined.Info, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(6.dp))
                    }
                    Text(invite.server, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (fromInvite) {
                    Text("将使用邀请中的服务器地址", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            TextButton(onClick = onReset, enabled = !busy) { Text("重新输入") }
        }
    }
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

/** 成员区默认压缩为一行：头像堆叠 + 人数摘要，整行点击展开完整列表；折叠状态只属于当前房间页面。 */
@Composable
private fun MembersSection(ui: UiState) {
    var expanded by rememberSaveable(ui.credentials?.code) { mutableStateOf(false) }
    val members = ui.room?.members.orEmpty()
    Column {
        Row(
            Modifier.fillMaxWidth().clip(RowShape)
                .selectable(selected = false, role = Role.Button) { expanded = !expanded }
                .padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AvatarStack(members)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(members.count { it.online }.toString() + " 人一起听", style = MaterialTheme.typography.titleSmall)
                Text(if (ui.status == ConnectionStatus.Ready) "已连接" else statusLabel(ui.status),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(
                if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                contentDescription = if (expanded) "收起成员" else "查看成员",
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (expanded) members.forEach { member ->
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                MemberAvatar(memberId = member.id, name = member.name, online = member.online)
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
    item(key = "playlist-heading", contentType = "heading") {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("歌单", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Text("${ui.tracks.size} 首", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    if (ui.tracks.isEmpty()) {
        item { Text("还没有歌曲，联系房主添加后再来听。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        return
    }
    items(ui.tracks, key = { "track:${it.id}" }, contentType = { "track" }) { song ->
        PlaylistRow(song, song.id == currentTrackId, playingNow && song.id == currentTrackId, ui.status == ConnectionStatus.Ready) {
            if (client.isHost) client.command("select", trackId = song.id) else onLockedTap()
        }
    }
}

/** 每行只接收展示所需数据，播放进度变化不会使整张歌单重组。 */
@Composable
private fun PlaylistRow(song: Track, current: Boolean, playing: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val durationLabel = remember(song.durationMs) { formatTime(song.durationMs) }
    Surface(
        shape = RowShape,
        color = if (current) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
        modifier = Modifier.fillMaxWidth()
            .semantics { if (current) stateDescription = "当前曲目" }
            .clickable(enabled = enabled, onClick = onClick)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 12.dp, vertical = 10.dp)) {
            if (current && playing) {
                PlayingIndicator(color = MaterialTheme.colorScheme.onPrimaryContainer)
            } else {
                Icon(
                    Icons.Outlined.MusicNote,
                    contentDescription = null,
                    tint = if (current) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp)
                )
            }
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

internal fun formatTime(ms: Long): String {
    val totalSeconds = ms / 1000
    val h = totalSeconds / 3600
    return if (h > 0) String.format(Locale.ROOT, "%d:%02d:%02d", h, totalSeconds / 60 % 60, totalSeconds % 60)
    else String.format(Locale.ROOT, "%d:%02d", totalSeconds / 60, totalSeconds % 60)
}
