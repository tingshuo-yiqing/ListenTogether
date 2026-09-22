package com.listentogether.app.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Google 风格色板：以 Google Blue #0B57D0 为种子的 Material 3 方案。
 * Android 12+ 优先使用系统动态取色（Monet），本文件是低版本与关闭动态取色时的固定方案。
 */
val BluePrimaryLight = Color(0xFF0B57D0)
val OnBluePrimaryLight = Color(0xFFFFFFFF)
val BlueContainerLight = Color(0xFFD3E3FD)
val OnBlueContainerLight = Color(0xFF041E49)

val SecondaryLight = Color(0xFF565E71)
val OnSecondaryLight = Color(0xFFFFFFFF)
val SecondaryContainerLight = Color(0xFFDBE2F9)
val OnSecondaryContainerLight = Color(0xFF131C2B)

val BackgroundLight = Color(0xFFF9F9FF)
val SurfaceVariantLight = Color(0xFFE1E2EC)
val OnSurfaceVariantLight = Color(0xFF44474F)
val OutlineLight = Color(0xFF74777F)

val BluePrimaryDark = Color(0xFFAAC7FF)
val OnBluePrimaryDark = Color(0xFF002E69)
val BlueContainerDark = Color(0xFF0842A0)
val OnBlueContainerDark = Color(0xFFD3E3FD)

val SecondaryDark = Color(0xFFBFC6DC)
val OnSecondaryDark = Color(0xFF293042)
val SecondaryContainerDark = Color(0xFF3E4759)
val OnSecondaryContainerDark = Color(0xFFDBE2F9)

val BackgroundDark = Color(0xFF111318)
val SurfaceVariantDark = Color(0xFF44474F)
val OnSurfaceVariantDark = Color(0xFFC4C6D0)
val OutlineDark = Color(0xFF8E9099)

/** 状态点缀色：在线/已同步绿、重连中橙，与 Google 产品状态色一致。 */
val StatusGreen = Color(0xFF1E8E3E)
val StatusAmber = Color(0xFFE8710A)
