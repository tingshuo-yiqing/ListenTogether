# 一起听歌 · 当前交付与验收记录

项目：D:\ListenTogether
更新日期：2026-09-21

## 本轮完成
- 补齐 Android SDK Platform 35、Build Tools 35.0.0，使用 JDK 17 / Gradle 8.11.1 完成安卓构建。
- 生成已签名调试 APK：android/app/build/outputs/apk/debug/app-debug.apk（支持 Android 8.0 及以上）。
- 修正音频焦点丢失、耳机拔出或音频错误后，被周期同步意外重新播放的问题；明确点击播放才能恢复。
- 添加应用图标与新旧安卓备份配置。
- 添加独立 demo-media 合成测试曲库（30 秒、45 秒测试音），不改动 media 中的个人曲库。
- 添加 build-android.ps1、start-demo.ps1、install-debug.ps1 和 smoke-test.mjs。
- 更新 README、协议和 docs/usb-testing.md。

## 本轮新增（0.2.0 首批开发任务，2026-09-21）
- 网络模块：引入不可变 SessionContext（地址/身份/代次）；HTTP 原语与 WS 回调全部绑定创建时上下文，旧会话迟到结果被丢弃，退出请求不会发往新服务器。
- 网络模块：明确 ConnectionStatus 状态机（Idle/Joining/Connecting/Calibrating/Ready/Reconnecting/Expired）替代 busy+connected 推断；重连等待期提供“立即重试”，Expired 需退出后重新加入。
- 网络模块：退出顺序固化为作废代次 → 取消任务 → 关闭 Socket → 用旧上下文尽力发 DELETE；CancellationException 原样重抛。
- 播放服务：销毁/任务移除只作用于自身绑定的会话代次，旧实例不清除新会话回调、不替新会话退出；缓冲期间不 seek，回到 READY 立即按最新快照校准。
- 同步模块：新增 ClockEstimator（保留 8 样本、45 秒有效期、RTT≤1500ms 中选最短），断线/退出清空样本，恢复后先校时才回 Ready。
- 诊断：debug 构建 DiagnosticsLog 本地 JSONL（连接/校时/播放事件，20MB/60 分钟上限，不含令牌），release 为空操作。
- 诊断：debug 构建 DiagnosticsLog 本地 JSONL（连接/校时/播放事件，20MB/60 分钟上限，不含令牌），release 为空操作。
- 网络模块：HTTP/Socket/时钟/存储/诊断/调度器抽成可替换边界，生产由 RoomClient.create 装配，行为不变；JVM 单测可注入假传输层。
- 测试：新增 RoomClientSessionTest 六场景假传输层竞态回归（入房到 Ready、迟到回调隔离、退出 DELETE 用旧上下文、重连与退出竞态、401 过期后重新加入、校时 15 秒超时断开），安卓单元测试增至 21 项。后端代码未改动。以上均待真机复测确认，不替代验收。
- 脚本：scripts 下全部 .ps1 补 UTF-8 BOM，修复 install-debug.ps1 在 PowerShell 5.1 因中文编码解析失败的问题。
- 真机复测（PHQ110，2026-09-21）：卸载重装后全新入房、状态机 Ready/Reconnecting/Expired 全链路、服务器死亡→退避重连 6 次→404→过期提示→退出重新入房（gen=3）→播放暂停，全部符合预期；诊断 JSONL 真实产出且无令牌。完整记录见 [test-results/2026-09-21-m1-session-device](test-results/2026-09-21-m1-session-device/README.md)。
- 故障注入（2026-09-21）：新增 scripts/fault-proxy.mjs（HTTP+WS 延迟/断线注入代理）与无手机自测脚本，自测 6 项全过；真机经代理完成 300ms 延迟注入（RTT 307→644ms，保持 Ready）、12 秒受控断线（EOF 检测→退避被拒→窗口后自动恢复 Ready）、以及 USB 抖动导致超 60 秒宽限的真实 Expired 路径。记录见 [test-results/2026-09-21-m1-fault-proxy](test-results/2026-09-21-m1-fault-proxy/README.md)。
- 界面重构（2026-09-21）：Material 3 Google 风格 UI——Google 蓝主题 + Android 12+ 动态取色 + 暗色方案；居中顶栏（房间码+复制邀请码）、连接状态横幅（绿/橙/红圆点+立即重试）、正在播放卡片（大号圆形播放按钮）、首字母头像成员列表、当前曲目高亮歌单。RoomClient 调用与行为约定不变；修复 2 处弃用告警（Clipboard API、AutoMirrored 图标）。PHQ110 真机截图验收亮/暗两套主题，播放/暂停回归通过。
- 修复进度拖动大延迟（2026-09-21）：根因是松手后滑条回落到未 seek 的旧位置，需等 WS 往返+广播+seekTo 才跳走。改为乐观预览（松手停在目标）+ 快照确认 + 5 秒超时提示；播放服务 seek 后立即上报位置消除残余闪烁。真机验证：暂停态 3350→15820ms、播放态拖动后从目标无缝续播（22505ms），滑条与标签全程无回跳。
- 新增 [开发陷阱清单](development-pitfalls.md)（2026-09-21）：汇总本项目实际踩过的坑——PowerShell 编码/二进制重定向、adb reverse 随 USB 重插失效、uiautomator 键盘漂移与动态界面失效、Compose 弃用 API、乐观预览模式、UnconfinedTestDispatcher 嵌套 launch 语义、runTest 无限循环等；已挂入 AGENTS.md 标准阅读路径，后续踩坑必须回填。

