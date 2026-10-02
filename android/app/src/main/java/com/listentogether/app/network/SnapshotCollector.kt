package com.listentogether.app.network

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** 有界分块组装器：服务端时序字段决定新旧，随机 snapshotId 仅作身份；缺块 5 秒请求恢复。 */
internal class SnapshotCollector(
    private val scope: CoroutineScope,
    private val field: String,
    private val versionField: String,
    private val availableBytes: () -> Int,
    private val recover: () -> Unit
) {
    private var id: String? = null
    private var header: JSONObject? = null
    private var signature = ""
    private var timer: Job? = null
    private val pieces = mutableMapOf<Int, String>()
    private val retired = ArrayDeque<String>()
    var bytes: Int = 0
        private set

    fun clear(resetHistory: Boolean = false) {
        id?.let { retired.addLast(it); if (retired.size > 32) retired.removeFirst() }
        id = null; header = null; pieces.clear(); bytes = 0
        timer?.cancel(); timer = null
        if (resetHistory) retired.clear()
    }

    fun accept(json: JSONObject): JSONObject? {
        // 支持本地逻辑快照；真实 v2 服务端总是携带分块封装。
        if (!json.has("chunkCount")) { clear(); return json }
        val incomingId = json.getString("snapshotId")
        if (incomingId in retired) return null
        val count = json.getInt("chunkCount")
        val index = json.getInt("chunkIndex")
        require(count in 1..100 && index in 0 until count && incomingId.length in 1..64)
        val incomingVersion = json.getLong(versionField)
        val meta = JSONObject(json.toString()).apply { remove(field); remove("chunkIndex") }
        if (id != incomingId) {
            if (header != null && incomingVersion < header!!.getLong(versionField)) return null
            clear(); id = incomingId; header = meta; signature = meta.toString()
            timer = scope.launch { delay(5_000); clear(); recover() }
        }
        if (signature != meta.toString()) { clear(); recover(); return null }
        val raw = json.getJSONArray(field).toString()
        val old = pieces[index]
        if (old != null) {
            if (old != raw) { clear(); recover() }
            return null
        }
        // 把完整帧的 UTF-8 字节计费，连同两类组装缓冲共享 512KiB 上界。
        val size = json.toString().toByteArray(Charsets.UTF_8).size
        if (size > 32 * 1024 || size > availableBytes()) { clear(); recover(); return null }
        pieces[index] = raw; bytes += size
        if (pieces.size != count) return null
        val merged = JSONArray()
        for (i in 0 until count) {
            val chunk = JSONArray(pieces.getValue(i))
            for (j in 0 until chunk.length()) merged.put(chunk.get(j))
        }
        if (merged.length() > 100) { clear(); recover(); return null }
        val result = JSONObject(header!!.toString()).put(field, merged)
        clear()
        return result
    }
}
