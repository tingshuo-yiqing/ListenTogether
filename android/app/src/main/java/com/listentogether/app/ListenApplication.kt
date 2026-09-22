package com.listentogether.app

import android.app.Application
import com.listentogether.app.diagnostics.DiagnosticsLog
import com.listentogether.app.network.RoomClient

class ListenApplication : Application() {
    lateinit var roomClient: RoomClient
        private set

    /** 进程级诊断日志单例；网络与播放共用一个 JSONL 文件，便于按时间对齐。 */
    lateinit var diagnostics: DiagnosticsLog
        private set
    override fun onCreate() {
        super.onCreate()
        diagnostics = DiagnosticsLog(this)
        roomClient = RoomClient.create(this, diagnostics)
    }
}
