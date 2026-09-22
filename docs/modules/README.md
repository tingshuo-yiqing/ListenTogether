# 模块文档索引

这些说明于 2026-09-21 建档，进度入口于 2026-09-22 同步；实际验收以 [验收记录](../verification.md) 为准。“当前实现”是已有行为；“下一阶段”均为待开发。
下一批操作与证据要求见 [执行单](../execution-plan.md)。主计划见 [下一阶段方案](../next-development-plan.md)，统一规范见 [文档与注释规范](../development-standards.md)。

整体分层、模块边界与端到端数据流见 [系统架构设计](../architecture.md)；本索引按模块给出职责、流程、接口、异常与验收细节。

| 模块 | 主要入口 | 文档 |
|---|---|---|
| Android 界面与应用入口 | MainActivity、ListenApplication、UiState | [01 Android UI](01-android-ui.md) |
| Android 网络与会话 | RoomClient、Credentials、RoomState | [02 网络与会话](02-client-session.md) |
| Android 播放服务 | PlaybackService、MediaSession | [03 播放服务](03-playback-service.md) |
| 校时与同步算法 | ClockEstimator、SyncMath、PlaybackPolicy | [04 同步](04-synchronization.md) |
| 后端房间领域 | Rooms、Room、Member | [05 房间](05-room-domain.md) |
| 后端启动与 HTTP | index.ts、app.ts | [06 HTTP](06-http-api.md) |
| WebSocket 通信 | realtime/socket.ts | [07 实时通信](07-websocket.md) |
| 曲库与音频传输 | catalog.ts、audio.ts、media | [08 曲库与音频](08-library-audio.md) |
| 构建、脚本与部署 | Gradle、scripts、deploy | [09 部署](09-build-deployment.md) |
| 测试与诊断 | server/test、Android test、验收报告 | [10 测试](10-testing-observability.md) |

模块间的数据流：

```mermaid
flowchart LR
  UI[安卓页面] --> Client[网络与会话]
  Client --> HTTP[HTTP 接口]
  Client <--> WS[WebSocket]
  HTTP --> Rooms[房间领域]
  WS <--> Rooms
  Client --> Sync[校时与目标进度]
  Sync --> Player[播放服务]
  Player --> Audio[鉴权音频接口]
  Audio --> Catalog[曲库]
  Player --> UI
```

共享播放状态由后端房间模块负责；本机暂停/音频焦点由播放器与本机会话负责，不能相互覆盖。

跨模块的开发陷阱与规避方法（编码、adb、UI 自动化、Compose、协程测试）见 [开发陷阱清单](../development-pitfalls.md)；踩到新坑必须回填该文档。
