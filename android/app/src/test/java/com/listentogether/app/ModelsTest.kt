package com.listentogether.app

import com.listentogether.app.network.Track
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 解析 catalog 新字段：artist/hasCover/coverVer/hasLyrics，未知值为 null/默认。
 * 必须随服务端 catalog 下发同步修订；服务端不在 schema 校验内，客户端是值的最终消费方。
 */
class ModelsTest {

    @Test fun parsesKnownFields() {
        val track = Track.parse(JSONObject("""{"id":"a","title":"歌名","durationMs":1234,"artist":"歌手","hasCover":true,"coverVer":987,"hasLyrics":true}"""))
        assertEquals("a", track.id); assertEquals("歌名", track.title); assertEquals(1234L, track.durationMs)
        assertEquals("歌手", track.artist); assertTrue(track.hasCover); assertEquals(987L, track.coverVer)
        assertTrue(track.hasLyrics)
    }

    @Test fun nullFieldsMeanAbsent() {
        val track = Track.parse(JSONObject("""{"id":"a","title":"歌名","durationMs":1234,"artist":null,"hasCover":false,"coverVer":null,"hasLyrics":false}"""))
        assertNull(track.artist); assertFalse(track.hasCover); assertNull(track.coverVer); assertFalse(track.hasLyrics)
    }

    @Test fun missingNewFieldsFallBack() {
        // 旧服务端只发已知三字段：artist/hasCover/coverVer/hasLyrics 缺省视为 null/false。
        val track = Track.parse(JSONObject("""{"id":"a","title":"歌名","durationMs":1234}"""))
        assertNull(track.artist); assertFalse(track.hasCover); assertNull(track.coverVer); assertFalse(track.hasLyrics)
    }

    @Test fun emptyArtistIsTreatedAsNull() {
        // 协议要求未知值为 null；空串也是"无歌手"，避免 UI 出现空副行。
        val track = Track.parse(JSONObject("""{"id":"a","title":"歌名","durationMs":1234,"artist":"","hasCover":false,"coverVer":null}"""))
        assertNull(track.artist)
    }
}