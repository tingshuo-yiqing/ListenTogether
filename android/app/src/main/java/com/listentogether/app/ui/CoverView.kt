package com.listentogether.app.ui

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.produceState
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalDensity
import com.listentogether.app.network.RoomClient
import com.listentogether.app.network.Track
import kotlinx.coroutines.flow.first

/**
 * 封面加载（异步）：封面 ID、coverVer 或目标尺寸变化即重新拉取；
 * 无封面 / 拉取失败统一返回 null，UI 静默回退为静态音符占位。
 * 内存缓存命中同步返回，未命中走磁盘/网络并按 [size] 对应像素降采样解码。
 *
 * 服务端支持 catalog 独立封面，并在没有独立封面时回退到 MP3 内嵌封面；无封面或
 * 拉取失败仍返回 null，三层回退保持不变。coverVer 变化会让本地缓存键自然失效。
 */
@Composable
fun rememberCoverBitmap(client: RoomClient, track: Track?, size: Dp): Bitmap? {
    if (track == null || !track.hasCover || track.coverVer == null) return null
    val targetPx = with(LocalDensity.current) { size.roundToPx() }
    // produceState 换键只重启请求，不会重置旧 value；key 重建避免换曲时短暂露出上一首封面。
    return key(client, track.id, track.coverVer, targetPx) {
        val state = produceState<Bitmap?>(null, track.id, track.coverVer, targetPx) {
            client.state.first { it.credentials != null }
            value = client.fetchCover(track, targetPx)
        }
        state.value
    }
}

/** 无封面时使用主题静态圆角块与音符，不引入原型示意封面。 */
@Composable
fun CoverPlaceholder(size: Dp, corner: Dp = 6.dp) {
    val shape = RoundedCornerShape(corner)
    Box(
        modifier = Modifier.size(size).clip(shape)
            .background(MaterialTheme.colorScheme.surfaceContainerHighest),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = Icons.Outlined.MusicNote,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            modifier = Modifier.size(size * 0.45f)
        )
    }
}
