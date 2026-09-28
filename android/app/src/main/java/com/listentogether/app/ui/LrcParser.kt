package com.listentogether.app.ui

/**
 * LRC 单行：timeMs 为该行起始时间（毫秒），text 为去首尾空白的文本。
 * 增强型 LRC 的字级时间戳 `<hh:mm:ss.xx>` 不支持，按普通文本保留。
 */
data class LrcLine(val timeMs: Long, val text: String)

/**
 * LRC 解析纯函数（不做 IO，可单测）：
 * - 一个行首可带多个 `[mm:ss.xx]` 标签，各自产出一条同文本的行，整体按时间升序返回；
 * - 元数据标签（[ar:]、[ti:]、[by:]、[offset:] 等带字母前缀）与无时间戳行丢弃；
 * - `;` / `#` 注释行、空行、正文为空的纯时间戳行（间奏标记）丢弃；首行 UTF-8 BOM 容忍；
 * - 同毫秒多行保留稳定顺序（sortedBy 稳定排序，服务端重复时间戳不丢内容）。
 */
fun parseLrc(text: String): List<LrcLine> {
    val out = ArrayList<LrcLine>()
    val stripped = if (text.isNotEmpty() && text[0] == '\uFEFF') text.substring(1) else text
    for (raw in stripped.split('\n')) {
        val line = raw.trimEnd('\r')
        if (line.isBlank() || line.startsWith(";") || line.startsWith("#")) continue
        var cursor = 0
        val tags = ArrayList<Long>()
        while (cursor < line.length && line[cursor] == '[') {
            val close = line.indexOf(']', cursor)
            if (close < 0) break
            val ms = parseTimeTag(line.substring(cursor + 1, close)) ?: break
            tags += ms
            cursor = close + 1
        }
        if (tags.isEmpty()) continue
        val body = line.substring(cursor).trim()
        if (body.isEmpty()) continue
        for (ms in tags) out += LrcLine(ms, body)
    }
    return out.sortedBy { it.timeMs }
}

/** `[mm:ss]` / `[mm:ss.xx]` / `[mm:ss.xxx]` → 毫秒；含字母（ar/ti/by/offset）或格式不符返回 null。 */
private fun parseTimeTag(tag: String): Long? {
    val match = Regex("""^(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?$""").matchEntire(tag.trim()) ?: return null
    val (mm, ss, frac) = match.destructured
    val minutes = mm.toLongOrNull() ?: return null
    val seconds = ss.toLongOrNull() ?: return null
    if (seconds > 59) return null
    val fracMs = when {
        frac.isEmpty() -> 0L
        frac.length == 1 -> frac.toLong() * 100
        frac.length == 2 -> frac.toLong() * 10
        else -> frac.toLong()
    }
    return minutes * 60_000 + seconds * 1000 + fracMs
}

/**
 * 当前歌词行定位：返回最后一个 timeMs <= positionMs 的行下标；
 * 空表或位置早于首行返回 -1（UI 据此显示"歌词还没开始"）。
 * 表必须按时间升序（[parseLrc] 的产出即满足）。
 */
fun indexAt(lines: List<LrcLine>, positionMs: Long): Int {
    var lo = 0
    var hi = lines.size - 1
    var ans = -1
    while (lo <= hi) {
        val mid = (lo + hi) ushr 1
        if (lines[mid].timeMs <= positionMs) { ans = mid; lo = mid + 1 } else hi = mid - 1
    }
    return ans
}
