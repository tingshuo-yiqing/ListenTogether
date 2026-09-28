package com.listentogether.app.ui

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.graphics.scale
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * 从相册/文件里的二维码图片解析邀请（相机实时扫之外的第二种入口）。
 *
 * 为什么不用 zxing-android-embedded 的扫描 Activity：它只做相机取景框，没有"扫本地图片"能力。
 * 这里用 ZXing core 直接解码（该库是 zxing-android-embedded 的传递依赖，本项目已在生成侧使用）。
 *
 * 两条约定：
 * - 只认 QR，失败一律返回 null（无码 / 码不完整 / 图太小 / 打不开），由调用方给统一提示。
 * - 解码是 CPU 密集操作，必须在后台线程调用。
 */
object LocalQrDecoder {

    /** 参与解码的长边上限：手机截图/原图动辄 4000px，直接二值化既慢又费内存。 */
    private const val MAX_EDGE = 1600

    /** 解码尝试的缩放档位：先按限幅后的尺寸，再逐步缩小以容忍噪声。 */
    private val TRY_SCALES = listOf(1.0f, 0.5f, 0.25f)

    /**
     * 从内容 URI 读图并解析 QR 文本；失败返回 null。
     *
     * 两段式读取：先只读尺寸（inJustDecodeBounds）算出 inSampleSize，再按采样率真正解码——
     * 避免把整张原图读进内存（一张 4000×3000 的 ARGB_8888 就是 48MB，很容易 OOM）。
     */
    fun decodeUri(resolver: ContentResolver, uri: Uri): String? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        runCatching { resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) } }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSizeFor(bounds.outWidth, bounds.outHeight)
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val bitmap = runCatching {
            resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
        }.getOrNull() ?: return null
        return try {
            decode(bitmap)
        } finally {
            bitmap.recycle()
        }
    }

    /** 解析已解码的位图；不改动传入对象（需要缩放时另建副本并在内部回收）。 */
    fun decode(bitmap: Bitmap): String? {
        if (bitmap.isRecycled || bitmap.width <= 0 || bitmap.height <= 0) return null
        val base = capToMaxEdge(bitmap) ?: return null
        try {
            for (dims in scaleLadder(base.width, base.height)) {
                val candidate = if (dims == null) base else resize(base, dims.first, dims.second) ?: continue
                try {
                    readQr(candidate)?.let { return it }
                } finally {
                    if (candidate !== base) candidate.recycle()
                }
            }
            return null
        } finally {
            if (base !== bitmap) base.recycle()
        }
    }

    /** inSampleSize 取 2 的幂，且保证采样后长边不小于 MAX_EDGE（别把码采没了）。 */
    internal fun sampleSizeFor(width: Int, height: Int): Int {
        var sample = 1
        while (max(width, height) / (sample * 2) >= MAX_EDGE) sample *= 2
        return sample
    }

    /**
     * 解码尝试序列：null 表示"就用当前尺寸"，其余为缩放后的目标尺寸。
     * 抽成纯函数是为了能单测——它决定了"会不会把二维码缩到解不出来"。
     */
    internal fun scaleLadder(width: Int, height: Int): List<Pair<Int, Int>?> =
        TRY_SCALES.map { factor ->
            if (factor == 1.0f) null
            else (width * factor).roundToInt() to (height * factor).roundToInt()
        }.filter { dims -> dims == null || (dims.first >= 16 && dims.second >= 16) }

    private fun capToMaxEdge(source: Bitmap): Bitmap? {
        val longest = max(source.width, source.height)
        if (longest <= MAX_EDGE) return source
        val ratio = MAX_EDGE.toFloat() / longest
        return resize(source, (source.width * ratio).roundToInt(), (source.height * ratio).roundToInt())
    }

    private fun resize(source: Bitmap, w: Int, h: Int): Bitmap? =
        runCatching { source.scale(w.coerceAtLeast(1), h.coerceAtLeast(1), filter = true) }.getOrNull()

    /** 单次 ZXing 解码：像素 → 亮度源 → 混合二值化 → 只认 QR。 */
    private fun readQr(bitmap: Bitmap): String? {
        val w = bitmap.width
        val h = bitmap.height
        val pixels = IntArray(w * h)
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h)
        // RGBLuminanceSource 只取 RGB：先把 alpha 抹平，避免透明像素把灰度算歪。
        for (i in pixels.indices) pixels[i] = pixels[i] or 0xFF000000.toInt()
        val source = RGBLuminanceSource(w, h, pixels)
        val reader = MultiFormatReader().apply {
            setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE)))
        }
        return try {
            // 图中没有二维码时 decodeWithState 抛 NotFoundException，属正常控制流。
            reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))).text
        } catch (_: Exception) {
            null
        } finally {
            reader.reset()
        }
    }
}
