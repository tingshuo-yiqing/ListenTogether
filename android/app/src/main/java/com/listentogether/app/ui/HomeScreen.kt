package com.listentogether.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.listentogether.app.InviteCode
import com.listentogether.app.network.RoomClient
import com.listentogether.app.network.UiState
import com.listentogether.app.ui.theme.BannerShape
import com.listentogether.app.ui.theme.ButtonShape
import com.listentogether.app.ui.theme.CardShape
import com.listentogether.app.ui.theme.FieldShape
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

/** 创建与加入共用真实入房表单；模式切换仅改变展示，保留昵称、邀请码与地址。 */
internal fun LazyListScope.JoinForm(client: RoomClient, ui: UiState, input: JoinInput) {
    item(key = "join-heading", contentType = "heading") {
        Text(
            if (input.joining) "加入房间" else "创建房间",
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.padding(top = 12.dp, bottom = 16.dp).semantics { heading() }
        )
    }
    item(key = "join-card", contentType = "form") {
        val colors = MaterialTheme.colorScheme
        val fieldColors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = colors.surface,
            unfocusedContainerColor = colors.surface,
            disabledContainerColor = colors.surface,
            unfocusedBorderColor = colors.outline
        )
        Surface(shape = CardShape, color = colors.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(
                    Modifier.fillMaxWidth().clip(FieldShape).background(colors.surface).padding(4.dp).selectableGroup(),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    listOf("创建房间", "加入房间").forEachIndexed { index, label ->
                        val selected = input.joining == (index == 1)
                        Box(
                            Modifier.weight(1f).clip(RowShape)
                                .background(if (selected) colors.primary else Color.Transparent)
                                .selectable(selected = selected, enabled = !ui.busy, role = Role.Tab) { input.joining = index == 1 }
                                .heightIn(min = 48.dp).padding(8.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(label, style = MaterialTheme.typography.titleSmall,
                                color = if (selected) colors.onPrimary else colors.onSurfaceVariant)
                        }
                    }
                }
                OutlinedTextField(
                    value = input.name, onValueChange = { input.name = takeCodePoints(it, 24) },
                    label = { Text("怎么称呼你") }, singleLine = true, enabled = !ui.busy,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    colors = fieldColors, shape = FieldShape, modifier = Modifier.fillMaxWidth()
                )
                if (input.joining) {
                    val invite = input.invite
                    // 入房失败时显示原输入框和真实错误，邀请信息仍留在会话表单中供重新确认。
                    if (invite != null && joinError(ui) == null) {
                        InviteConfirmCard(invite, client.baseUrl, ui.busy, onReset = { input.invite = null })
                    } else {
                        OutlinedTextField(
                            value = input.code,
                            onValueChange = { raw ->
                                input.code = raw.trim().uppercase().take(8)
                                input.invite = null
                            },
                            label = { Text("8 位邀请码") }, placeholder = { Text("例如 A84AFF71") },
                            singleLine = true, enabled = !ui.busy,
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Next),
                            supportingText = { Text("向房主获取邀请码，或点击右上角扫码") },
                            colors = fieldColors, shape = FieldShape, modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
                // 首次地址空时直接提供填写位置，已保存地址默认折叠；展开不会改写真实地址。
                var showAdvanced by rememberSaveable { mutableStateOf(input.address.isBlank()) }
                TextButton(
                    onClick = { showAdvanced = !showAdvanced }, enabled = !ui.busy,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).semantics {
                        stateDescription = if (showAdvanced) "已展开" else "已收起"
                    }
                ) {
                    Text("高级设置", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                    Icon(if (showAdvanced) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, contentDescription = null)
                }
                if (showAdvanced) {
                    OutlinedTextField(
                        value = input.address, onValueChange = { input.address = it },
                        label = { Text("服务器地址") }, placeholder = { Text("https://music.example.com") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                        singleLine = true, enabled = !ui.busy, colors = fieldColors, shape = FieldShape,
                        supportingText = { Text("与好友使用同一个服务器地址") }, modifier = Modifier.fillMaxWidth()
                    )
                }
                joinError(ui)?.let { message ->
                    Surface(color = colors.errorContainer, shape = BannerShape) {
                        Text(message, color = colors.onErrorContainer,
                            style = MaterialTheme.typography.bodySmall,
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
                    shape = ButtonShape, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)
                ) {
                    if (ui.busy) {
                        CircularProgressIndicator(Modifier.size(20.dp), color = colors.primary, strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(if (ui.busy) "正在连接…" else if (input.joining) "加入，一起听" else "创建房间")
                    if (!ui.busy) {
                        Spacer(Modifier.width(8.dp))
                        Icon(Icons.AutoMirrored.Outlined.ArrowForward, contentDescription = null, modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
    }
}

/** 扫码确认只展示公开邀请信息；已填昵称与地址不会因「重新输入」丢失。 */
@Composable
private fun InviteConfirmCard(invite: InviteCode.Invite, rememberedAddress: String, busy: Boolean, onReset: () -> Unit) {
    val fromInvite = invite.server != null && invite.server != rememberedAddress
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = FieldShape,
        modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("已识别邀请", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(invite.code, style = MaterialTheme.typography.headlineSmall, fontFamily = FontFamily.Monospace)
            if (invite.server != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (fromInvite) {
                        Icon(Icons.Outlined.Info, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(invite.server, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (fromInvite) {
                    Text("将使用邀请中的服务器地址", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            TextButton(onClick = onReset, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("重新输入") }
        }
    }
}