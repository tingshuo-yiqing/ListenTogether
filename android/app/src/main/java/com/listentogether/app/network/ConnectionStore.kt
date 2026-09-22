package com.listentogether.app.network

import android.content.Context
import androidx.core.content.edit

/**
 * 连接偏好存储边界：只保存服务器地址等非敏感信息，成员令牌一律不入存储。
 * 生产实现走 SharedPreferences；JVM 单测用内存实现，避免依赖 Android 框架。
 */
interface ConnectionStore {
    fun loadBaseUrl(): String
    fun saveBaseUrl(url: String)
}

/** 生产实现：baseUrl 是唯一持久化字段；进程重启后需重新加入房间（令牌不落盘）。 */
internal class SharedPrefsStore(context: Context) : ConnectionStore {
    private val prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE)
    override fun loadBaseUrl(): String = prefs.getString("baseUrl", "") ?: ""
    override fun saveBaseUrl(url: String) { prefs.edit { putString("baseUrl", url) } }
}
