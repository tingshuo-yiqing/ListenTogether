package com.listentogether.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/**
 * 形状 token：界面圆角集中在此定义，调用处按用途引用，不再散落裸数字。
 * 命名按用途而非尺寸，换圆角档位只改本文件。
 */
val BannerShape = RoundedCornerShape(14.dp)   // 状态横幅 / 表单内错误条
val RowShape = RoundedCornerShape(12.dp)      // 歌单等列表行
val FieldShape = RoundedCornerShape(14.dp)    // 输入框
val CardShape = RoundedCornerShape(24.dp)     // 正在播放等主卡片
val PillShape = RoundedCornerShape(24.dp)     // 全宽按钮（主按钮 / 退出按钮共用）
