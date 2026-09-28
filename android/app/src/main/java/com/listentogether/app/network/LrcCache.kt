package com.listentogether.app.network

import java.io.File

/**
 * 歌词文本缓存：lyricsDir/<id>.lrc（服务端约定 UTF-8 文本，≤256KB）。
 * 键只有曲目 id：歌词被替换后本机不感知（文本 <10KB，重新下载代价可忽略，后续如需要可仿
 * coverVer 下发 lyricsVer）。旧文件由系统 cacheDir LRU 淘汰，不主动清理，避免与下载竞态。
 */
class LrcCache(private val dir: File) {
    init { dir.mkdirs() }
    fun file(id: String): File = File(dir, "$id.lrc")
}