## 本轮新增（M3 稳定性，2026-09-22）
- 播放失败提示分类（PlaybackFailure）：音频接口 401 提示“登录已失效，请退出房间后重新加入”、404 提示“音乐文件缺失，暂时无法播放”，其余保留 ExoPlayer 错误码并提示点击播放重试；接入 PlaybackService.onPlayerError，新增 4 项 JVM 单测。
- 真机验证通知栏播放/暂停按钮**实际点击**（此前仅 `cmd media_session dispatch`）：点后媒体会话 PLAYING→PAUSED 且位置冻结，设备诊断记录房主 `command pause`、房间 version 4→5，证明走服务端暂停而非仅本机暂停；日志无令牌。
- 真机验证 Dozing 息屏播放约 75 秒无中断、无崩溃，曲目自然播完停止。
- 真机验证蓝牙耳机断开触发本机暂停、重连不自动恢复、明确点击播放后追赶房间进度（等价耳机拔出路径）。
- 新增 40 分钟低码率测试音 demo-long，用于长时播放与音频错误注入；真机验证 404（改名后拖到未缓冲区）→ERROR_CODE_IO_BAD_HTTP_STATUS→本机暂停→恢复文件后手动重试续播至结尾。
- 完整记录见 [test-results/2026-09-22-m3-notification-device](test-results/2026-09-22-m3-notification-device/README.md) 与 [test-results/2026-09-22-m3-bluetooth-audio-error](test-results/2026-09-22-m3-bluetooth-audio-error/README.md)。

## 当前验证结果
- 完整清理后重建：BUILD SUCCESSFUL（含本轮改动）。
- 安卓单元测试：25 项通过（RoomClient 会话竞态 6、ClockEstimator 6、同步计算 5、播放策略 4、播放失败分类 4），无失败。
- Android Lint：0 个问题。
- 本轮 APK SHA256：74BB193C670A9DB0F73FE8F2B5E7BCCFD62ECFD77DB07F7833E02FF541F5BBAF（含 M3 播放失败提示分类）
  （历史：D30EE0EE455C6F16102592896EF11236F74907416A8E6A4546A9AE0D877940FB 通知栏/息屏真机验证版；9AD0BD1DBEF839D6966AF5F0DF5DD47F3CF0EC16A454D772ED7C75E039DB2B22 界面重构版；139EC36C38A729351833DE01526B9904A2D5483E7E93F44826CE8628D059D839 会话加固版；228BB0B0A1CA2B169523D51FA14A477625F3E938A60E9FA99929B5004BB62939 上一轮基线）
