package com.listentogether.app

import com.listentogether.app.ui.LrcLine
import com.listentogether.app.ui.indexAt
import com.listentogether.app.ui.parseLrc
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** LRC 解析与当前行定位：纯函数、无 IO，钉住与服务端下发文本的消费口径。 */
class LrcTest {

    @Test fun parsesBasicLines() {
        val lines = parseLrc("[00:17.70] 想用一杯 Latte 把妳灌醉\n[00:22.57]好讓妳能多愛我一點\n")
        assertEquals(listOf(LrcLine(17_700, "想用一杯 Latte 把妳灌醉"), LrcLine(22_570, "好讓妳能多愛我一點")), lines)
    }

    @Test fun multipleTagsShareOneLine() {
        val lines = parseLrc("[00:10.00][01:30.00]副歌重复\n")
        assertEquals(listOf(LrcLine(10_000, "副歌重复"), LrcLine(90_000, "副歌重复")), lines)
    }

    @Test fun sortsOutOfOrderInput() {
        val lines = parseLrc("[02:00.00]后\n[00:30.00]前\n")
        assertEquals(listOf(LrcLine(30_000, "前"), LrcLine(120_000, "后")), lines)
    }

    @Test fun dropsMetadataCommentsAndStamplessLines() {
        val text = "[ti:歌名]\n[ar:歌手]\n[by:制作]\n[offset:+500]\n; 注释行\n# 另一注释\n纯文本行没有标签\n[00:05.00]有效行\n[00:08.00]\n"
        val lines = parseLrc(text)
        assertEquals(listOf(LrcLine(5_000, "有效行")), lines)
    }

    @Test fun toleratesBlankAndCrlf() {
        val lines = parseLrc("[00:05.00]第一行\r\n\r\n[00:06.00]第二行\r\n")
        assertEquals(listOf(LrcLine(5_000, "第一行"), LrcLine(6_000, "第二行")), lines)
    }

    @Test fun toleratesLeadingBom() {
        val lines = parseLrc("\uFEFF[00:05.00]带 BOM 的首行\n")
        assertEquals(listOf(LrcLine(5_000, "带 BOM 的首行")), lines)
    }

    @Test fun millisecondFracFormats() {
        // [mm:ss] 整数秒、[mm:ss.xx] 两位百分秒、[mm:ss.xxx] 三位毫秒
        val lines = parseLrc("[01:02]甲\n[01:03.45]乙\n[01:04.500]丙\n")
        assertEquals(listOf(LrcLine(62_000, "甲"), LrcLine(63_450, "乙"), LrcLine(64_500, "丙")), lines)
    }

    @Test fun enhancedWordTagsTreatedAsPlain() {
        // 增强型 LRC 字级时间戳不支持：'<...>' 按普通文本保留
        val lines = parseLrc("[00:01.00]<00:01.00>逐<00:01.50>字\n")
        assertEquals(listOf(LrcLine(1_000, "<00:01.00>逐<00:01.50>字")), lines)
    }

    @Test fun garbageInputYieldsNothing() {
        assertTrue(parseLrc("").isEmpty())
        assertTrue(parseLrc("[00:61.00]秒数越界\n[ab:cd]字母标签\n[00:05.0").isEmpty())
    }

    @Test fun cursorFindsLastLineAtOrBeforePosition() {
        val lines = listOf(LrcLine(10_000, "甲"), LrcLine(20_000, "乙"), LrcLine(30_000, "丙"))
        assertEquals(-1, indexAt(lines, 9_999))
        assertEquals(0, indexAt(lines, 10_000))
        assertEquals(0, indexAt(lines, 19_999))
        assertEquals(1, indexAt(lines, 20_000))
        assertEquals(2, indexAt(lines, 120_000))
    }

    @Test fun cursorOnEmptyTableIsMinusOne() {
        assertEquals(-1, indexAt(emptyList(), 0))
    }
}
