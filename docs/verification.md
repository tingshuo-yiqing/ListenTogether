# 一起听歌 · 当前交付与验收记录

项目：D:\ListenTogether
更新日期：2026-09-23

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
- 网络模块：HTTP/Socket/时钟/存储/诊断/调度器抽成可替换边界，生产由 RoomClient.create 装配，行为不变；JVM 单测可注入假传输层。
- 测试：新增 RoomClientSessionTest 六场景假传输层竞态回归（入房到 Ready、迟到回调隔离、退出 DELETE 用旧上下文、重连与退出竞态、401 过期后重新加入、校时 15 秒超时断开），安卓单元测试增至 21 项。后端代码未改动。当时待真机复测；后续已完成下述 2026-09-21 单机复测与故障注入，双机仍待验收。
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

## 本轮新增（M3-AUTH 注入 + LOAD-15 负载，2026-09-22）
- M3-AUTH 注入工具：fault-proxy 新增 `__fault/audio401`（仅音频路由 401、响应体与后端 Fault(401) 一致、其余 HTTP/WS 透传、到期/清除恢复），无手机自测 10 项全过（记录见 [test-results/2026-09-22-m3-auth](test-results/2026-09-22-m3-auth/README.md)）。
- M3-AUTH 真机 401 路径通过（PHQ110，APK 8CF98CE1…）：seek 未缓冲区后 4 次 401 即停（无无限重试）、ERROR(7) 本机暂停、JSONL `error:ERROR_CODE_IO_BAD_HTTP_STATUS` + localPause:true、房间 version 不变；恢复后明确播放续播。真实令牌作废仍无入口，未测（如实标注）。
- 修复真机暴露的缺陷：周期校时把本机暂停提示覆盖成“已同步”（RoomClient.kt 校时路径），改为 locallyPaused 时保留原 message；新增回归测试 `clockSyncKeepsLocalPauseMessage`，单元测试增至 26 项，Lint 0。修复版 APK 832FB65E… **待设备重连后复验横幅持久性**（本轮收尾时设备断开，显式挂起）。
- LOAD-15 交付并通过本地 10 分钟记录：15 路 × 600s 全 206、零失败、合计 2.873 Mbps（=192kbps×15 的 99.8%），每路 1 秒粒度采样；吞吐模型本机回环 ≈525 Mbps 仅作容量参考。曲库新增 demo-load（11 分钟 192kbps）。记录见 [test-results/2026-09-22-load15](test-results/2026-09-22-load15/README.md)。
- 脚本缺陷修复：负载成员必须持有 WS——服务端按“离线 60 秒”清扫无连接成员，首次 10 分钟运行因此失败（401/404），已回填 [开发陷阱清单](development-pitfalls.md)。
- 设备断开前清理：故障代理已停止；后端保留运行。

## 本轮新增（M3 音频焦点，2026-09-22）
- M3-FOCUS 通过（真机，PHQ110）：其他媒体持久抢占（OPPO 音乐播放真实歌曲）与真实来电（响铃→接通→挂断）两条路径均为本机暂停——焦点丢失 ≤300ms 内 PAUSED、JSONL 无任何服务端 command、房间 version 不变（其他人继续听）、对方停止/挂断后不自动恢复（位置冻结、updated 无第二次变化），明确点击播放后按服务器进度续播（drift 74ms / 67ms，version 4→5、5→6）。瞬态来电因“本地暂停态覆盖 ExoPlayer 瞬态自动恢复”，同样收敛为手动恢复且无恢复抖动，符合行为约定。完整记录见 [test-results/2026-09-22-m3-focus](test-results/2026-09-22-m3-focus/README.md)。
- 修复本地暂停诊断盲区：applyState 暂停分支此前提前 return，`localPause=true` 从不写入 JSONL；改为进入暂停沿记录一条 `correction:"localPause"`，新 APK 真机复验出现且仅一条。
- 环境事实记录：OPPO 视频不经焦点而直接暂停媒体会话（按“显式暂停”处理并向服务端发送 pause，全房间暂停，语义符合协议）；息屏后台网络挂起 → 服务端心跳 terminate → 60 秒成员清扫 → 重连 404 → Expired（设计内路径，正确处理）；OPPO 会在其他媒体前台约 33 秒后杀掉后台的本应用进程（含前台服务），快速切回前台可避免。以上已回填 [开发陷阱清单](development-pitfalls.md) 2.4–2.6。
- 本轮过程中 M3-LONG 相关长时/息屏测试按用户指示继续挂起（无连续测试条件）。

