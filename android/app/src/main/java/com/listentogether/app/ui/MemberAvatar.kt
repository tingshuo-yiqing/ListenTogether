package com.listentogether.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** memberId 稳定散列映射到色板索引；同一成员恒定同色，索引始终落在 [0, paletteSize)。 */
internal fun avatarPaletteIndex(memberId: String, paletteSize: Int): Int {
    require(paletteSize > 0) { "色板大小必须为正" }
    var hash = 0
    for (ch in memberId) hash = hash * 31 + ch.code
    return hash.mod(paletteSize)
}

/**
 * 头像字符：昵称自带的 emoji 优先，否则取首个字素，全空回落"友"。
 * 不使用 `take(1)`——那会把 emoji 的代理对截成半个字符（渲染成方框）。
 */
internal fun memberAvatarGlyph(name: String): String {
    val (emoji, label) = splitAvatarPrefix(name)
    return emoji ?: firstGrapheme(label) ?: "友"
}

/** 成员行文字：去掉头像前缀后的显示名，避免头像 emoji 在头像与文字上重复出现。 */
internal fun memberDisplayName(name: String): String = splitAvatarPrefix(name).second.ifBlank { name.trim() }

/**
 * 圆形成员头像：昵称首个字素（emoji 则直接用 emoji，见 [splitAvatarPrefix]），
 * 背景从主题派生的 6 色固定色板取色（primary/secondary/tertiary 及各自 container，配对对应 on 色，禁止硬编码）。
 * 右下角在线状态点：在线 primary、离线 outline；描边用 surface 保证点在任意头像底色上可见。
 * 角色与在线/离线仍由旁边文字行承载，不单靠颜色传达状态。
 */
@Composable
fun MemberAvatar(memberId: String, name: String, online: Boolean, modifier: Modifier = Modifier) {
    val colorScheme = MaterialTheme.colorScheme
    // (背景, 内容) 成对派生自主题；每次重组直接读取，跟随亮暗方案切换，不做跨配置缓存。
    val palette = listOf(
        colorScheme.primary to colorScheme.onPrimary,
        colorScheme.secondary to colorScheme.onSecondary,
        colorScheme.tertiary to colorScheme.onTertiary,
        colorScheme.primaryContainer to colorScheme.onPrimaryContainer,
        colorScheme.secondaryContainer to colorScheme.onSecondaryContainer,
        colorScheme.tertiaryContainer to colorScheme.onTertiaryContainer
    )
    val (background, content) = palette[avatarPaletteIndex(memberId, palette.size)]
    Box(modifier = modifier.size(40.dp)) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .background(background, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Text(
                memberAvatarGlyph(name),
                style = MaterialTheme.typography.titleSmall,
                color = content,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .size(10.dp)
                .background(if (online) colorScheme.primary else colorScheme.outline, CircleShape)
                .border(1.5.dp, colorScheme.surface, CircleShape)
        )
    }
}
