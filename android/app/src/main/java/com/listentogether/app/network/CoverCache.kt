package com.listentogether.app.network

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File

/**
 * 封面字节缓存：coverDir/<id>-<coverVer>。
 * 命中即读文件；coverVer 变了键就变，旧文件由系统 cacheDir LRU 淘汰（不主动清理，避免与下载竞态）。
 * 服务器返回的 mime 由 [BitmapFactory] 自动嗅探，png/jpeg/webp 都可解码；服务端约定 image/jpeg | image/png | image/webp。
 */
class CoverCache(private val dir: File) {
    init { dir.mkdirs() }
    fun key(track: Track): String? = if (track.coverVer != null) "${track.id}-${track.coverVer}" else null
    fun file(key: String): File = File(dir, key)
    fun decode(bytes: ByteArray): Bitmap? = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
}