## 本轮新增（文档与推进方案，2026-09-22）
- 同步主计划、模块索引与开发入口的进度；清除重复诊断条目，纠正通知栏/息屏报告与 APK 的对应关系。
- 新增 [下一批推进与验收执行单](execution-plan.md)：明确 M3 长时/焦点/401、15 路音频、M2 解除阻塞和 M4 部署门槛。
- 明确 40 分钟测试音不能覆盖 60 分钟连续播放，以及诊断 60 分钟窗口到期停止写入的证据限制。
- 本次仅更新文档，未重新构建、运行自动化或执行真机/云端测试；下列结果与 APK hash 保留既有记录。
- 文档检查：10 个改动文件中的 50 个本地 Markdown 链接目标均存在；编码检查与 git diff --check 通过。

## 本轮新增（统一检查入口，2026-09-22）

- 新增 scripts/check.ps1 项目级检查入口，默认 -Scope all 依次执行后端构建/测试、安卓 testDebugUnitTest/assembleDebug/lintDebug 和 Markdown 本地链接检查；支持 server、android、docs 单独运行。
- 新增 scripts/check-doc-links.mjs，扫描项目文档中的本地 Markdown 链接，跳过外部 URL、锚点以及构建/依赖目录。
- 实际验证：scripts/check.ps1 -Scope all 通过；后端 7 项测试全过，安卓构建成功、Lint 0，Markdown 本地链接检查通过。APK SHA256 保持 832FB65EA4B606EB1C3EBFCE0EEAA887C585097D30219C1B11ED3884F907D09B。
- 真机未连接，本轮未安装或复验 APK；832FB65E… 的 M3-AUTH 横幅持久性复验仍待设备重连。
## 本轮新增（无真机批次：M3-LONG 准备 + 单测增量，2026-09-22）

本轮按用户指示跳过依赖真机的任务（设备不可用），只推进不依赖真机的开发与文档。

- M3-LONG 测试音备好：demo-media 新增 demo-hour.mp3（70 分钟 330Hz 单声道 24kbps 正弦波，淡入淡出；ffmpeg 完整解码校验时长恰为 01:10:00），覆盖执行单要求的"至少 65 分钟"；catalog.json 接入并用服务端同款 music-metadata 校验全部条目时长（30s/45s/2400s/4200s/660s）。曲库启动时加载，真机执行前需重启演示后端。个人 media 未改动。
- M3-LONG 采样脚本：新增 scripts/m3long-sample.ps1——每 30 秒采样本应用媒体会话 state/position、每 5 分钟记录内存 TOTAL 与电池、每次亮/息屏切换记录电源状态；adb 失败如实记空档；UTF-8 BOM 已补。**真机执行仍挂起**，待设备到位后按 execution-plan 第 2 节执行。
- 安卓单测 26 → 32 项：RoomClientSessionTest 新增 6 场景——旧版本快照被忽略（同版本仍应用）、会话活跃期重复 join 被忽略、retry 仅在 Reconnecting 生效且清退避立即重连、重连退避 1/2/4 秒指数递增、关闭帧 1000→Expired 而 1001→Reconnecting、断线重连后必须重新校时才回 Ready。testDebugUnitTest 全过（32/0 失败），assembleDebug 通过，Lint 错误/警告 0（仅 1 条既有 Information 级提示）。
- 本轮未改产品代码：重建 APK 的 SHA256 不变，仍为 832FB65EA4B606EB1C3EBFCE0EEAA887C585097D30219C1B11ED3884F907D09B（构建可复现）；其真机横幅复验仍待设备重连。
- 文档同步：execution-plan.md 标注 M3-LONG 测试音与采样脚本已备；模块 02 文档更新测试场景清单；陷阱清单第 7 节回填 4 条新坑（Windows 程序不认 /d/ 路径、cmd //c 静默失效、PowerShell 输出重定向取日志、曲库启动时加载）。
- 后端代码与测试未改动；真机相关验收（M2 双机、M3-LONG 执行、APK 横幅复验、M4 云端）维持挂起状态不变。

## 本轮新增（系统架构设计文档，2026-09-22）

