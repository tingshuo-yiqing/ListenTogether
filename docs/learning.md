# 关键代码阅读顺序

1. server/src/rooms/store.ts：共享状态的唯一来源。先看 command 如何结算进度，再看 tick 的房主转移和曲终推进。
2. server/src/realtime/socket.ts：WebSocket 握手验证、校时和心跳；关闭旧连接时的引用比较避免重连竞态。
3. server/src/routes/audio.ts：为什么播放进度跳转需要 HTTP Range，及边界验证。
4. android/.../sync/SyncMath.kt：单调时钟、网络往返中点与播放进度公式。
5. android/.../network/RoomClient.kt：协程、状态流、重连代次，及过期回调丢弃。
6. android/.../playback/PlaybackService.kt：播放器属于服务而非页面，通知栏控制如何经过房间权限。
7. android/.../MainActivity.kt：Compose 状态驱动界面；不在 UI 内维护第二套播放器。

关键代码注释说明设计原因，变量/接口名称采用常用英文。先读 protocol.md，再对照测试修改参数练习。
不要把自定义音频从服务器逐帧实时转发：首版各客户端直接读取同一个 MP3，WebSocket 只发送状态。
