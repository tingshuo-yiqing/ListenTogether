package com.listentogether.app

import com.listentogether.app.ui.LocalQrDecoder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 相册扫码的采样/缩放决策（纯函数，无 Android 依赖）。
 *
 * 这两条决策直接决定"好友发来的二维码截图能不能扫出来"：
 * - 采样过大 → 二维码被采没；采样不足 → 整图进内存可能 OOM。
 * - 缩放档位必须保留"原尺寸"这一档，且不能缩到小于 16px。
 *
 * 真实的 ZXing 解码路径（Bitmap → 像素 → 二值化 → 文本）依赖 Android 图形栈，
 * 由真机验收覆盖，不在 JVM 单测内假装覆盖。
 */
class LocalQrDecoderTest {

    @Test
    fun smallImageIsNotDownsampled() {
        // 长边不足阈值：原样解码，inSampleSize = 1
        assertEquals(1, LocalQrDecoder.sampleSizeFor(1600, 1200))
        assertEquals(1, LocalQrDecoder.sampleSizeFor(800, 600))
        assertEquals(1, LocalQrDecoder.sampleSizeFor(1, 1))
    }

    @Test
    fun largeImageIsSampledToAtLeastMaxEdge() {
        // 4000×3000 → 采样 2 后长边 2000（≥1600），不会把码采没
        val sample = LocalQrDecoder.sampleSizeFor(4000, 3000)
        assertEquals(2, sample)
        assertTrue(4000 / sample >= 1600)

        // 8000×6000 → 采样 4 后长边 2000
        val big = LocalQrDecoder.sampleSizeFor(8000, 6000)
        assertEquals(4, big)
        assertTrue(8000 / big >= 1600)
    }

    @Test
    fun sampleSizeIsAlwaysPowerOfTwo() {
        // inSampleSize 非 2 的幂时 BitmapFactory 会向下取整到 2 的幂，等于白算；这里必须自洽
        for (w in listOf(1601, 2400, 3200, 5000, 12345)) {
            val s = LocalQrDecoder.sampleSizeFor(w, w / 2)
            assertTrue("sample=$s 不是 2 的幂（w=$w）", s > 0 && (s and (s - 1)) == 0)
            assertTrue("采样后长边 $w/$s 小于 1600", w / s >= 1600 || s == 1)
        }
    }

    @Test
    fun ladderKeepsOriginalSizeFirst() {
        // 第一档必须是"原尺寸"，否则大码在小图上反而可能解不出
        val ladder = LocalQrDecoder.scaleLadder(1000, 800)
        assertEquals(null, ladder.first())
        assertEquals(3, ladder.size)
        assertEquals(500 to 400, ladder[1])
        assertEquals(250 to 200, ladder[2])
    }

    @Test
    fun ladderDropsTooSmallSteps() {
        // 100×80 在 0.25 档只剩 25×20，仍 ≥16 保留；再小就该被丢掉而不是产出 1px 图
        assertEquals(3, LocalQrDecoder.scaleLadder(100, 80).size)
        // 40×40 的 0.25 档 = 10×10 < 16 → 丢弃，只剩原尺寸与 0.5 档
        val tiny = LocalQrDecoder.scaleLadder(40, 40)
        assertEquals(2, tiny.size)
        assertEquals(null, tiny.first())
        assertEquals(20 to 20, tiny[1])
    }
}
