package com.listentogether.app.ui

import com.listentogether.app.network.UiState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/**
 * 页面结构只订阅业务变化，过滤每 500ms 的本机进度采样。
 * 播放器区域单独订阅原始进度；房间快照（含 seek 确认版本）与错误不能被过滤。
 */
internal fun Flow<UiState>.screenStates(): Flow<UiState> =
    map { it.copy(positionMs = 0) }.distinctUntilChanged()
