package com.listentogether.app

import com.listentogether.app.network.Track
import com.listentogether.app.playback.mediaMetadata
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** 用真实 Media3 Builder 检查通知/媒体会话消费的值，不把 JVM 结果当作系统通知目视。 */
class TrackMetadataTest {
    @Test fun currentTrackMetadataReachesMediaSession() {
        val track = Track.parse(JSONObject("""{"id":"one","title":"歌名","durationMs":1000,"artist":"歌手","album":" 专辑 "}"""))
        val metadata = track.mediaMetadata()
        assertEquals("歌名", metadata.title)
        assertEquals("歌手", metadata.artist)
        assertEquals("专辑", metadata.albumTitle)
    }

    @Test fun changingToMissingMetadataDoesNotKeepPreviousAlbum() {
        assertEquals("首张专辑", Track("one", "第一首", 1000, album = "首张专辑").mediaMetadata().albumTitle)
        val metadata = Track("two", "第二首", 1000).mediaMetadata()
        assertEquals("第二首", metadata.title)
        assertEquals("一起听歌", metadata.artist)
        assertNull(metadata.albumTitle)
    }

    @Test fun oldAndMalformedAlbumValuesRemainCompatible() {
        for (field in listOf("", ",\"album\":null", ",\"album\":\"  \"", ",\"album\":42", ",\"album\":[]")) {
            val track = Track.parse(JSONObject("""{"id":"one","title":"歌名","durationMs":1000$field}"""))
            assertNull(track.album)
        }
    }
}
