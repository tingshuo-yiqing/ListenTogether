package com.listentogether.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.mapSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.listentogether.app.InviteCode
import com.listentogether.app.network.RoomClient
import com.listentogether.app.network.UiState
import com.listentogether.app.ui.theme.BannerShape
import com.listentogether.app.ui.theme.CardShape
import com.listentogether.app.ui.theme.FieldShape
import com.listentogether.app.ui.theme.PillShape
import com.listentogether.app.ui.theme.RowShape

/** 入房表单状态可保存；房间令牌不属于表单，也绝不写入 SavedState。 */
internal class JoinInput {
    var address by mutableStateOf("")
    var name by mutableStateOf("")
    var code by mutableStateOf("")
    var joining by mutableStateOf(false)
    /** 扫码得到的邀请确认卡；null 为手填模式。手动编辑输入框即拆卡回手填。 */
    var invite by mutableStateOf<InviteCode.Invite?>(null)

    /** 识别成功后接管表单：房间码与地址取自口令（口令无地址时沿用当前已填/已存值），并展开确认卡。 */
    fun accept(invite: InviteCode.Invite) {
        code = invite.code
        invite.server?.let { address = it }
        this.invite = invite
    }
}

/** 配置变更时保留正在填写的字段；邀请卡只保存公开的房间码和服务器地址。 */
internal val JoinInputSaver = mapSaver(
    save = { input ->
        mapOf(
            "address" to input.address,
            "name" to input.name,
            "code" to input.code,
            "joining" to input.joining,
            "inviteCode" to (input.invite?.code ?: ""),
            "inviteServer" to (input.invite?.server ?: "")
        )
    },
    restore = { saved ->
        JoinInput().apply {
            address = saved["address"] as? String ?: ""
            name = saved["name"] as? String ?: ""
            code = saved["code"] as? String ?: ""
            joining = saved["joining"] as? Boolean ?: false
            val inviteCode = saved["inviteCode"] as? String ?: ""
            if (inviteCode.isNotEmpty()) {
                invite = InviteCode.Invite(inviteCode, (saved["inviteServer"] as? String)?.ifEmpty { null })
            }
        }
    }
)

/**
 * 创建和加入分为两条路径，错误留在表单内；切换路径保留已填信息。
 * 布局收拢为"单卡片表单"：进入即见表单，标题行的应用名已说明这是什么。
 * 扫码入口在顶栏右上角（见 [TopBar]），不再占一整行。
 */
internal fun LazyListScope.JoinForm(client: RoomClient, ui: UiState, input: JoinInput) {
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
                    value = input.name, onValueChange = { input.name = takeCodePoints(it, 24) },
                    label = { Text("怎么称呼你") }, singleLine = true, enabled = !ui.busy,
                    shape = FieldShape, modifier = Modifier.fillMaxWidth()
                )
                if (input.joining) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
                                    input.code = raw.trim().uppercase().take(8)
                                    input.invite = null
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
                        client.join(input.address.trim(), composeNickname(null, input.name), if (input.joining) input.code else null)
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
 * 邀请确认卡：扫描二维码或手动输入后替代邀请码输入框，展示将用于本次入房的房间码与服务器地址。
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
