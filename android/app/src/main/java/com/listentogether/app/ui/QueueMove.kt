package com.listentogether.app.ui

import com.listentogether.app.network.CatalogPage

/** 本地拖动预览转换为服务端锚点；目标序号对应移动后的列表，null 表示队尾。 */
internal fun queueMoveAnchor(ids: List<String>, moving: String, targetIndex: Int): String? {
    val remaining = ids.filterNot { it == moving }
    return remaining.getOrNull(targetIndex.coerceIn(0, remaining.size))
}

/** 累积分页只允许同一曲库版本；去重不改变服务端下一页 offset。 */
internal fun appendCatalogPage(current: CatalogPage, next: CatalogPage): CatalogPage {
    require(current.catalogRevision == next.catalogRevision)
    return next.copy(items = (current.items + next.items).distinctBy { it.id })
}

/** 拖动中心距列表边缘的滚动速度（像素/帧），阈值与速度均按屏幕密度传入。 */
internal fun queueEdgeScroll(center: Float, height: Float, edge: Float, maxStep: Float): Float = when {
    center < edge -> -maxStep * ((edge - center) / edge).coerceIn(0f, 1f)
    center > height - edge -> maxStep * ((center - height + edge) / edge).coerceIn(0f, 1f)
    else -> 0f
}