- 新增 [系统架构设计](architecture.md)：基于实际代码梳理的分层架构图（客户端五层 / 后端四层）、8 张 Mermaid 图（全景、依赖规则、入房校时时序、房主控制时序、音频 Range 流、状态机、本地中断流、工程部署视图）、模块职责与边界表、依赖矩阵、六条端到端数据流路径、8 条关键不变式与代码位置索引。
- 内容来源：`RoomClient.kt`、`SessionContext.kt`、`Models.kt`、`ClockEstimator.kt`、`SyncMath.kt`、`PlaybackPolicy.kt`、`PlaybackService.kt`、`PlaybackFailure.kt`、`DiagnosticsLog.kt`、`server/src/app.ts|index.ts|rooms/store.ts|realtime/socket.ts|routes/audio.ts|library/catalog.ts` 与 [protocol.md](protocol.md) 交叉核对，常量（100 房间 / 15 成员 / 60 秒宽限 / 300 秒清理 / 500ms 阈值 / 250ms tick）均取自代码而非文档转述。
- 入口同步：README.md「文档」小节与 [模块文档索引](modules/README.md) 已挂入架构文档链接。
- 本轮为纯文档交付，未改动任何产品代码，未执行构建、单测或真机测试；既有 APK hash（832FB65E…）与全部验收结论保持不变。
- 文档检查：`scripts\check-doc-links.mjs` 通过（含新增链接）。

## 本轮新增（UI 交互修补，2026-09-22）

- 四项交互优化（MainActivity.kt，表现层，RoomClient 调用与行为约定不变）：
  1. 软键盘适配：内容区加 imePadding，点空白处 clearFocus 收键盘（真机实测 PHQ110 的 ESC 事件关不掉输入法，导致按钮坐标偏移——本轮复验脚本已因此修过一次）；
  2. 复制邀请码后弹 Snackbar"邀请码已复制"（此前零反馈）；
  3. Expired 状态横幅附"退出房间"快捷按钮（此前须滚动到页面底部找退出，操作闭环）;
  4. 进度滑块被禁用时在时间行下方说明原因（"连接未就绪，暂不可拖动进度"/"跟听模式，进度由房主控制"）。
- 时间格式化支持 1 小时以上 h:mm:ss（demo-hour 70 分钟显示 1:10:00，原先显示 70:00）；新增 FormatTimeTest 4 项。
- 验证：testDebugUnitTest 36/36 通过、assembleDebug 成功、Lint 0 错误 0 警告（仅 1 条既有 Information 提示）。
- 本轮 APK SHA256：**5DA5082AA630A10AE324172FFA4B46F9D073A2AB4BDD07F6082EEA4C67D9119F**。
- 边界：UI 改动不触碰被复验的 RoomClient 校时路径，但新 APK 的键盘适配/Snackbar/快捷按钮/h:mm:ss 尚未真机目视验证，并入下一次真机批次（连同 M3-LONG）。
- 文档同步：模块 01 界面结构与变更记录已更新。

## 本轮新增（无线调试通道打通，2026-09-22）

