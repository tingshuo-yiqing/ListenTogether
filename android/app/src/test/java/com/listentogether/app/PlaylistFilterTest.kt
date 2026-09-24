package com.listentogether.app

import com.listentogether.app.ui.PlaylistFilter
import org.junit.Assert.assertEquals
import org.junit.Test

/** 歌单搜索过滤回归（纯 JVM）：trim、大小写、空查询与子串匹配。 */
class PlaylistFilterTest {

    @Test
    fun emptyQueryReturnsAllIndices() {
        assertEquals(listOf(0, 1, 2), PlaylistFilter.filter(listOf("甲", "乙", "丙"), ""))
        assertEquals(listOf(0, 1), PlaylistFilter.filter(listOf("甲", "乙"), "   "))
    }

    @Test
    fun matchingIgnoresCase() {
        val titles = listOf("Love Story", "NIGHT DRIVE", "love me do")
        assertEquals(listOf(0, 2), PlaylistFilter.filter(titles, "LOVE"))
        assertEquals(listOf(1), PlaylistFilter.filter(titles, "night"))
    }

    @Test
    fun queryIsTrimmed() {
        assertEquals(listOf(1), PlaylistFilter.filter(listOf("晴天", "夜曲"), "  夜曲  "))
    }

    @Test
    fun noMatchReturnsEmptyList() {
        assertEquals(emptyList<Int>(), PlaylistFilter.filter(listOf("晴天", "夜曲"), "不存在的歌名"))
    }

    @Test
    fun substringInsideTitleMatches() {
        val titles = listOf("爱的问候", "晨间问候语", "告别")
        assertEquals(listOf(0, 1), PlaylistFilter.filter(titles, "问候"))
    }

    @Test
    fun chineseTitlesMatchDirectly() {
        val titles = listOf("晴天", "夜曲", "晴天娃娃")
        assertEquals(listOf(0, 2), PlaylistFilter.filter(titles, "晴天"))
        assertEquals(listOf(1), PlaylistFilter.filter(titles, "夜"))
    }
}
