package com.listentogether.app.ui

import android.content.ClipData
import android.content.Intent
import android.graphics.Color as AndroidColor
import androidx.compose.foundation.Image
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.graphics.createBitmap
import androidx.core.graphics.set
import com.listentogether.app.InviteCode
import com.listentogether.app.network.RoomClient
import com.listentogether.app.network.UiState
import com.listentogether.app.ui.theme.RowShape
import kotlinx.coroutines.launch

/** 邀请只在成员面板中提供；二维码、剪贴板和系统分享使用同一公开口令。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun MembersSheet(client: RoomClient, ui: UiState, onDismiss: () -> Unit) {
    val invite = ui.credentials?.let { InviteCode.encode(it.code, client.baseUrl) } ?: return
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var qrOpen by rememberSaveable { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("一起听的朋友", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                    IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, "关闭成员面板") }
                }
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 180.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(ui.room?.members.orEmpty(), key = { it.id }) { member ->
                Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically) {
                    MemberAvatar(member.id, member.name, member.online, avatarId = member.avatarId)
                    Text(memberDisplayName(member.name), modifier = Modifier.weight(1f).padding(horizontal = 12.dp), style = MaterialTheme.typography.bodyLarge)
                    Text((if (member.id == ui.room?.hostId) "房主 · " else "") + if (member.online) "在线" else "离线", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            }
            HorizontalDivider()
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    TextButton(onClick = { qrOpen = !qrOpen }) { Icon(Icons.Outlined.QrCode2, null); Spacer(Modifier.width(6.dp)); Text("二维码") }
                    TextButton(onClick = { scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("一起听歌邀请", invite))); copied = true } }) { Icon(Icons.Outlined.ContentCopy, null); Spacer(Modifier.width(6.dp)); Text(if (copied) "已复制" else "复制") }
                    TextButton(onClick = { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, invite) }, "分享邀请")) }) { Icon(Icons.Outlined.Share, null); Spacer(Modifier.width(6.dp)); Text("分享") }
                }
            if (qrOpen) {
                val bitmap = remember(invite) {
                    val matrix = encodeInviteQr(invite, 640)
                    createBitmap(640, 640).apply { for (y in 0 until 640) for (x in 0 until 640) this[x, y] = if (matrix[x, y]) AndroidColor.BLACK else AndroidColor.WHITE }
                }
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Surface(color = androidx.compose.ui.graphics.Color.White, shape = RowShape) {
                        Image(bitmap.asImageBitmap(), "一起听歌邀请二维码", Modifier.padding(16.dp).size(224.dp))
                    }
                }
            }
        }
    }
}
