package com.listentogether.app.ui

/** 歌单搜索的纯过滤逻辑：只影响本地显示，不触碰播放与服务器状态。 */
internal object PlaylistFilter {

    /**
     * 按查询串过滤曲名，返回命中的原列表索引（保持原顺序），调用方据此对齐当前播放高亮。
     * 规则：查询串首尾 trim；空查询返回全部索引；大小写不敏感；子串包含匹配（中文直接匹配）。
     */
    fun filter(titles: List<String>, query: String): List<Int> {
        val keyword = query.trim().lowercase()
        if (keyword.isEmpty()) return titles.indices.toList()
        return titles.indices.filter { keyword in titles[it].lowercase() }
    }
}
