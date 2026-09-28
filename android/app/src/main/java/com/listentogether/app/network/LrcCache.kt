package com.listentogether.app.network

import java.io.File

/**
 * 歌词文本缓存：lyricsDir/<id>-<lyricsVer>.lrc（服务端约定 UTF-8 文本，≤256KB）。
 * 键 = 曲目 id + lyricsVer（服务端按歌词内容+mtime 下发，换词必变）：歌词被替换后旧文件
 * 自然失配、重新下载，无需手动清缓存。旧版本文件由系统 cacheDir LRU 淘汰，不主动清理，
 * 避免与下载竞态。
 */
class LrcCache(private val dir: File) {
    init { dir.mkdirs() }
    fun file(id: String, lyricsVer: Long?): File =
        if (lyricsVer == null) File(dir, "$id.lrc") else File(dir, "$id-$lyricsVer.lrc")
}
