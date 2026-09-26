package com.listentogether.app.ui

/**
 * 昵称与头像字素工具（纯函数，无 Android 依赖，可 JVM 单测）。
 *
 * 协议里 members[] 只有 `name` 一个字符串（见 docs/protocol.md），没有独立头像字段。
 * 客户端因此约定：昵称的首个"字素簇"若是 emoji，就把它当作头像，其余部分是显示名，
 * 这样零协议改动也能让成员在房间里有个可辨认的形象。
 *
 * 关键约束：Kotlin 的 Char 是 UTF-16 码元，`take(1)` 会把 emoji 的代理对切成半个字符，
 * 渲染成方框（见 docs/development-pitfalls.md）。本文件的取字符一律按码点/字素簇操作。
 */

/** 昵称最大长度（UTF-16 码元），与 server/src/rooms/store.ts 的 1–24 字校验保持一致。 */
internal const val NICKNAME_MAX_LENGTH = 24

/** 头像 emoji 与显示名之间的分隔符，昵称形如 "🐱 小王"。 */
private const val AVATAR_SEPARATOR = " "

private const val ZWJ = 0x200D
private const val KEYCAP = 0x20E3
private const val VARIATION_SELECTOR_START = 0xFE00
private const val VARIATION_SELECTOR_END = 0xFE0F
private const val SKIN_TONE_START = 0x1F3FB
private const val SKIN_TONE_END = 0x1F3FF
private const val REGIONAL_INDICATOR_START = 0x1F1E6
private const val REGIONAL_INDICATOR_END = 0x1F1FF

/**
 * 取首个字素簇：emoji 的变体选择符、肤色修饰符、ZWJ 组合（👨‍👩‍👧）与成对地区指示符（🇨🇳）整体返回。
 * 空串（或纯空白）返回 null，调用方负责兜底字符。
 */
internal fun firstGrapheme(value: String): String? {
    val text = value.trim()
    if (text.isEmpty()) return null
    var cursor = 0
    var previous = text.codePointAt(cursor)
    cursor += Character.charCount(previous)
    while (cursor < text.length) {
        val next = text.codePointAt(cursor)
        if (!isGraphemeExtender(previous, next)) break
        cursor += Character.charCount(next)
        previous = next
    }
    return text.substring(0, cursor)
}

/** [previous] 之后紧跟的码点 [next] 是否仍属同一字素簇。 */
private fun isGraphemeExtender(previous: Int, next: Int): Boolean = when {
    // ZWJ 两侧的码点属于同一簇：👨‍👩‍👧 由 5 个码点 + 2 个 ZWJ 组成。
    previous == ZWJ || next == ZWJ -> true
    next in VARIATION_SELECTOR_START..VARIATION_SELECTOR_END -> true
    next in SKIN_TONE_START..SKIN_TONE_END -> true
    next == KEYCAP -> true
    isRegionalIndicator(previous) && isRegionalIndicator(next) -> true
    Character.getType(next) == Character.NON_SPACING_MARK.toInt() -> true
    else -> false
}

private fun isRegionalIndicator(codePoint: Int) = codePoint in REGIONAL_INDICATOR_START..REGIONAL_INDICATOR_END

/** 字素簇里是否含 emoji 码点（用于判断"这算头像还是算名字的第一个字"）。 */
internal fun isEmojiGrapheme(grapheme: String): Boolean {
    var cursor = 0
    while (cursor < grapheme.length) {
        val codePoint = grapheme.codePointAt(cursor)
        if (isEmojiCodePoint(codePoint)) return true
        cursor += Character.charCount(codePoint)
    }
    return false
}

/** 常用 emoji 区块；刻意不含 CJK（0x4E00 起）与拉丁字母，中文昵称首字不会被误判成头像。 */
private fun isEmojiCodePoint(codePoint: Int): Boolean = when (codePoint) {
    in 0x1F000..0x1FAFF -> true // 表情、 Supplemental Symbols、地区指示符、肤色
    in 0x2600..0x27BF -> true   // 杂项符号与装饰符号（☀️ ✂️ ✅）
    in 0x2B00..0x2BFF -> true   // 杂项符号与箭头（⭐ ⬛）
    in 0x2190..0x21FF -> true   // 箭头
    in 0x2900..0x297F -> true
    0x203C, 0x2049, 0x3030, 0x303D, 0x3297, 0x3299, 0x00A9, 0x00AE, 0x2122 -> true
    else -> false
}

/**
 * 拆分昵称：返回 (头像, 显示名)。
 * 首字素不是 emoji 时头像为 null、显示名为原昵称；
 * 昵称本身只有一个 emoji 时显示名回退为该 emoji，避免成员行出现空文本。
 */
internal fun splitAvatarPrefix(name: String): Pair<String?, String> {
    val text = name.trim()
    val head = firstGrapheme(text) ?: return null to ""
    if (!isEmojiGrapheme(head)) return null to text
    val rest = text.substring(head.length).trim()
    return head to rest.ifEmpty { text }
}

/**
 * 按码点截断到不超过 [max] 个 UTF-16 码元（与服务端 `value.trim().length > 24` 同一度量）。
 * 不能用 `take(max)`：昵称第 N 个码元正好是 emoji 的高位代理时会被切出半个字符，
 * 请求体经 UTF-8 编码后变成 '?' 存进服务端，成员列表里就是一个方框。
 * 放不下整个码点时宁可少一个字，也不切半个。
 */
internal fun takeCodePoints(value: String, max: Int): String {
    if (max <= 0) return ""
    if (value.length <= max) return value
    var units = 0
    var cursor = 0
    while (cursor < value.length) {
        val width = Character.charCount(value.codePointAt(cursor))
        if (units + width > max) break
        units += width
        cursor += width
    }
    return value.substring(0, cursor)
}

/**
 * 合成送给服务端的昵称：`头像 emoji + 空格 + 昵称`，总长不超过 [NICKNAME_MAX_LENGTH] 个码元
 * （服务端超长直接 400，前缀必须计入长度）。
 * 用户自己在昵称里敲的 emoji 开头优先，不再叠加选择器里的头像。
 */
internal fun composeNickname(avatar: String?, name: String): String {
    val trimmed = name.trim()
    val (typed, _) = splitAvatarPrefix(trimmed)
    val prefix = typed ?: avatar?.trim()?.takeIf { it.isNotEmpty() && isEmojiGrapheme(it) }
    val body = if (prefix != null) trimmed.removePrefix(prefix).trim() else trimmed
    if (prefix == null) return takeCodePoints(body, NICKNAME_MAX_LENGTH)
    val head = takeCodePoints(prefix, NICKNAME_MAX_LENGTH)
    if (body.isEmpty()) return head
    val room = NICKNAME_MAX_LENGTH - head.length - AVATAR_SEPARATOR.length
    if (room <= 0) return head
    return head + AVATAR_SEPARATOR + takeCodePoints(body, room)
}