- 实际启动演示后端并通过 HTTP 健康检查、两端 WebSocket 播放/跳转广播、成员权限拦截、真实 MP3 Range 读取。
- 上一轮后端构建及 7 项测试已通过；本轮未修改后端核心代码。
- 手机 PHQ110：上一轮 ADB 安装返回 Success，并完成真实出声、暂停、跳转、切歌、后台和短暂息屏播放（详见 playback-test-2026-09-21.md）。
- 手机 PHQ110：本轮已安装最新 APK（SHA256 74BB193C…），并完成通知栏按钮实际点击与 Dozing 息屏播放验证；重装可执行 install-debug.ps1。

## 现在如何继续

先保持手机 USB 连接并允许 USB 调试。在 PowerShell 中：
```powershell
cd D:\ListenTogether
.\scripts\install-debug.ps1
```
脚本会安装最新 APK、设置 USB 端口转发并打开 APP。手机填写：
```text
http://127.0.0.1:3000
```
输入昵称，创建房间，再选择合成测试音播放。请先调低手机音量。

演示后端在本轮联调时已启动。如果后续重启电脑或后端停止，另开终端执行：
```powershell
cd D:\ListenTogether
.\scripts\start-demo.ps1
```
保持后端窗口运行。多手机联调时使用 install-debug.ps1 -Serial 设备序列号，分别设置 USB 转发。
测试期间 USB 断开会影响本机地址访问；公网部署后不需要 USB，但本轮尚未部署到云端。

## 尚待真机与云端验收
- [x] 手机实际创建房间、选歌、播放、暂停、拖动进度；用户确认有声音。
- [x] 断线重连状态机：服务器死亡→退避重连→404 过期→退出重新入房（2026-09-21 真机故障注入，见 test-results 记录）。
- [x] 受控断线恢复与延迟注入：本地代理 12 秒断线自动恢复、300ms 延迟下校时稳定（2026-09-21，见 test-results/2026-09-21-m1-fault-proxy）。
- [ ] 两台安卓手机同时听歌并测量同步误差，不能把 WebSocket 测试当作实际音频同步验证（M2，因缺少第二台手机挂起）。
- [x] 后台与短暂息屏继续播放，系统媒体会话暂停控制。
- [x] 通知栏按钮实际点击（2026-09-22 真机，点后走服务端 command pause；见 test-results/2026-09-22-m3-notification-device）。
- [x] 耳机拔出等价路径：蓝牙断开触发本机暂停、重连不自动恢复（2026-09-22，见 test-results/2026-09-22-m3-bluetooth-audio-error）。
- [x] 音频错误重试：404→ERROR_CODE_IO_BAD_HTTP_STATUS→暂停→恢复文件后手动重试续播（2026-09-22，同上）。
- [ ] 长时间锁屏/30 分钟息屏、来电/其他媒体抢音频焦点、401 令牌失效（demo-long 已备好，可直接做长时项）。
- [ ] 成员端本地暂停不影响其他人、房主转移、中途加入（需第二台手机）。
- [ ] 云端部署、TLS、公网延迟和 15 路实际音频带宽（2026-09-22 尝试：云主机 8.166.126.136 可达但 SSH 公钥被拒，root 与 aliyun 均 `Permission denied`，登录未打通，已挂起；排查步骤见 [deployment.md](deployment.md) 第 0 节）。

## 测试记录入口

- [2026-09-21 PHQ110 真机播放测试](playback-test-2026-09-21.md)：含完整操作过程、状态采样、问题处理和结论边界。
