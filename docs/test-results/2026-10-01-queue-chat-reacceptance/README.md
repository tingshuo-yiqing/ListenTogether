# 点歌队列 / 聊天 v2 复验（当前原生 UI）

日期：2026-10-01（Asia/Shanghai）。结论：**整体验收仍未通过；ACC-02 的源码与自动化修复已复验关闭，ACC-03 部分改善，其余缺陷继续开放。** 本报告承接 [09-30 独立验收](../2026-09-30-queue-chat-acceptance/README.md)，历史失败结果保留。

## 版本与范围

- 本次 `.\scripts\check.ps1 -Scope server`：构建与 **56/56** 通过；`.\scripts\check.ps1 -Scope android`：cleanTest 强制实跑 **147 项 / 20 套件 / 0 失败 / 0 错误 / 0 跳过**，assembleDebug 与 Lint 通过。Lint 本次任务读取已生成报告，未强制重跑分析；[报告](lint-results-debug.xml) issue 数为 0。
- debug APK：21,008,793 字节，SHA256 `6c3e87586846e72b6369c0d38e6a8fab0ee73db986418a9634a4b999087860aa`，与 UI 交付锚一致。本次没有安装或启动设备应用。
- [常规 JUnit 原始证据](baseline-android/TEST-com.listentogether.app.RoomUiInteractionTest.xml)、[复验前版本清单](version-before.json)、[结束版本清单](version-after.json)记录实际工作区、APK 和 70 份 Kotlin / TypeScript / 编译 JS 哈希，不能用 Git HEAD 替代未提交源码版本。
- ADB 本次枚举为空；没有读取到当前真机 / MuMu 的屏幕、通知栏或 IME。进程清点只有原曲库管理器 PID 18032；没有启动常驻播放后端或操作手机。既有 [MuMu UI 记录](../2026-10-01-android-ui/README.md)作为历史证据，不冒充本次设备实测。
- 测试只用随机本地端口、合成曲目、假 HTTP / WS 和可控发送器。未改产品源码、真实曲库、云端、同步参数或 Git 提交；客户端附加源集只在显式 `-I` 时加载。

## 实跑结果

| 检查 | 本次结果 | 证据与说明 |
|---|---|---|
| 原服务端探针 | 7 项 / 7 失败 | [结果](probe-results.json)：运行时 schema / WS null、command 去重与 ack、限频关联 ID、队列分块、恰好到期、房间去重字节预算均仍复现。 |
| 队列与慢写探针 | 5 项 / 2 通过 / 3 失败 | [结果](extended-probe-results.json)：正常下一首、完成回调计数归零通过；连续失效 / 全部失效队列提前结束，210,630 字节快照只发送 5/7 块即关闭仍失败。 |
| 客户端附加复验 | 11 项 / 4 通过 / 7 失败 | [JUnit XML](client-probe-results.xml)：旧五项全部仍失败；新增发送拒绝保留原操作、关联 429 等待及原身份、服务端缩短期限、成功 ack 后由快照恢复四项通过；确认超时恢复与 ack 丢失时广播关联两项失败。 |
| 累计分页专项（常规测试实跑） | 5 项 / 5 通过 | 45 首累积与重叠去重、1000 首完整分页、旧加载更多延迟响应、新 revision 冲突恢复、网络失败保留第一页与原 offset 重试，见 RoomUiInteractionTest XML。 |

客户端夹具的成员与 messageId 使用合法 UUID。再次执行结果仍为 11 项 / 7 失败，排除非 UUID 样本造成的误判。追加的 `clientMessageId` 广播检查验证**设计要求**：当前 protocol.md 与真实服务端未下发此字段，客户端即使收到该字段也未解析；不能将该检查当作当前服务端已经能发出此帧的证据。

## 原缺陷状态（本版本）

