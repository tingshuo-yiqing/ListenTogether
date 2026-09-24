package com.listentogether.app

import com.listentogether.app.ui.avatarPaletteIndex
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 成员头像色板取色回归（纯 JVM）：同 id 恒定、索引在界内、不同 id 有分布。 */
class AvatarPaletteIndexTest {

    @Test
    fun sameMemberIdAlwaysGetsSameIndex() {
        assertEquals(avatarPaletteIndex("member-42", 6), avatarPaletteIndex("member-42", 6))
        assertEquals(avatarPaletteIndex("", 6), avatarPaletteIndex("", 6))
    }

    @Test
    fun indexAlwaysStaysWithinPalette() {
        for (size in 1..6) {
            for (id in listOf("", "a", "host", "成员甲", "very-long-member-id-0000", "z9x8c7v6")) {
                val index = avatarPaletteIndex(id, size)
                assertTrue("索引应落在 [0,$size)：id=$id index=$index", index in 0 until size)
            }
        }
    }

    @Test
    fun differentIdsAreAllowedToSpreadAcrossPalette() {
        val indices = (0 until 32).map { avatarPaletteIndex("member-$it", 6) }.toSet()
        assertTrue("32 个不同 id 应覆盖多种颜色（实际 ${indices.size} 种）", indices.size > 1)
    }
}
