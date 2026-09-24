package com.listentogether.app.sync

import com.listentogether.app.network.Track

/**
 * 房间歌单切歌顺序（纯函数，无时钟域、无网络，可直接 JVM 单测）。
 * 顺序即服务端曲库顺序；到头环形回绕（下一首在末尾回第一首，上一首在开头回最后一首）。
 */
object TrackQueue {

    /**
     * 取相对当前曲目偏移 direction 首（+1 下一首、-1 上一首）的曲目 id。
     * 当前曲目不在歌单（含 null，尚未选曲）时：下一首取第一首、上一首取最后一首；
     * 歌单为空返回 null；单首歌单两种方向都返回它自己（重新选曲即从头播放）。
     */
    fun skip(tracks: List<Track>, currentId: String?, direction: Int): String? {
        if (tracks.isEmpty()) return null
        val index = tracks.indexOfFirst { it.id == currentId }
        if (index < 0) return if (direction >= 0) tracks.first().id else tracks.last().id
        // Math.floorMod 对负取模同样回绕到正区间（Kotlin 的 % 对负数保留负号，不能直接用于上一首）。
        return tracks[Math.floorMod(index + direction, tracks.size)].id
    }
}
