package com.listentogether.app

/**
 * 邀请口令的编码与解析（纯函数对象，无时钟域、无网络、无 Android 依赖，可直接 JVM 单测）。
 *
 * 口令格式（encode 产物，四行纯文本，无 markdown 符号）：
 * ```
 * 来一起听歌
 * 房间码 A1B2C3D4
 * 服务器 http://8.166.126.136
 * 复制整段，打开 App 即可加入
 * ```
 * 服务器行为可省略（调用方拿不到地址时降级），decode 返回 server=null 表示沿用已记住地址。
 * 项目约定默认端口 3000：encode 会剥掉 URL 末尾的 :3000 让口令更短更干净，
 * 加入时由 RoomClient.join 按约定补回（非默认端口原样保留，往返一致）。
 * 安全边界：口令只含房间码与服务器地址（公开信息），绝不包含成员令牌。
 */
object InviteCode {

    /** 解析结果：code 必得（大写归一）；server 为 null 表示口令未携带地址。 */
    data class Invite(val code: String, val server: String?)

    // 锚点正则：只认「房间码/邀请码 + 8 位十六进制」与 URL 两种锚点，不做全文宽松匹配。
    // 锚点与取值之间允许任意非字母数字字符（含全角冒号、空格、引号残留），
    // 因此 8 位取值后紧跟字母数字的写法不会被误截。
    private val codeAnchor = Regex("(?:房间码|邀请码)[^0-9A-Za-z]*([0-9A-Fa-f]{8})")
    private val serverAnchor = Regex("(https?://[0-9A-Za-z.:@\\-]+)")

    // 项目约定端口：口令里省略，入房时补回。
    private val conventionPort = Regex("^(https?://[^/?#]+):3000$")

    private const val HEADLINE = "来一起听歌"
    private const val HINT = "复制整段，打开 App 即可加入"

    /**
     * 生成口令文本；server 为空/空白时省略服务器行（降级为仅房间码 + 提示，共三行）。
     * 末尾的约定端口 :3000 剥掉不展示；其他端口（含 https 的 443 显式写法）原样保留。
     */
    fun encode(code: String, server: String?): String = listOfNotNull(
        HEADLINE,
        "房间码 ${code.uppercase()}",
        server?.trim()?.takeIf { it.isNotBlank() }
            ?.let { "服务器 ${conventionPort.find(it)?.groupValues?.get(1) ?: it}" },
        HINT
    ).joinToString("\n")

    /**
     * 从任意文本解析邀请口令；容忍微信/QQ 转发加引号、前后夹闲聊行、hex 大小写混用。
     * 失败行为：找不到房间码锚点时返回 null，调用方保留用户输入，不抛异常。
     */
    fun decode(text: String): Invite? {
        val code = codeAnchor.find(text)?.groupValues?.get(1)?.uppercase() ?: return null
        val server = serverAnchor.find(text)?.groupValues?.get(1)
        return Invite(code, server)
    }
}
