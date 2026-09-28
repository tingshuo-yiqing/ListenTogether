package com.listentogether.app.network

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import java.io.File

/**
 * 封面双层缓存：内存 LruCache（降采样后的位图，键 = <id>-<coverVer>@<目标像素>）+ 磁盘文件
 * （原始字节，coverDir/<id>-<coverVer>）。coverVer 变了键就变，旧文件由系统 cacheDir LRU
 * 淘汰（不主动清理，避免与下载竞态）。
 *
 * 解码按 [decodeAndCache] 的 targetPx 降采样（inSampleSize 取 2 的幂）：44dp 缩略图不再解
 * 全尺寸 500×500 位图（约 1MB），解码字节量与 GC 压力降一个数量级；目标像素大于原图时
 * 保持原尺寸。内存上限取应用堆的 1/8（LruCache 惯例），足够容纳整库缩略图与展开页大图；
 * 按 Bitmap.byteCount 计费，超出自动淘汰最久未用项。
 *
 * 服务器返回的 mime 由 [BitmapFactory] 自动嗅探，png/jpeg/webp 都可解码；服务端约定
 * image/jpeg | image/png | image/webp。
 */
class CoverCache(private val dir: File) {
    private val memory = object : LruCache<String, Bitmap>((Runtime.getRuntime().maxMemory() / 8).toInt()) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }

    init { dir.mkdirs() }

    fun key(track: Track): String? = if (track.coverVer != null) "${track.id}-${track.coverVer}" else null
    fun file(key: String): File = File(dir, key)

    /** 内存命中：键含目标像素，缩略图与大图互不污染；LruCache get 代价可忽略，可主线程调用。 */
    fun cached(key: String, targetPx: Int): Bitmap? = memory.get("$key@$targetPx")

    /** 磁盘/网络字节 → 按目标像素降采样的位图，并写入内存层；解码失败返回 null（调用方回退占位）。 */
    fun decodeAndCache(key: String, targetPx: Int, bytes: ByteArray): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= targetPx && bounds.outHeight / (sample * 2) >= targetPx) sample *= 2
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        if (bitmap != null) memory.put("$key@$targetPx", bitmap)
        return bitmap
    }
}
