package com.listentogether.app.ui.theme

import android.os.Build
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val LightScheme = lightColorScheme(
    primary = PineLight,
    onPrimary = OnPineLight,
    primaryContainer = PineContainerLight,
    onPrimaryContainer = InkLight,
    secondary = MutedLight,
    onSecondary = OnPineLight,
    secondaryContainer = SurfaceSoftLight,
    onSecondaryContainer = InkLight,
    tertiary = AccentLight,
    onTertiary = OnPineLight,
    tertiaryContainer = AccentContainerLight,
    onTertiaryContainer = InkLight,
    background = PaperLight,
    onBackground = InkLight,
    surface = SurfaceLight,
    onSurface = InkLight,
    surfaceVariant = SurfaceSoftLight,
    onSurfaceVariant = MutedLight,
    surfaceTint = PineLight,
    surfaceDim = SurfaceSoftLight,
    surfaceBright = SurfaceRaisedLight,
    surfaceContainerLowest = SurfaceRaisedLight,
    surfaceContainerLow = SurfaceLight,
    surfaceContainer = SurfaceSoftLight,
    surfaceContainerHigh = SurfaceSoftLight,
    surfaceContainerHighest = PineContainerLight,
    inverseSurface = InkLight,
    inverseOnSurface = SurfaceLight,
    inversePrimary = PineDark,
    outline = OutlineLight,
    outlineVariant = OutlineVariantLight,
    error = ErrorLight,
    onError = OnPineLight,
    errorContainer = ErrorContainerLight,
    onErrorContainer = ErrorLight
)

private val DarkScheme = darkColorScheme(
    primary = PineDark,
    onPrimary = OnPineDark,
    primaryContainer = PineContainerDark,
    onPrimaryContainer = InkDark,
    secondary = MutedDark,
    onSecondary = OnPineDark,
    secondaryContainer = SurfaceSoftDark,
    onSecondaryContainer = InkDark,
    tertiary = AccentDark,
    onTertiary = OnAccentDark,
    tertiaryContainer = AccentContainerDark,
    onTertiaryContainer = InkDark,
    background = PaperDark,
    onBackground = InkDark,
    surface = SurfaceDark,
    onSurface = InkDark,
    surfaceVariant = SurfaceSoftDark,
    onSurfaceVariant = MutedDark,
    surfaceTint = PineDark,
    surfaceDim = PaperDark,
    surfaceBright = SurfaceRaisedDark,
    surfaceContainerLowest = PaperDark,
    surfaceContainerLow = SurfaceDark,
    surfaceContainer = SurfaceSoftDark,
    surfaceContainerHigh = SurfaceRaisedDark,
    surfaceContainerHighest = SurfaceSoftDark,
    inverseSurface = InkDark,
    inverseOnSurface = PaperDark,
    inversePrimary = PineLight,
    outline = OutlineDark,
    outlineVariant = OutlineVariantDark,
    error = ErrorDark,
    onError = ErrorContainerDark,
    errorContainer = ErrorContainerDark,
    onErrorContainer = ErrorDark
)

/** 系统中西文字体与 sp 字阶；正文、歌手和辅助数字分层，字号仍尊重系统设置。 */
private fun appText(size: Int, lineHeight: Int, weight: FontWeight = FontWeight.Normal) = TextStyle(
    fontFamily = FontFamily.Default,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = lineHeight.sp,
    letterSpacing = 0.sp
)

val AppTypography = Typography(
    headlineLarge = appText(32, 42, FontWeight.SemiBold),
    headlineMedium = appText(30, 40, FontWeight.SemiBold),
    headlineSmall = appText(26, 36, FontWeight.SemiBold),
    titleLarge = appText(20, 28, FontWeight.SemiBold),
    titleMedium = appText(16, 24, FontWeight.SemiBold),
    titleSmall = appText(16, 24, FontWeight.Medium),
    bodyLarge = appText(16, 24),
    bodyMedium = appText(16, 24),
    bodySmall = appText(14, 20),
    labelLarge = appText(16, 24, FontWeight.Medium),
    labelMedium = appText(14, 20, FontWeight.Medium),
    labelSmall = appText(12, 18, FontWeight.Medium)
)

private val AppShapes = Shapes(
    extraSmall = SmallShape,
    small = RowShape,
    medium = FieldShape,
    large = CardShape,
    extraLarge = SheetShape
)

/**
 * 默认浅色，组合根读取用户保存的浅/深选择；暖色方案不随壁纸取色改变。
 * 主题变化只影响界面颜色，不改变房间会话或播放。
 */
@Composable
fun ListenTogetherTheme(
    darkTheme: Boolean = false,
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    val context = LocalContext.current
    val scheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        darkTheme -> DarkScheme
        else -> LightScheme
    }
    MaterialTheme(colorScheme = scheme, typography = AppTypography, shapes = AppShapes, content = content)
}