| 编号 | 状态 | 本次判断 |
|---|---|---|
| ACC-01 / P1 | 开放，优先修复 | 已认证 WS `null` 仍产生未捕捉 TypeError；探针只在专用进程捕捉它以写证据。原在用服务未承受此输入。 |
| ACC-02 / P1 | **源码与自动化已关闭** | CatalogSearchState 累积去重、nextOffset 独立于累计条数、查询变化先 invalidate、409 清页并通过 reload 重查；RoomLayout 的实际入口接入这些路径。45 / 1000 首与竞态回归实跑通过。新 APK 真机分页目视仍列为设备补验，不等于重新宣布整个 UI 已通过。 |
| ACC-03 / P1 | **部分修复，整体仍开放** | 原文丢失 / 无原 ID 重试已改善，草稿移至房间持有并由 SaveableStateHolder 保存页面状态；四项附加边界与常规聊天回归通过。确认超时没有请求一次 chat.sync，ack 丢失时真实广播不能解除 pending；真实切页 / 断网 / 限频的设备闭环未做。 |
| ACC-04 / P1 | 开放 | seq 缺口不恢复、缺块 5 秒不恢复、随机后缀拒绝较新快照，三个旧检查均失败；字节预算仍待实现。 |
| ACC-05 / P1 | 开放 | 单条聊天触发播放观察者，expected=0、actual=1；队列 / 快照也沿用同一个观察者。没有据此断言本次设备声音卡顿。 |
| ACC-06 / P2 | 开放 | 实时窗口仍是 101 条而非 100。 |
| ACC-07 / P2 | 开放 | 同 ID 播放 command 产生两次版本增量且无 ack。 |
| ACC-08 / P2 | 开放 | issuedAtMs + 10 分钟恰好到期，仍允许当新操作执行。 |
| ACC-09 / P2 | 开放 | 单房间 5,540,890 字节去重记录仍接受，缺 4MiB 门槛。 |
| ACC-10 / P2 | 开放 | 100 项队列仍为 81,873 字节单帧；慢写仍提前 1013 而非暂停发送等待回调。 |
| ACC-11 / P2 | 开放 | 服务端 429 仍没有 clientMessageId。客户端处理**明确关联**错误已通过，但实际服务端链路尚未补齐，不能关闭端到端问题。 |
| ACC-12 / P2 | 开放 | 扫描预算依赖不断缩短的 queue.length，失效前缀与全部失效两项仍失败。 |

本次将 ACC-02 从开放中移除；ACC-03 不再笼统表述为“失败必丢原文”，保留已通过的修复证据。剩余共 11 个 ACC 项，包括部分修复的 ACC-03；不降低原断言来换取通过。

## 残留边界与设备待验

- 确认超时：原文和原 ID 保留、状态为 Unconfirmed、不自动重发，但 socket 发送的 chat.sync 数仍为 0（期望一次）。进入聊天页时的同步不能替代消息超时恢复。
- ack 丢失：真实消息已加入历史，但 pending 的 messageId 仍未知；即使设计中的原 clientMessageId 已在广播中，ChatEntry 也没有解析它。原 ID 重试可最终获得 ack，仍不足以满足广播独立到达时解除双气泡的要求。
- 播放服务：`applyState` 仍在空 track 清理之前因 `locallyPaused` 早退；UI 隐藏旧控制不等于 Media3 / 通知栏旧媒体已清。当前条目身份仍需与 entryId、待确认 seek 一起复验。此处为源码确认，没有伪造设备播放器结果。
- UI 审查沿用 ui-ux-pro-max 的拖排替代操作指导；QueueScreen 有前移 / 后移的 CustomAccessibilityAction，源码入口存在，但 TalkBack、触感、小屏 / IME 不判为已实测通过。没有重新评价用户已取消的横屏专用布局或两倍字号 UI 功能。
- 新包在 PHQ110 的三页 / 草稿切页、键盘遮挡、通知栏 skip-next / 空媒体、成员操作与真实弱网仍待设备连接后检查。双真机声音同步门槛继续挂起；MuMu 不作为其达标依据。云端 v2 发布仍待缺陷修复与明确授权。

## 复跑与下一步

```powershell
Set-Location D:\ListenTogether
.\scripts\check.ps1 -Scope server
.\scripts\check.ps1 -Scope android
node docs/test-results/2026-10-01-queue-chat-reacceptance/probe.mjs
node docs/test-results/2026-10-01-queue-chat-reacceptance/extended-probe.mjs
Set-Location D:\ListenTogether\android
.\gradlew.bat :app:testDebugUnitTest --tests com.listentogether.app.QueueChatAcceptanceProbeTest -I D:\ListenTogether\docs\test-results\2026-10-01-queue-chat-reacceptance\client-probe.init.gradle --console=plain
```

附加测试退出 1 是已记录的缺陷，不是构建夹具失败。普通 147 项结果已先独立保存；不要用附加用例覆盖后的 Gradle 默认 XML 推断普通门禁失败。先修 ACC-01，再闭环客户端恢复 / 播放订阅和服务端资源预算，补常规回归后按本报告逐项关闭。测试结束无服务端探针进程残留。
