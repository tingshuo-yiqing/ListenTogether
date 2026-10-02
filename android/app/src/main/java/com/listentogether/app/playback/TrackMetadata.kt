package com.listentogether.app.playback

import androidx.media3.common.MediaMetadata
import com.listentogether.app.network.Track

/** 媒体会话使用服务端当前曲元数据；每次换曲重建，缺专辑时清空，避免沿用上一首。 */
internal fun Track.mediaMetadata(): MediaMetadata = MediaMetadata.Builder()
    .setTitle(title)
    .setArtist(artist ?: "一起听歌")
    .setAlbumTitle(album)
    .build()
