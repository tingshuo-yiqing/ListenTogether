package com.listentogether.app

import com.listentogether.app.network.LrcCache
import com.listentogether.app.network.Track
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 解析 catalog 新字段：artist/hasCover/coverVer/hasLyrics/lyricsVer，未知值为 null/默认。
 * 必须随服务端 catalog 下发同步修订；服务端不在 schema 校验内，客户端是值的最终消费方。
 */
class ModelsTest {

    @Test fun parsesKnownFields() {
        val track = Track.parse(JSONObject("""{"id":"a","title":"歌名","durationMs":1234,"artist":"歌手","hasCover":true,"coverVer":987,"hasLyrics":true,"lyricsVer":5566}"""))
        assertEquals("a", track.id); assertEquals("歌名", track.title); assertEquals(1234L, track.durationMs)
        assertEquals("歌手", track.artist); assertTrue(track.hasCover); assertEquals(987L, track.coverVer)
        assertTrue(track.hasLyrics); assertEquals(5566L, track.lyricsVer)
    }

    @Test fun nullFieldsMeanAbsent() {
        val track = Track.parse(JSONObject("""{"id":"a","title":"歌名","durationMs":1234,"artist":null,"hasCover":false,"coverVer":null,"hasLyrics":false,"lyricsVer":null}"""))
        assertNull(track.artist); assertFalse(track.hasCover); assertNull(track.coverVer); assertFalse(track.hasLyrics)
        assertNull(track.lyricsVer)
    }

    @Test fun missingNewFieldsFallBack() {
        // 旧服务端只发已知三字段：artist/hasCover/coverVer/hasLyrics/lyricsVer 缺省视为 null/false。
        val track = Track.parse(JSONObject("""{"id":"a","title":"歌名","durationMs":1234}"""))
        assertNull(track.artist); assertFalse(track.hasCover); assertNull(track.coverVer); assertFalse(track.hasLyrics)
        assertNull(track.lyricsVer)
    }

    @Test fun emptyArtistIsTreatedAsNull() {
        // 协议要求未知值为 null；空串也是"无歌手"，避免 UI 出现空副行。
        val track = Track.parse(JSONObject("""{"id":"a","title":"歌名","durationMs":1234,"artist":"","hasCover":false,"coverVer":null}"""))
        assertNull(track.artist)
    }

    @Test fun lrcCacheKeyIncludesLyricsVer() {
        // 缓存键 = id + lyricsVer：换词（版本变化）后旧文件名不再命中，触发重新下载；
        // 旧服务端无 lyricsVer 时退回纯 id 键，行为与历史版本一致。
        val dir = File(System.getProperty("java.io.tmpdir"), "listen-lrccache-test-" + System.nanoTime())
        try {
            val cache = LrcCache(dir)
            assertEquals("a-5566.lrc", cache.file("a", 5566L).name)
            assertEquals("a.lrc", cache.file("a", null).name)
        } finally { dir.deleteRecursively() }
    }
}