- 目标：解决 M3-AUTH 横幅复验卡住的根因——USB 物理链路在 device/offline/消失间秒级抖动，交互式复验必然中途断（见下方尚待验收项）。改用无线 adb 绕开 USB。
- 新增 scripts/connect-wireless.ps1：**一个进程内**完成「配对（可选）→ connect → adb reverse（默认 3000，可 3000,3001）→ 可选安装启动 APK → 可选设备端 curl 自检」，并打印后续脚本应使用的 -Serial。必须一次性完成的根因：adb server 重启会同时清空无线连接与 reverse 规则，分步执行只会得到 `device not found`。
- 实测通过（PHQ110 / OPPO A1 Pro 5G / Android 14，调试端口 192.168.43.15:41959）：`adb pair 192.168.43.15:38811 028776` 返回 `Successfully paired to 192.168.43.15:38811 [guid=adb-fbddbe8-WFMDTR]`；`adb connect` 成功且 `adb devices` 状态为 `device`；`reverse --list` 同时列出 `host-22 tcp:3000 tcp:3000` 与 `tcp:3001`；**设备端 `curl http://127.0.0.1:3000/health` 返回 `{"ok":true}`**。
- 结论：**无线 adb 下 `adb reverse` 完全可用，本项目反向转发架构无需改动**，APP 内地址仍填 http://127.0.0.1:3000，后端不必改 HOST、不必开防火墙。设备自带 `/system/bin/curl`，可直接用于隧道自检（`-Verify`）。
- 环境事实：设备已装 APK versionName=0.1.0；本机演示后端健康检查返回 200（后端仍在运行，故障代理未启动，故 3001 自检为空响应，属预期）。
- 回填 [开发陷阱清单](development-pitfalls.md) 新增 2.7（配对端口≠调试端口且每次变、配对码失效后可直接 connect、adb server 重启断链且不自动恢复、同机双 transport、`powershell -File` 把 `-Port 3000,3001` 拼成 `30003001`、无线仍受 2.4 息屏挂起约束），并在 2.2（USB 抖动加重形态）挂上指引链接。
- 文档同步：README 新增「无线连接真机（免 USB）」小节；AGENTS.md 常用命令补 connect-wireless.ps1。
- 脚本检查：scripts/*.ps1 全部 UTF-8 with BOM、PSParser 静态解析 0 错误；connect-wireless.ps1 真机实跑通过（含 reverse 列表逐端口校验）。
- 本轮未改产品代码、未重新构建；APK SHA256 仍为 832FB65EA4B606EB1C3EBFCE0EEAA887C585097D30219C1B11ED3884F907D09B。**832FB65E 的 M3-AUTH 横幅持久性复验自此具备执行条件（无线通道已验证），但本轮未执行，不记为通过。**

## 本轮新增（M4 只读盘点完成，2026-09-22 晚）

- **SSH 登录打通**：用户经云控制台在 `/root/.ssh/authorized_keys` 实际写入本机公钥后，`ssh -o BatchMode=yes aliyun` 返回 SSH-OK。根因确认：此前"公钥被拒"是 authorized_keys 从未实际写入成功（服务器文件时间戳 Sep 22 22:17；auth 日志 22:17:46 起记录本机指纹 05LmNZ… 的 Accepted publickey）。[deployment.md](deployment.md) 第 0 节排查记录就此关闭。
- M4 第 1 步只读盘点完成：`scripts/m4-inventory.sh` 上传服务器执行，原始输出与记录见 [test-results/2026-09-22-m4-inventory](test-results/2026-09-22-m4-inventory/README.md)。关键现状：Ubuntu 26.04.1 / 2vCPU / **内存 1.7Gi 且无 swap** / 磁盘 10%；**Node 未安装**（部署前需装 Node 24）；/opt/listen-together 与 listen 账号不存在（首次部署）；80/443/3000 空闲；nginx/certbot 未装；出网 npm 200；防火墙 inactive（开放靠安全组）。
- 本轮严格只读，未在服务器安装或修改任何配置；APK 与后端代码未动。
- M4 下一步（待用户确认节奏）：装 Node 24 → 建账号/目录 → 上传 20260922-2159 部署包首次部署 → 隧道联调 → 公网验证。

## 本轮新增（M4 部署准备，2026-09-22 晚）

- SSH 现状复核：`ssh -o BatchMode=yes aliyun` 仍返回 `Permission denied (publickey,password)`，与本机密钥/配置无关（指纹吻合、Host 配置正确）。排查已到本机能力边界，**需阿里云控制台（Workbench/VNC）在服务器端定位**；[deployment.md](deployment.md) 第 0 节已附控制台粘贴用修复命令块（含本机真实公钥）与修复后验证命令。
- 新增 `scripts/m4-inventory.sh`：服务器端一键**只读**盘点（身份/CPU/内存/磁盘/node/端口与现有服务/sshd 配置与 auth 日志/nginx 与证书/出网/journal 占用），对应 execution-plan 第 5 节第 1 步；登录打通后第一时间执行，输出落到 `/tmp` 再取回。
- 新增 `scripts/package-deploy.ps1` 并实跑验证：本地 tsc 构建（0 错误）→ 打包 server（源码+dist+锁文件，排除 node_modules）+ demo-media 合成曲库 + deploy 模板 + 部署文档 → `deploy-artifacts/listen-together-0.1.0-20260922-2159.tar.gz`（20.5MB，含 7 个 mp3）+ 逐文件 SHA256 清单。打包脚本三轮迭代修复（docs 子目录、media 与 demo-media 区分——`media/` 仅 catalog 占位，实际曲库在 `demo-media/`）。
- [deployment.md](deployment.md) 新增第 5 节「版本目录与回滚」：`releases/<id>` + `/opt/listen-together/server` 符号链接方案（systemd 路径不变，规避"未实现的 current 目录"禁忌）、升级/回滚命令、media 持久层、首次部署只验证停用/恢复候选不记作回滚通过。
- `.gitignore` 补 `deploy-artifacts/`、`.workbuddy/` 等。本轮未改产品代码、未重新构建 APK。
- M4 剩余门槛（不变）：SSH 登录打通 → 只读盘点 → M2/M3 达标后部署单实例候选 → 双公网真机验证。

## 本轮新增（M3-AUTH 横幅持久性复验通过，2026-09-22 晚）

- **APK 832FB65E 的 401 横幅持久性复验通过，挂起项关闭。** 装机确认：从设备拉取 base.apk（24,417,854 字节）SHA256 = `832fb65ea4b606eb…90b`，与记录完全一致。完整记录见 [test-results/2026-09-22-m3-auth-recheck](test-results/2026-09-22-m3-auth-recheck/README.md)。
- 复验数据（无线通道 192.168.43.15:41145，房间 6903C8E6）：注入 audio401 120s → seek 到 10:47 未缓冲区 → ERROR(7) 本机暂停、代理统计 `audio401:4`（4 次即停，无无限重试，与 8CF98CE1 首轮一致）；诊断 JSONL 记录 `localPause:true, correction:"error:ERROR_CODE_IO_BAD_HTTP_STATUS"`（localPause 边沿修复成立，error 条目仅 1 条）；横幅"登录已失效，请退出房间后重新加入" 5/5 采样持续显示且全部在注入窗口过期后（跨 ≥5 个校时周期），`已同步` 0/5 回归——**周期校时覆盖暂停提示的修复成立**；清除注入后明确点播放续播、横幅恢复"已同步"。
- 真实令牌作废场景仍无入口，维持标注不变。
- 流程发现（已回填 m3-auth-recheck.sh）：点曲目行只选曲不播（需再点 content-desc="播放" FAB）；连接状态横幅可能被"正在播放"卡片遮挡（dump 看不到文案，需先滑动露出；横幅出现后布局下移，FAB 坐标需重新 dump）。
- 环境新坑回填 [开发陷阱清单](development-pitfalls.md) **2.8**：OPPO 息屏冻结无线 adbd——TCP 端口仍可达但握手永远 offline，端口随 adbd 重启轮换（41559→39731→41145），ping 一直通；亮屏后恢复。`settings put system screen_off_timeout` 被 OPPO 拒绝（WRITE_SETTINGS），原值 30 分钟。

## 本轮新增（M4 首次部署与隧道联调通过，2026-09-22 深夜）

- **云端首次部署完成并全部通过验证**（用户已确认本轮在服务器实际安装软件/建账号）。序列：2G swap（/swapfile + fstab，防 npm ci/tsc OOM）→ Node v24.9.0（官方二进制 npmmirror 下载 + SHASUMS256 校验，/opt/node24 → /usr/bin/node 符号链接；apt 候选仅 22.22.1 不满足 engines >=24）→ listen 系统账号（uid 999）+ /opt/listen-together/releases/20260922-2159 → 部署包上传后 tarball + 解包 35 文件 SHA256 逐项校验通过 → listen 账号 npm ci / tsc 构建 / prune（typescript 已移除）→ chown root:listen + g+rX 收回写权限 → media 布置 5 首 demo 曲库 → systemd 服务 **active + enabled**，health `{"ok":true}`。
- 服务端功能验证 **13/13**（新脚本 scripts/m4-deploy-verify.sh，可复用）：health；建房取 64 位令牌；曲库鉴权 200/5 首、无令牌 401；音频全量 200（481,114B）、Range 0-1023→206 + `bytes 0-1023/481114`、后缀 -500→206、开区间→206 480,090B、越界→416、无令牌→401；WS 持令牌 open+sync 回 clock+state、无令牌升级被拒 401；临时成员退出清理；journal 无错误。
- **SSH 隧道受控联调 9/9**（新脚本 scripts/tunnel-verify.mjs）：本机 13000→云端 127.0.0.1:3000（后端保持回环绑定未暴露公网；本机 3000 被演示后端占用故换 13000），全链路 health/建房/曲库/音频 Range/WS/退出全部通过。
- 完整记录见 [test-results/2026-09-22-m4-first-deploy](test-results/2026-09-22-m4-first-deploy/README.md)（含部署后基线、原始输出、边界与纠偏）。
- 纠偏：demo-media 内个人音频「有何不可.mp3」随整目录打包被带上服务器（catalog 未引用、API 不会提供）——已从服务器删除，package-deploy.ps1 改为按 catalog.json 引用过滤打包；`node -e` 模式 argv 不含脚本名的取参坑已回填陷阱清单第 7 节。
- 边界（如实标注）：公网验证未做（需 0.0.0.0 绑定 + 安全组或 TLS 反代，再从两种公网网络真机验证）；版本回滚未验证（首次部署无上一版，仅具备停用/恢复候选条件）；15 路云端负载与 TLS/公网延迟未测（M4 后续门槛）。

## 本轮新增（全量检查与 GitHub 提交，2026-09-22 深夜）

- scripts/check.ps1 -Scope all 全过：后端 tsc 0 错误 + **7/7 测试**；安卓 assembleDebug 成功 + **36 项单测**（输入未变 UP-TO-DATE）+ **Lint 0 错误 0 警告**；APK SHA256 与上一轮一致 `5DA5082AA630A10AE324172FFA4B46F9D073A2AB4BDD07F6082EEA4C67D9119F`（构建可复现）；文档本地链接检查通过。云端复核：listen-together active、`{"ok":true}`、负载极低。
- 环境坑回填 [开发陷阱清单](development-pitfalls.md) **1.5**：check.ps1 的 `$ErrorActionPreference='Stop'` 在外层 `*>&1` 重定向下，会把 Gradle 的 stderr 进度行转成终止错误（空消息 EXCEPTION）；被中断的运行残留 Gradle Daemon 持有 `~/.gradle/caches/8.11.1/fileHashes/fileHashes.lock`（拒绝访问）——`gradlew --stop` 后恢复，锁文件本体无需删除。
- .gitignore 补 `demo-media/有何不可.mp3`（个人音频不入库）；本轮累积交付（UI 修补、无线调试、负载/注入工具、M3/M4 测试记录、云端首次部署脚本与文档）整体提交并推送 GitHub。

## 本轮新增（最小可用开启：公网直连 + 真实曲库，2026-09-22 深夜）

- 用户确认后解除回环绑定：`/etc/listen-together.env` HOST 改为 **0.0.0.0** 并重启，`ss` 实测监听 `0.0.0.0:3000`，health `{"ok":true}`。**公网可达还需用户在阿里云控制台安全组放行 TCP 3000**（服务器侧 ufw inactive，入口只受安全组控制），尚未放行前公网仍不可达。
- 云端曲库按用户指定更换：删除全部 5 个合成测试音，上传 5 首真实 MP3（有何不可 / 痴心绝对 / 单车 / 富士山下 / 句号；来源用户本机音乐目录，句号源文件名"句号mp3.mp3"已改名）。重启后 API catalog 实测 5 首、时长来自文件真实解析（242/262/209/259/236s），audio Range 206、无令牌 401、journal 0 错误。
- 边界：**《目及皆是你》在 C:\Users\ting\Music 全目录未找到**（用户指定位置无此文件），待用户确认位置后补传（补传需重启服务、清空房间）；HTTP 明文传令牌（好友小范围试用可接受，正式使用需 TLS+域名）；当前无任何房间在运行，重启无影响。

## 本轮新增（图标更换 + 公网真机链路测试，2026-09-22 深夜；E2E 暂停）

- **APP 图标去紫色**：背景 `#5143B8` → `#1A73E8`（Google 蓝，与主题一致），前景换白色双音符+淡蓝声波（自适应 vector）。构建成功，**新 APK SHA256：BE545EEFE1C3260A8F4E00C88D8C4C14A62F1A442E7D717978107E79B4E60924**（仅图标资源变更，既有单测/Lint 结论不变）；已 `adb install -r` 装机（Success）。桌面图标目视确认未做，并入下次真机批次。
- **手机 → 公网服务器实测通过**：用户报的无线调试端口 192.168.43.15:37765 已失效（配对码 904907 未用到，本机有历史配对记录），mDNS 通道自动恢复 device 态；设备端 `curl http://8.166.126.136:3000/health` 返回 `{"ok":true}`——**安全组 3000 已生效，公网路径在真机上打通**（M4 公网验证首个数据点）。
- **真机公网 E2E（建房→播放）连续 6 轮自动化失败，按用户指示暂停**：根因链（dump 属性顺序、Compose 光标不可控导致地址框拼接体、pm clear 被 OPPO 拒、run-as sed -i 静默失败）已回填 [开发陷阱清单](development-pitfalls.md) **3.4**，恢复路径（run-as rm 存储或手动输入）一并写入。完整记录见 [test-results/2026-09-22-m4-public-test](test-results/2026-09-22-m4-public-test/README.md)。
- 《目及皆是你》按用户指示放弃；云端曲库维持 5 首真实 MP3 不变。
- 当前手机状态：新 APK 已装、app 停在入房页（地址框预填旧值 127.0.0.1:3001、昵称空）；云端服务与曲库正常，无需回滚。

## 本轮新增（简洁 UI 开发，2026-09-23）

- 首页创建/加入 Tab、单主按钮与内联入房错误；正常连接收进人数摘要，成员默认折叠，房间码弱化，轻量歌单仅高亮当前曲目。
- 当前歌曲两行标题；MediaController 实际播放/缓冲/错误观测驱动状态文字，按曲目隔离旧数据；控制器断连清空观测。正常连接不再给播放错误显示绿色成功点。
- 明确房主/成员操作影响；校时完成才启用播放与拖动；进度预览按会话/曲目重置。协议、RoomClient 和播放服务未修改。
- 最终验证：JDK 17；android/gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug :app:lintDebug --console=plain，BUILD SUCCESSFUL；42 项单测 / 0 失败 / 0 错误（新增 PlaybackViewTest 6 项），Lint 0 错误 / 0 警告。文档链接与 git diff --check 通过。
- 最新调试 APK SHA256：59773A08ACB9A4FBFF815C8FEDF3680B55FC7FA4EDA992FC6DC664EFB7119EED。保留之前 5DA5082A… / BE545EEF… 等历史记录；本轮打包包含工作区已有图标更换。
- 本轮无线 adb 真机 UI 验证已执行：本地 reverse 创建房间、播放/暂停、成员展开通过；公网地址 timeout 因云端入口当前不可达而失败。第二台手机、暗色/大字体/旋转、缓冲/401/404 真机显示与 M3-LONG 仍待验证，证据见 UI 真机记录。
- 实现范围、回归场景与目视清单见 [UI 交付记录](test-results/2026-09-23-ui-refresh/README.md)。

## 本轮新增（无线 UI 真机验证，2026-09-23）

- 无线 adb 配对/连接成功：192.168.43.15:37289 配对、192.168.43.15:38645 调试连接；reverse 3000/3001 建立；设备端本地 health 通过；安装 APK 成功。
- 公网建房尝试失败：8.166.126.136:3000 从手机、电脑访问均超时，SSH banner 同样超时；记录为当前云端入口不可达，不归因于 UI。
- 切换到 http://127.0.0.1:3000 reverse 后，真机创建房间成功（房间 20DBB3F3）；创建/加入 Tab、错误区域、房间码/角色、人数摘要、成员折叠、轻量歌单通过目视检查。
- 播放按钮后媒体会话为 PLAYING(3)，页面显示“播放中”；暂停后为 PAUSED(2)、speed=0，位置冻结；展开成员显示 UITest 与“房主 · 在线”。
- 证据与未覆盖项见 UI 真机记录与 test-results/2026-09-23-ui-refresh/evidence/。
- 本轮未执行第二台手机、暗色/大字体/旋转、长歌名完整显示、缓冲/401/404 真机显示和 M3-LONG；公网入口恢复后需重测。
## 本轮新增（公网超时问题定位：同机负载 OOM，2026-09-23 凌晨）

- 检查上一节记录的“云端入口不可达”（建房 timeout、手机/电脑 /health 超时、SSH banner 超时）：**现已全部恢复**——本机 TCP 22/3000 连通、公网 `GET /health` 返回 200 `{"ok":true}`、SSH 登录正常、listen-together active 且 **NRestarts=0（服务全程未中断）**，监听 0.0.0.0:3000 不变。
- 根因（服务器侧证据，只读诊断）：root 常驻登录会话 session-52（22:37 建立，VS Code Remote-SSH 常驻会话；/root/.vscode-server、/root/.cline 时间戳 23:38–00:21 吻合）内运行的 Node 进程（OOM 报告 comm 名 "MainThread"，即 Node 主线程名）膨胀至 RSS ~1GB / VSZ ~19.6GB，在 9-22 23:57、9-23 00:11、01:13 **三次触发内核全局 OOM**；01:13:30 journald 看门狗超时——整机冻结期间外部访问即表现为超时，与真机测试时间窗吻合。详见 [开发陷阱清单 8.5](development-pitfalls.md)。
- 当前状态：内存恢复（available 1.2Gi、swap 0B），VS Code/Cline 进程已不在运行，仅剩后端 node（~53MB）。本轮未改服务器与项目代码。
- 结论与边界：超时不是 listen-together、安全组或 UI 的问题；若服务器上再次运行重内存负载会复发。M4 公网 E2E（建房→播放）自本轮起具备重测条件，仍待执行（入口恢复 + 按陷阱清单 3.4 恢复路径操作）。

## 最近代码交付的验证结果（沿用既有记录）
- 本轮（RoomClient 暂停提示修复 + LOAD-15 脚本）完整构建：BUILD SUCCESSFUL，安卓单元测试 26 项通过，Android Lint 0 个问题。
- 本轮 APK SHA256：832FB65EA4B606EB1C3EBFCE0EEAA887C585097D30219C1B11ED3884F907D09B（含校时不覆盖暂停提示修复；真机复验待设备重连）
- 上一轮 APK SHA256：8CF98CE13507090BC45746B8E1F766CB87839B8B1EE57728E91096F15795BACA（M3 焦点测试 + localPause 边沿诊断；M3-AUTH 真机 401 路径以此版本验证）
- M3 焦点测试结论基于 74BB193C… APK 行为路径 + 8CF98CE1… APK 重验，行为约定无变化。
- 最近代码交付完整清理后重建：BUILD SUCCESSFUL（含 M3 播放失败提示分类）。
- 安卓单元测试：25 项通过（RoomClient 会话竞态 6、ClockEstimator 6、同步计算 5、播放策略 4、播放失败分类 4），无失败。
- Android Lint：0 个问题。
- 本轮 APK SHA256：8CF98CE13507090BC45746B8E1F766CB87839B8B1EE57728E91096F15795BACA（M3 焦点测试 + localPause 边沿诊断）
  （历史：8CF98CE13507090BC45746B8E1F766CB87839B8B1EE57728E91096F15795BACA M3 焦点测试 + localPause 边沿诊断；74BB193C670A9DB0F73FE8F2B5E7BCCFD62ECFD77DB07F7833E02FF541F5BBAF 含 M3 播放失败提示分类；D30EE0EE455C6F16102592896EF11236F74907416A8E6A4546A9AE0D877940FB 通知栏/息屏真机验证版；9AD0BD1DBEF839D6966AF5F0DF5DD47F3CF0EC16A454D772ED7C75E039DB2B22 界面重构版；139EC36C38A729351833DE01526B9904A2D5483E7E93F44826CE8628D059D839 会话加固版；228BB0B0A1CA2B169523D51FA14A477625F3E938A60E9FA99929B5004BB62939 上一轮基线）
- 实际启动演示后端并通过 HTTP 健康检查、两端 WebSocket 播放/跳转广播、成员权限拦截、真实 MP3 Range 读取。
- 上一轮后端构建及 7 项测试已通过；本轮未修改后端核心代码。
- 手机 PHQ110：上一轮 ADB 安装返回 Success，并完成真实出声、暂停、跳转、切歌、后台和短暂息屏播放（详见 playback-test-2026-09-21.md）。
- 手机 PHQ110：本轮已安装最新 APK（SHA256 74BB193C…），完成蓝牙断开与音频 404 恢复；通知栏与短时息屏证据对应此前 D30EE0EE… APK，不混记为最新 APK 的复测。重装可执行 install-debug.ps1。

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

演示后端曾在联调时启动，不代表当前仍在运行。先检查 /health；若未运行，另开终端执行：
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
- [x] M3-FOCUS：其他媒体持久抢占与真实来电中断（2026-09-22 真机，见 test-results/2026-09-22-m3-focus）；去电、拒接、VoIP 抢占未测，已在报告边界标注。
- [ ] M3-LONG：60 分钟连续播放，含至少 30 分钟息屏；现有 demo-long 40 分钟不足覆盖全程，需准备至少 65 分钟测试音和外部采样。（2026-09-22 按用户指示继续挂起）
- [x] M3-AUTH：音频 401 真机路径通过（2026-09-22，注入代理，APK 8CF98CE1）；提示修复版 APK（832FB65E…）真机横幅持久性复验通过（2026-09-22 晚，无线通道，见 test-results/2026-09-22-m3-auth-recheck：401 文案 5/5、已同步 0/5、续播恢复）。剩余：真实令牌作废场景（无入口，保持标注）。
- [x] LOAD-15：本地 15 路负载 10 分钟记录通过（2026-09-22，见 test-results/2026-09-22-load15）；云端 TLS/公网重测仍属 M4 门槛。
- [ ] LOAD-15 完成（本地）；15 路真实音频带宽在云端 TLS/公网条件下重测归入 M4 部署后验证。
- [ ] 成员端本地暂停不影响其他人、房主转移、中途加入（需第二台手机）。
- [x] 云端首次部署 + health/鉴权音频/Range/WS 服务端验证 + SSH 隧道受控联调（2026-09-22，13/13 + 9/9，见 test-results/2026-09-22-m4-first-deploy；后端保持 127.0.0.1 绑定，未暴露公网）。
- [ ] 公网验证：0.0.0.0 绑定 + 安全组放行（或 TLS 反代）后，从两种公网网络真机播放验证；域名/TLS 未盘（用户未提供域名）。
- [ ] 15 路实际音频带宽在云端重测（LOAD-15 云端部分，归 M4）；版本回滚演练（首次部署无上一版，当前仅具备停用/恢复候选条件）。

## 测试记录入口

- [2026-09-21 PHQ110 真机播放测试](playback-test-2026-09-21.md)：含完整操作过程、状态采样、问题处理和结论边界。

- [2026-09-22 M4 首次部署与隧道联调](test-results/2026-09-22-m4-first-deploy/README.md)：服务端 13/13 + 隧道 9/9，含部署后基线、SHA256 校验、纠偏与清理记录。

下一批任务的执行步骤与报告字段见 [执行单](execution-plan.md)。
