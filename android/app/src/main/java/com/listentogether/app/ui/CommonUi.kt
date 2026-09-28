package com.listentogether.app.ui

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ExitToApp
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.graphics.createBitmap
import androidx.core.graphics.set
import com.listentogether.app.InviteCode
import com.listentogether.app.network.UiState
import com.listentogether.app.ui.theme.PillShape

/**
 * 顶栏：始终显示应用名。房间页提供「展示邀请二维码 / 分享口令 / 退出」，首页「加入房间」分支
 * 提供「扫二维码」——两处刻意复用右上角第一个位置：入房前是"我去扫别人的码"，入房后是"让别人扫我的码"，
 * 同一位置承载同一件事的两面，不给顶栏堆图标。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TopBar(
    ui: UiState,
    baseUrl: String,
    onShowQr: () -> Unit,
    onLeaveRequest: () -> Unit,
    onScanInvite: (() -> Unit)? = null
) {
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
                IconButton(onClick = onShowQr) {
                    Icon(Icons.Outlined.QrCode2, contentDescription = "显示邀请二维码", tint = MaterialTheme.colorScheme.primary)
                }
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
            } else if (onScanInvite != null) {
                IconButton(onClick = onScanInvite) {
                    Icon(Icons.Outlined.QrCodeScanner, contentDescription = "扫描邀请二维码", tint = MaterialTheme.colorScheme.primary)
                }
            }
        }
    )
}

/** 扫码来源选择：相机实时扫需要权限且要对准屏幕，相册选图适合好友发来的截图/存图。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ScanSourceSheet(onDismiss: () -> Unit, onCamera: () -> Unit, onGallery: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState()) {
        Column(
            Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text("扫描邀请二维码", style = MaterialTheme.typography.titleMedium)
            Text(
                "用相机扫，或从相册选一张已有二维码的图片。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            FilledTonalButton(
                onClick = onCamera, shape = PillShape,
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
            ) {
                // 这两个图标只有 Filled 系列（icons-extended 未提供 Outlined 变体），
                // 与 QrCodeScanner/QrCode2 的 Outlined 混用是刻意的：不为了统一风格去自绘图标。
                Icon(Icons.Filled.PhotoCamera, contentDescription = null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text("用相机扫描")
            }
            FilledTonalButton(
                onClick = onGallery, shape = PillShape,
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
            ) {
                Icon(Icons.Filled.PhotoLibrary, contentDescription = null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text("从相册选择图片")
            }
        }
    }
}

/** 邀请二维码使用同一份不含令牌的口令，好友扫码后仍由用户确认并手动点击加入。 */
@Composable
internal fun InviteQrDialog(inviteText: String, onDismiss: () -> Unit) {
    val bitmap = remember(inviteText) {
        val size = 512
        val matrix = encodeInviteQr(inviteText, size)
        createBitmap(size, size, Bitmap.Config.RGB_565).apply {
            for (y in 0 until size) for (x in 0 until size) set(x, y, if (matrix[x, y]) AndroidColor.BLACK else AndroidColor.WHITE)
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        // 标题比 AlertDialog 默认（headlineSmall）收一档：弹窗主体是二维码，标题不该抢视觉重量。
        title = { Text("邀请好友一起听", style = MaterialTheme.typography.titleMedium) },
        text = {
            // 对话框文字区默认已带内边距，横向再留一点即可：既保证二维码不贴边、好扫，
            // 又不会把「完成」按钮顶出屏幕。二维码是这张弹窗的内容主体，不额外封顶宽度。
            Image(
                bitmap.asImageBitmap(),
                contentDescription = "一起听歌房间邀请二维码",
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)
            )
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("完成") } }
    )
}
