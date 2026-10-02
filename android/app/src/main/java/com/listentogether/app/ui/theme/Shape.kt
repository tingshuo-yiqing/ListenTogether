package com.listentogether.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/** 圆角按组件用途集中定义，页面保持统一层级与 4/8dp 间距。 */
val SmallShape = RoundedCornerShape(8.dp)
val BannerShape = RoundedCornerShape(14.dp)
val RowShape = RoundedCornerShape(12.dp)
val FieldShape = RoundedCornerShape(16.dp)
val CardShape = RoundedCornerShape(24.dp)
val ButtonShape = RoundedCornerShape(14.dp)
val PlayerShape = RoundedCornerShape(18.dp)
val SheetShape = RoundedCornerShape(28.dp)

/** 沿用旧调用名；全宽按钮也使用本轮确认的 14dp 圆角。 */
val PillShape = ButtonShape