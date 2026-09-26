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

    /** 最近一次成功加入的公开房间码与昵称；只用于进程重启后的手动重入预填，不含令牌。 */
    fun loadLastRoom(): LastRoom? = null
    fun saveLastRoom(room: LastRoom) {}
}

data class LastRoom(val code: String, val nickname: String)

/** 生产实现：只持久化服务器地址、最近房间码与昵称；成员令牌不落盘。 */
internal class SharedPrefsStore(context: Context) : ConnectionStore {
    private val prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE)
    override fun loadBaseUrl(): String = prefs.getString("baseUrl", "") ?: ""
    override fun saveBaseUrl(url: String) { prefs.edit { putString("baseUrl", url) } }
    override fun loadLastRoom(): LastRoom? {
        val code = prefs.getString("lastRoomCode", null) ?: return null
        val nickname = prefs.getString("lastNickname", null) ?: return null
        return LastRoom(code, nickname)
    }
    override fun saveLastRoom(room: LastRoom) {
        prefs.edit { putString("lastRoomCode", room.code); putString("lastNickname", room.nickname) }
    }
}
