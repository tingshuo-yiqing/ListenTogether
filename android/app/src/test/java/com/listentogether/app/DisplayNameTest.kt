package com.listentogether.app

import com.listentogether.app.ui.composeNickname
import com.listentogether.app.ui.firstGrapheme
import com.listentogether.app.ui.isEmojiGrapheme
import com.listentogether.app.ui.memberAvatarGlyph
import com.listentogether.app.ui.memberDisplayName
import com.listentogether.app.ui.splitAvatarPrefix
import com.listentogether.app.ui.takeCodePoints
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 昵称/头像字素回归（纯 JVM）：昵称是协议里唯一能承载"形象"的字段，
 * 全部按码点与字素簇处理——`take(1)` 会把 emoji 的代理对截成半个字符渲染成方框。
 */
class DisplayNameTest {

    @Test
    fun firstGraphemeHandlesPlainText() {
        assertEquals("小", firstGrapheme("小王"))
        assertEquals("a", firstGrapheme("abc"))
        assertNull(firstGrapheme(""))
        assertNull(firstGrapheme("   "))
    }

    @Test
    fun firstGraphemeKeepsEmojiCodePointIntact() {
        val nickname = "🐱 小王"
        // 反例留在测试里：按 UTF-16 码元取首字符只会拿到代理对的一半。
        assertEquals(1, nickname.take(1).length)
        assertEquals("🐱", firstGrapheme(nickname))
        assertEquals(2, firstGrapheme(nickname)!!.length)
    }

    @Test
    fun firstGraphemeKeepsEmojiSequencesTogether() {
        assertEquals("👨‍👩‍👧", firstGrapheme("👨‍👩‍👧 一家人"))
        assertEquals("🇨🇳", firstGrapheme("🇨🇳 中国"))
        assertEquals("👍🏽", firstGrapheme("👍🏽 好"))
    }

    @Test
    fun isEmojiGraphemeDistinguishesTextFromEmoji() {
        assertTrue(isEmojiGrapheme("🐱"))
        assertTrue(isEmojiGrapheme("🎧"))
        assertTrue(isEmojiGrapheme("⭐"))
        assertTrue(!isEmojiGrapheme("小"))
        assertTrue(!isEmojiGrapheme("A"))
        assertTrue(!isEmojiGrapheme(""))
    }

    @Test
    fun splitAvatarPrefixSeparatesAvatarFromName() {
        assertEquals("🐱" to "小王", splitAvatarPrefix("🐱 小王"))
        assertEquals(null to "小王", splitAvatarPrefix("小王"))
        assertEquals(null to "小王", splitAvatarPrefix("  小王  "))
        // 昵称只有一个 emoji 时，显示名回退到它本身，成员行不能变空。
        assertEquals("🐱" to "🐱", splitAvatarPrefix("🐱"))
        assertEquals(null to "", splitAvatarPrefix(""))
    }

    @Test
    fun composeNicknameWithoutAvatarTrimsAndClampsToServerLimit() {
        assertEquals("小王", composeNickname(null, "  小王  "))
        assertEquals("", composeNickname("", ""))
        assertEquals(24, composeNickname(null, "字".repeat(30)).length)
    }

    @Test
    fun composeNicknamePrefixesAvatarWithinServerLimit() {
        val composed = composeNickname("🐱", "小王")
        assertEquals("🐱 小王", composed)
        // 服务端按 24 个码元校验昵称，头像前缀必须计入长度，否则入房直接 400。
        val long = composeNickname("🐱", "字".repeat(24))
        assertEquals(24, long.length)
        assertTrue(long.startsWith("🐱 "))
        assertEquals(21, long.removePrefix("🐱 ").length)
    }

    @Test
    fun composeNicknamePrefersUserTypedEmojiAndAvoidsDoublePrefix() {
        assertEquals("🐶 阿黄", composeNickname("🐱", "🐶 阿黄"))
        assertEquals("🐱", composeNickname("🐱", "🐱"))
        // 选择器里存的不是 emoji（异常数据）时按没有头像处理，不把杂字符塞进昵称。
        assertEquals("小王", composeNickname("x", "小王"))
    }

    @Test
    fun truncationNeverSplitsSurrogatePairs() {
        assertEquals("🐱", takeCodePoints("🐱", 2))
        // 只剩 1 个码元的位置放不下 2 码元的 emoji：宁可少一个字，也不切出半个代理。
        assertEquals("", takeCodePoints("🐱", 1))
        assertEquals("a", takeCodePoints("a🐱", 1))
        assertEquals("a🐱", takeCodePoints("a🐱", 3))
        assertEquals("", takeCodePoints("abc", 0))
        assertEquals("字".repeat(24), takeCodePoints("字".repeat(30), 24))
    }

    @Test
    fun composeNicknameStopsBeforeAnEmojiThatWouldNotFit() {
        // 20 个汉字 + emoji：有头像时留给昵称 21 个码元，emoji 需要 2 个 → 只能停在 emoji 之前。
        val name = "字".repeat(20) + "🐱" + "字".repeat(5)
        val composed = composeNickname("🎧", name)
        assertEquals("🎧 " + "字".repeat(20), composed)
        assertTrue(composed.length <= 24)
        assertTrue("末尾不能是孤立的高位代理", !composed.last().isHighSurrogate())
    }
}

/** 成员头像与显示名的字素兼容回归。 */
class AvatarGlyphTest {

    @Test
    fun memberAvatarGlyphPrefersEmojiThenFirstCharacter() {
        assertEquals("🐱", memberAvatarGlyph("🐱 小王"))
        assertEquals("小", memberAvatarGlyph("小王"))
        assertEquals("A", memberAvatarGlyph("Amy"))
        assertEquals("友", memberAvatarGlyph(""))
        assertEquals("友", memberAvatarGlyph("   "))
    }

    @Test
    fun memberDisplayNameStripsAvatarPrefix() {
        assertEquals("小王", memberDisplayName("🐱 小王"))
        assertEquals("小王", memberDisplayName("小王"))
        assertEquals("🐱", memberDisplayName("🐱"))
    }

}
