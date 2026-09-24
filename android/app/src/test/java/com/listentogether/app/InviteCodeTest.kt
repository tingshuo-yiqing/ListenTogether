package com.listentogether.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** 邀请口令 encode/decode 往返与容错解析回归（纯 JVM，不依赖 Android）。 */
class InviteCodeTest {

    @Test
    fun encodeOmitsConventionPortFromServerLine() {
        assertEquals(
            "来一起听歌\n" +
                "房间码 A1B2C3D4\n" +
                "服务器 http://8.166.126.136\n" +
                "复制整段，打开 App 即可加入",
            InviteCode.encode("a1b2c3d4", "http://8.166.126.136:3000")
        )
    }

    @Test
    fun encodeKeepsNonDefaultPort() {
        val text = InviteCode.encode("A1B2C3D4", "http://music.example.com:8080")
        assertEquals("http://music.example.com:8080", InviteCode.decode(text)!!.server)
    }

    @Test
    fun encodeOmitsServerLineWhenAbsent() {
        val text = InviteCode.encode("A1B2C3D4", null)
        assertEquals(3, text.split('\n').size)
    }

    @Test
    fun roundTripStripsConventionPort() {
        val invite = InviteCode.decode(InviteCode.encode("A1B2C3D4", "http://8.166.126.136:3000"))!!
        assertEquals("A1B2C3D4", invite.code)
        assertEquals("http://8.166.126.136", invite.server)
    }

    @Test
    fun decodeToleratesQuotesAndChatterLines() {
        val pasted = "「来一起听歌\n房间码 9f8e7d6c\n服务器 https://music.example.com\n" +
            "复制整段，打开 App 即可加入」\n快进来一起听！"
        val invite = InviteCode.decode(pasted)!!
        assertEquals("9F8E7D6C", invite.code)
        assertEquals("https://music.example.com", invite.server)
    }

    @Test
    fun decodeAcceptsFullWidthColonAndMixedCase() {
        assertEquals("ABCDEF01", InviteCode.decode("房间码：AbCdEf01")!!.code)
    }

    @Test
    fun decodeWithoutServerKeepsNullServer() {
        val invite = InviteCode.decode("来一起听歌\n房间码 AABBCCDD\n复制整段，打开 App 即可加入")!!
        assertEquals("AABBCCDD", invite.code)
        assertNull(invite.server)
    }

    @Test
    fun decodeFailsWithoutAnchor() {
        assertNull(InviteCode.decode("随便聊聊，今天天气不错"))
        // 裸 8 位码没有锚点也不认，避免把普通文本误判成邀请。
        assertNull(InviteCode.decode("AABBCCDD"))
    }

    @Test
    fun decodeFailsWhenCodeShorterThanEight() {
        assertNull(InviteCode.decode("房间码 A1B2C3"))
    }
}
