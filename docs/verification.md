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

## 本轮新增（UI 系统评审 + 优化批次，2026-09-23 凌晨）

- 完成一次覆盖视觉一致性/信息层级/导航/交互反馈/适配与无障碍的系统 UI 评审，产出分级问题清单（2 致命 / 8 重要 / 7 建议），本轮落地其中可立即执行的 12 项（MainActivity.kt、ui/theme、Manifest，表现层；RoomClient 调用与行为约定不变）：
  1. 服务器地址折叠为“高级设置：更换服务器地址”，默认收起；地址为空（首启）时自动展开（P0）；
  2. 退出房间从列表底部移至顶栏图标并加确认弹窗（P1）；
  3. 通知权限从冷启动改为入房成功后申请，每次安装只问一次（P1）；
  4. 顶栏新增系统分享邀请码入口，房间码改等宽字体（P2）；
  5. 非房主点击歌单不再静默，Snackbar 提示“只有房主可以切歌”（P1）；
  6. 房间内按返回只退界面，Toast 提示“仍在后台播放，可在通知栏停止”（P1）；
  7. 内容区 560dp 以上限宽居中，平板/横屏不再横向拉伸（P1）；
  8. 暗色冷启动白闪修复：新增 values/themes.xml 与 values-night/themes.xml（Theme.ListenTogether），Manifest 切换引用（P1）；
  9. 标题级字重在 Typography 统一为 SemiBold，移除全部调用处临时指定（P2）；
  10. 新增 Shape.kt 按用途集中圆角 token（横幅/列表行/输入框/卡片/全宽按钮），替换全部裸数字（P2）；
  11. 图标统一 Material Outlined 族（播放/暂停/复制/分享/退出）（P2）；
  12. 删除从未使用的 StatusGreen/StatusAmber 色板；formatTime 改用 Locale.ROOT 防数字本地化（P2）。
- 评审中明确**本轮不做**的项及原因：strings.xml 文案抽取（PlaybackView 等纯函数返回中文文案且被单测断言，抽取需改架构为资源 id，单独立项）；明文 HTTP/networkSecurityConfig（属 M4 公网 E2E 工程范畴，随公网重测一并处理）。
- 验证：`:app:testDebugUnitTest :app:assembleDebug :app:lintDebug` BUILD SUCCESSFUL；**42 项单测 / 0 失败**（无新增测试——改动集中在 Composable 表现层，纯函数逻辑未变）；**Lint 0 错误 0 警告**（仅 1 条既有 Information）。
- 最新调试 APK SHA256：**169018AE746164D274E9C843AC8985A1DD27B647D6BF28DFA05110B705FB6845**。历史：59773A08…（简洁 UI）/ BE545EEF…（图标）/ 832FB65E…（校时修复，真机复验通过版）。
- 边界：新交互（地址折叠、顶栏退出确认、分享、返回 Toast、非房主点歌提示、暗色启动）尚未真机目视验证，并入下一次真机批次；设备当前不可用。

## 本轮新增（UI 优化真机验证通过，2026-09-23 上午）

- 无线通道重连：用户仅提供配对端口+配对码（172.19.0.1:43419 / 658177），配对端口不能 connect；经 `adb mdns services` 取得真实调试端点 **192.168.43.15:39805**，已有配对记录自动重连 device 态。reverse 3000/3001 后设备端 curl `/health` 返回 `{"ok":true}`，本机演示后端正常。新坑回填陷阱 2.7（坑 G：mdns 区分配对/调试端口）与第 7 节（非交互 Invoke-WebRequest 失败改用 HttpWebRequest）。
- **UI 优化批次（APK 169018AE…）真机验证通过**，证据截图见 [test-results/2026-09-23-ui-optimize](test-results/2026-09-23-ui-optimize/README.md)：
  - 入房页地址已折叠为"高级设置：更换服务器地址"（ui-01）；
  - 自动化建房成功（房间 57910E7D），顶栏分享/复制/退出三图标 + 等宽房间码 + 成员摘要 + 播放卡 + 当前曲目高亮（ui-02）；
  - 点播放 →"播放中"、按钮切暂停、进度走动（ui-03，dump 断言通过）；
  - 顶栏退出 → 确认弹窗"退出房间？/取消/退出房间"（ui-04，dump 断言通过），取消后留在房间；
  - 返回键 → App 退到后台，**Toast"仍在后台播放，可在通知栏停止"截图可见**（ui-05；Toast 不进 uiautomator dump，已回填陷阱 2.7）。
- 未覆盖（如实标注）：分享面板实际弹出、非房主点歌 Snackbar、通知权限延迟申请（设备已授权不重弹）、暗色冷启动/大字体/平板限宽、M2 双机仍挂起。

## 本轮新增（曲库上传/转码工具链 + 5 首全量 320k→192k，2026-09-23 中午）

- 新增曲库管理工具链（配对使用，中文只经文件内容流转、绝不进命令行参数）：
  - `scripts/add-media.ps1`（本机驱动）：ffmpeg 本地转码（默认 192k CBR、保留 ID3、元数据 fatal 自动去元数据重转）→ ffprobe 校验时长 ±1.5s/码率 → scp ASCII 临时名上传 → 服务端安装；`-Restart` 顺带重启并轮询 health。BOM/PSParser 检查通过。
  - `scripts/media-manage.sh` → `/opt/listen-together/bin/media-manage.sh`（持久层，升级不覆盖）：`has|install|verify|list`；install 已有 id 原位替换（先备份到 `media-originals/<时间戳>/`）、新 id 按 UTF-8 manifest 落盘并 node 追加 catalog；verify 用后端同款 music-metadata 输出码率表。
- **云端 5 首全量 320k→192k 完成**（源文件与云端逐字节同源，单车/富士山下/痴心绝对/句号本地原件 + 有何不可从云端拉取），时长零漂移（241.9/262.4/208.5/259.2/235.7s），总量 47.2MiB→约 31.6MiB（-33%），单路持续带宽需求 0.32→0.19 Mbps，弱网抗抖动更强。原 320k 文件全部备份在服务器 `media-originals/`。
- 重启 listen-together 后公网验证通过：health 200；catalog API 5 首、标题与时长不变；Range 0-1023 → 206 `bytes 0-1023/5805496`（新文件大小）；无令牌 401；测试房间已清理。
- 修复两个脚本缺陷并回填 [陷阱 1.6](development-pitfalls.md)：EAP=Stop 把 ffmpeg 的 stderr **警告**（exit 0）转成终止异常、误导为转码失败（收窄 EAP 后同文件一次通过）；多选项参数须数组展开。
- 文档同步：[deployment.md 第 6 节](deployment.md)新增"云端曲库管理：上传与转码"（用法、验收要点、备份与重启语义）。
- 本轮未改产品代码；APK hash 不变（59773A08…）。注意：曲库已变，verification 此前记录的"云端曲库全部 320kbps"以本节为准。

## 本轮新增（自动切歌卡顿修复 + 进度条端点样式，2026-09-23 傍晚）

- **根因定位（诊断驱动）**：用户报告"播完自动切换后卡住、进度条在动没声音（卡顿音）"。拉取 3 个会话的设备诊断 JSONL 分析发现"渲染欠载型漂移"：手机（省电模式多日常开 + 后台负载）使音频渲染线程周期性 underrun，播放位置以 ~0.86x 落后服务端（每 5 秒落后 ~700ms，期间无缓冲无暂停）；原">500ms 即 seek"策略形成每 5 秒一次的 seek 风暴（单会话 24 分钟 272 次），seek 丢缓冲+重新起流即可闻断裂；切歌初始 ~3 秒缓冲 + 连环 seek 即"切歌后长时间无声"。完整证据链与因果分析见 [交接单](handover-2026-09-23.md)、[陷阱清单 9.1](development-pitfalls.md)、[同步模块 04](modules/04-synchronization.md)。
- **修复（客户端播放层，行为约定不变）**：
  1. SyncMath 新增分级纠正：500ms 仍是纠正触发线（needsSeek/协议验收目标不变），500ms–2.5s 连续变速追赶（catchupSpeed = 漂移/25 秒，±4%~±12%，Sonic 变速不变调，不丢缓冲不出缺口），>2.5s 才 seek；暂停/装载/大漂移 seek 时倍速复位 1.0；
  2. PlaybackService 新增 SmoothRenderers：AudioTrack 缓冲加大到 ~0.7 秒（120KB），吸收调度抖动减少 underrun；
  3. applyState 自检从"每 5 秒校时回调"提升为"每秒一次"；诊断 correction 字段新增 "speed"。
  4. **推翻首版决策**："不引入变速播放"（modules/04 原文）经真机数据支持后改为分级纠正，决策依据已写入模块文档。
- **进度条端点样式**：material3 1.3 默认手柄是 4×44dp 竖长条（用户报告"很长的竖线"），MainActivity 改为自定义 14dp 圆点手柄 + 5dp 细轨道（thumb/track 自绘），禁用态取 SliderDefaults 色，拖动与乐观预览不变；NowPlayingCard 加 @OptIn(ExperimentalMaterial3Api)。
- **验证**：`:app:testDebugUnitTest :app:assembleDebug :app:lintDebug` BUILD SUCCESSFUL（2m7s）；**单测 45 项 / 0 失败 / 0 错误**（42 + SyncMathTest 新增 3 组）；**Lint 0 错误 0 警告**（仅 1 条既有 Information：AutoboxingStateCreation）；**本轮 APK SHA256：36BD3A5B3ACA74EE45CCEE952F6EB8C042BB0A18D40123601398ADF626DD0CCE**。真机验收（关省电听感复测、切歌复测、端点目视）未做，清单见 [交接单](handover-2026-09-23.md) 第五节。
- **过程坑回填**：MSYS 路径转换吞 /sdcard 参数、会话中断导致编辑重复应用（类重定义/import 重复）见 [陷阱清单 7](development-pitfalls.md)；新设第 9 节"音频链路与播放取证"。

## 本轮新增（TLS/域名配置检查：未达标，卡在 ICP 备案，2026-09-23 傍晚）

- 用户在服务器配置了域名 api.tingshuoyiqing.top + TLS（nginx + Let's Encrypt）。逐项核对 deployment.md 第 3 节要求的结论：**未达到要求，公网 HTTPS 不可用**。
- 已达标项：DNS 解析正确（→ 8.166.126.136）；证书已签发（LE ECDSA，至 2026-12-22）且 certbot 定时续期已排（authenticator=nginx）；nginx 443 ssl + 反代配置正确（**服务器本机** curl HTTPS /health = 200，HTTP→HTTPS 301，WS Upgrade 升级请求透传后端返回 404=链路通）。
- 未达标项：**公网 80/443 被阿里云机房入口的 ICP 备案拦截**（ECS 地域 cn-guangzhou，域名未备案；拦截页 `Server: Beaver`/"Non-compliance ICP Filing"）——HTTPS 公网握手失败、HTTP 80 返回拦截页 403。**唯一解除方式是完成 ICP 备案（用户在阿里云控制台操作，本侧无法代办）**。另：后端仍绑定 0.0.0.0:3000（违反"3000 不对公网开放、后端绑 127.0.0.1"），**有意暂不切换**——备案放行前 3000 明文直连是唯一可用通路，切换会立即断掉现有 APP 入口。
- 本轮已修复（服务器侧，与备案无关）：nginx 反代配置按 [deploy/nginx.conf](../deploy/nginx.conf) 模板重装（补 WS 升级头 ✓ 原有、X-Forwarded-For 改为不可伪造的 `$remote_addr`、补 `proxy_buffering off` 与 `client_max_body_size 8k`、80→301 重定向）；移除与 conf.d 重复的 sites-enabled/api.example.com（消除 "conflicting server name" 警告）。原配置备份在服务器 /root/nginx-backup-20260923-*/。完整坑位记录见 [陷阱 8.6](development-pitfalls.md)。
- 备案完成后的收尾清单（届时执行并更新本文件）：①安全组确认 443 放行后公网复测 HTTPS/WSS；②`/etc/listen-together.env` HOST 改 127.0.0.1 并重启（清空房间）；③APP 地址切换 https://api.tingshuoyiqing.top 真机复验；④注意续期：备案拦截会挡 HTTP-01 续期，若备案先于证书到期（2026-12-22）完成则无碍，否则改 DNS-01。
- 本轮未改产品代码与 APK；服务器 nginx 配置变更已备份可回滚。

## 本轮新增（TLS 过渡入口 8443：试用 ECS 无法备案，2026-09-23 晚）

- 用户确认实例为**阿里云三个月免费试用 ECS**。查证官方文档：**免费试用 ECS 不满足备案服务器要求，无法申请备案服务码**（试用为按量付费形态；备案服务码要求包年包月 ≥3 个月 + 公网带宽 + 中国内地节点）——即试用期备案这条路走不通，443 拦截无法解除。试用到期转正式包年包月后可申请备案。
- 过渡方案已配置：nginx TLS server 块（443 同款证书与反代）追加 `listen 8443 ssl`，非标端口不受备案拦截。服务器本机验证：HTTPS /health 200、WS 升级透传 404（链路通）。原配置备份 /root/nginx-backup-8443。
- **待用户操作一步：阿里云安全组放行 TCP 8443**（放行前公网 8443 TCP 超时，已实测）。放行后 APP 地址填 `https://api.tingshuoyiqing.top:8443`（https + 有效证书 + wss 全可用）；后端 127.0.0.1 迁移与文档达标记录随其后执行。
- 合规边界：非标端口 + 未备案域名属过渡形态，试用个人场景可接受；长期应转包年包月备案（或迁中国香港地域免备案）。

## 本轮新增（TLS 过渡入口 8443 结论更正：拦截按域名跨端口生效，2026-09-23 晚）

- 用户放行安全组 TCP 8443 后复测，**推翻上一节的“非标端口不受影响”判断**。对照实验（公网，2026-09-23 19:5x）：
  - `https://8.166.126.136:8443/health`（IP）→ **200**（TLS 可用，但域名证书与 IP 不匹配）
  - `http://api.tingshuoyiqing.top:3000/health`（域名）→ **403**（被拦）
  - `http://8.166.126.136:3000/health`（IP）→ **200**
  → **备案拦截按域名（Host/SNI）在任意端口生效**；3000 此前“不受影响”只是因为一直用 IP 访问。域名路径在未备案状态下彻底不可用，与端口和安全组无关（8443 放行属无效操作）。
- IP 证书路线不通：certbot 4.0.0 `certonly -d 8.166.126.136 --dry-run` 明确报 *"The Let's Encrypt certificate authority will not issue certificates for a bare IP address"*。
- 现状（可用入口）：`http://8.166.126.136:3000` 明文直连，功能完整（health/建房/曲库/Range 均 200/206）；`https://8.166.126.136:8443` 端口与 TLS 可用但证书域名不匹配，**App 不可用**（会被 Android 拒绝）。
- 可选路线（待用户决策，见陷阱 8.6 更正条目）：A 维持 IP 明文；B 私有 CA 自签证书 + App 内置信任（需改 App 重发 APK）；C 迁中国香港地域试用机（免备案，域名+正式证书可用，需重新部署）；D 转正式包年包月实例后备案（最正规，需付费+备案周期）。**注意试用额度按小时消耗、大陆地域免费流量仅 20GB/月**，路线 C/D 与额度约束一并考虑。
- **用户决策（2026-09-23 晚）：选路线 A——维持 IP 明文直连**（`http://8.166.126.136:3000`），TLS/域名达标留待正式部署（转正式实例备案或迁香港）时一并解决。决策依据：试用机无法备案 + 拦截按域名跨端口 + LE 不支持裸 IP；朋友小范围试用场景明文风险可控。
- 随之核对：后端直连公网时 `TRUST_PROXY=true` 是否可被伪造——`app.ts` 实现为 `trustProxy: '127.0.0.1'`（仅信任回环来源的 X-Forwarded-For），**直连客户端无法伪造，无需改动**。nginx 的 80/443/8443 配置与证书保留备用（不影响 3000 通路）；8443 安全组规则可自行关闭，关闭不影响任何功能。
- nginx 8443 监听与 80/443 配置保留（迁香港或备案后可复用），配置备份 /root/nginx-backup-8443 等可回滚。

## 本轮新增（并行开发推进方案，2026-09-23 晚）

- 新增 [并行开发推进方案](parallel-development-plan.md)：通读 verification/主计划/执行单/交接单/deployment/陷阱清单/模块索引后，把当前待办（T1 卡顿修复真机验收 → T2 公网 E2E → T3 升级/回滚演练 → T4 15 路云端重测，及 T5/T6 挂起项）组织为 7 条工作流 W1–W7。
- 核心结论：真机轨道（W1→W2）与云端轨道（W3→W4）可并行，唯一耦合是云端服务稳定性；**串行关键路径 = W1 真机验收 → W2 公网 E2E → W3 演练 → W4 15 路重测**，完成后 M4 四项门槛全部关闭。并列出 8 条冲突协调规则（云端服务所有权时间片、APK hash 锚定 36BD3A5B、verification 单写者、流量预算 C6、OOM 纪律 C7 等）。
- W3 拆分两段式：本地打包段可与真机任务零冲突并行；云端段（升级+真实回滚到 20260922-2159）须独占服务时间片。W4 前置 = demo-load.mp3 上传云端曲库（重启清房间，并入同一时间片）。
- 本轮为纯文档交付，未改产品代码、未执行构建/真机/云端操作；APK hash（36BD3A5B…）与全部既有验收结论不变。
- 文档检查：`scripts\check-doc-links.mjs` 通过（含新增链接）。

## 本轮新增（W1+W2 真机轨道，2026-09-23 晚）

> 本轮只做真机验收，**未改任何产品代码、未重建 APK**（hash 仍 36BD3A5B…）。详细证据见两份 test-results 记录。

- **W1 卡顿修复真机验收：通过**（[记录](test-results/2026-09-23-w1-recheck/README.md)）。**先纠正了一个前置偏差**：交接单称 36BD3A5B… 已装机，实测设备上是 169018AE746164D274E9C843AC8985A1DD27B647D6BF28DFA05110B705FB6845（安装于 2026-09-23 11:31），36BD3A5B 仅存在于本机产物目录；已 `adb install -r` 装机并回拉设备端 base.apk 复算 SHA256 锚定，否则本轮结论会挂错版本。
- W1 数据（PHQ110 / Android 14 / 本地演示后端 / 无线 adb）：① **关省电**（`low_power=0`）播放 40 分钟测试音 180s，media_session 位置推进 **1.001x**，诊断 300 条播放记录中 **`correction="seek"` = 0**（修复前为每 5 秒一次）、speed 0、buffering 仅起播 6 条、`|drift|` 中位 415ms、audio_flinger `empty=` 205s 内仅 +2；② **开省电**（`cmd power set-mode 1` → `low_power=1 sticky=1`）同曲 180s，**`speed` 变速追赶 9 条、`seek` 仍为 0**，media_session `speed` 字段实测 1.04 后回 1.00（变速生效直证），位置推进 1.004x——即"变速追赶替代 seek 风暴"在真机成立；③ **自动切歌**：30s→45s→40min 两次自然切歌，全段 `seek=0`、media_session 状态始终 PLAYING（无 BUFFERING），切歌后推进位置在同一个 5s 采样窗口内出现；④ **进度条端点**：像素实测手柄 **42px=14.0dp 圆点**、轨道 **15px=5.0dp**（density 480dpi，亮/暗两套一致），拖动落点比例与滑条 x 一致（11.8s → 1891.9s，恰一次合法 seek）；⑤ **暗色冷启动无白闪**：启动首帧即深色启动窗口（`values-night` 覆写为 `Theme.Material.NoActionBar`），连拍 9 帧无高亮帧；⑥ 听感由**用户本人确认"三轮都连续、无卡顿"**。
- **W2 M4 真机公网 E2E：通过**（[记录](test-results/2026-09-23-m4-public-e2e/README.md)），使用**同一 APK** 锚定版本。入口 `http://8.166.126.136:3000`（云端 release 20260922-2159、active、NRestarts=0、轻载 533/1735MB），PC 侧与**设备侧** curl health 均 `{"ok":true}`；全链路 建房(83888A9C)→选歌→播放→暂停→拖动→切歌→退出 全部命中，命令时间线 join/select/play/pause/seek/select/play/leave 对应房间 version 2→9；**公网校时 RTT 中位 65ms**（本地 18ms）、offset 极差 27ms、位置推进中位 998.9ms/s；诊断 `seek` 仅 2 条（大跨度拖动 + 切歌归零，非周期性）、`speed` 3 条、切歌后新段 `seek=0`；第二房间复测单曲（4EC9D5D1、"单车"）`seek=0`、RTT 中位 53ms；两房间均显式退出。执行期间**声明占用云服务时间片，未重启/升级/改曲库**，仅一次只读 SSH 查询。
- 新增开发陷阱回填：**2.9** shell 无法 `settings put`（system 要 WRITE_SETTINGS、global 要 WRITE_SECURE_SETTINGS，且失败时不报错只不生效→改 `cmd power set-mode`/`cmd uimode night` 并复核）、**2.10** `screenrecord` 在 PHQ110 段错误 rc=139 无文件（改连拍+ffmpeg 均值判据）、**3.5** 沙箱回收 adb server 会清掉 `reverse`，应用掉线横幅把布局下移约 324px 导致旧坐标必然点错（一次测试阶段必须同进程内完成、坐标必须当轮重 dump）、**3.6** Compose `input text` 长串只落首字符（地址一律写 `connection.xml`；`run-as` 下重定向 `>` 可用而 `sed -i` 静默失败）、**9.3** 采样"5 秒"实际间隔约 6s，速率只能取同源时间戳。
- 本轮边界（不得据此宣布通过）：**M2 双机**（缺第二台手机，未做）、**M3-LONG**（未做）、**第二种公网网络**（蜂窝未测：无线调试依赖 Wi-Fi，切蜂窝即断 adb）、TLS/域名（路线 A 明文）、真实令牌作废（无入口）、云端 15 路与升级/回滚（W3/W4，需各自独占服务时间片）、长播放用合成测试音（220Hz tone）、白闪取证为连拍（非逐帧）。云端轨道（W3/W4）已具备开始条件。

## 本轮新增（M4 升级/回滚演练，2026-09-23 晚）

> W3 云端轨道（T3）。**未改任何产品代码、未重建 APK**（hash 仍 36BD3A5B…）。完整证据与原始输出见 [test-results/2026-09-23-m4-rollback-drill](test-results/2026-09-23-m4-rollback-drill/README.md)。

- **两段式门禁**：等真机轨道报告 W2 通过（[记录](test-results/2026-09-23-m4-public-e2e/README.md)）后才启动段 2，并按协调规则 C1 声明/释放云端服务时间片（22:52 声明 → 22:57 释放）。段 1 本地打包在 21:57 与真机轨道并行完成，**全程未碰云端**（未上传、未重启、未改任何状态）。
- **段 1 制品**：`listen-together-0.1.0-20260923-2157.tar.gz`（11.4MB，打包前 tsc 0 错误）+ `SHA256SUMS-20260923-2157.txt`（35 行 = tarball + 34 包内文件）；tarball SHA256 `61e7eeb99ab152114f3f15b9786c3ffc72d30142f31b6b9d9eb92421fca08ce2` 与清单首行一致，解包后 **34/34 OK**；与在产包 `20260922-2159` 的 `server/` **20 个文件哈希全等**——"同代码新 ID"，上一版/下一版对照成立。包体由 20.5MB 降至 11.4MB 是陷阱 8.1 的 catalog 过滤生效（个人音频不再进包）。
- **升级成功**：scp 上传（7.7s）→ `releases/20260923-2157` 解包 + tarball/34 文件双层校验 → listen 账号 `npm ci`（112 包 3s）/ `npm run build`（tsc）/ `npm prune --omit=dev` **三关退出码全 0**（`available` 全程 ≥1154MB、**swap 用量 0**、无 OOM 迹象）→ 写 `current-version.txt`（`id=20260923-2157` + `prev=20260922-2159`）→ `ln -sfn` 切链接 → `systemctl restart`。22:55:44 **health 第 2 秒 200**，ExecMainPID 4191→**14935**，`WorkingDirectory=/opt/listen-together/server` 与 ExecStart 路径**保持不变**（符号链接方案的设计目标），NRestarts=0。
- **回滚成功（真实版本回滚，非"停用/恢复候选"）**：照抄第 5 节 `PREV=$(grep prev= /opt/listen-together/current-version.txt | cut -d= -f2)` → `20260922-2159` → `ln -sfn` → `restart`。22:56:01 **health 第 2 秒 200**，PID 14935→**15175**，NRestarts=0；公网 `http://8.166.126.136:3000/health` = `{"ok":true}`。**回滚读数取自版本文件而非手敲版本号，覆盖了真实运维路径**——这正是首次部署时"无上一版"而无法验证的部分。
- **13 项服务端抽查三次全过**：基线（切链接前，旧版本 20260922-2159）**13/0** → 升级后 **13/0** → 回滚后 **13/0**。覆盖 health / 建房取 64 位令牌 / catalog 200 与无令牌 401 / 音频全量 200（5,805,496B）/ `Range 0-1023`→206 `bytes 0-1023/5805496` / 后缀 Range→206 500 / 开区间→206 5,804,472 / 越界→416 / 音频无令牌 401 / WS 持令牌 open+sync 回 clock+state / WS 无令牌被拒 401 / 临时成员退出。**先跑基线的意义**：先证明"仪表"本身可用，升级后的失败才可归因。
- **两次重启丢房间（如实标注）**：服务端房间为进程内存态，升级与回滚**各清空一次全部房间**。已用**受控测试房间客观证实**（不是引用协议描述）：D611EE22、9BA71413 均 `catalog 200 → restart → 404「房间不存在或已过期」`。执行前经 health 200 + `ss` 端口 3000 **零条 ESTABLISHED** + journal（最近重启 12:05:26、其后 10h50m 无重启、无房间活动）三重确认无活跃房间，**未牺牲任何真实用户会话**；但约束必须随结论携带：**有人使用期间执行升级/回滚会造成全员掉线，需重新建房**（协议内行为）。
- **新 release 保留在服务器** `/opt/listen-together/releases/20260923-2157/`（含构建产物与清单副本 `SHA256SUMS.txt`）作为将来真实升级的候选；演练结束时 `server` 链接停在 **`20260922-2159`**（已知良好版本）。
- **新坑回填**：**8.7** PowerShell 生成的 SHA256SUMS 是 CRLF 行尾，而 GNU grep 的 `$` 锚点不匹配 CR → `grep '…$' 清单 | sha256sum -c -` **本地（MSYS grep）通过、服务器静默拿到空输入**并报 `no properly formatted checksum lines found`（注意 `sha256sum -c` 本身容忍 CRLF）；`package-deploy.ps1` 已改为输出 LF 清单并复跑验证（服务器 `grep 'tar\.gz$'` 由命中 0 行变为命中 1 行）。**8.8** 验收脚本硬编码演示曲目 `demo-soft`，云端曲库换成 5 首真实 MP3 后必然失败；`m4-deploy-verify.sh` 已改为从云端 `catalog.json` 动态解析抽查曲目（`TRACK_ID=` 可覆盖）与条数，13 项语义不变。
- **流量与纪律**：三次抽查全部走服务器本地回环（含两次各 5.8MB 音频），scp 为入向，**公网出网流量仅几 KB**；全程 ssh 只用 `free -m` / `journalctl -n` / `systemctl show` / `ss` 等轻量命令，**未在服务器跑任何重负载、未使用 VS Code Remote**（陷阱 8.5 的 1.7Gi OOM 教训）。
- 本轮边界（不得据此宣布的）：新版本与在产版本**同源**（`server/` 20 文件哈希全等，刻意为之），故本轮**不能证明**"新代码有缺陷时回滚能恢复功能"这一更强命题，需要一次带**实质代码差异**的真实升级；**未做升级失败注入**（故意坏 dist / 缺依赖后 systemd 的行为未取证）；无零停机与健康门禁，升级窗口约 1–2 秒不可用（单实例内存态服务的既定形态）；`media/` 持久层与 `/etc/listen-together.env` 不随版本切换，其"数据/配置回滚"未演练；入口仍为 IP 明文（TLS 路线 A）；真实令牌作废仍无入口（后端无入口）。

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
- [x] 公网验证：绑定 0.0.0.0 + 安全组放行后，真机经 `http://8.166.126.136:3000` 完成建房→选歌→播放→暂停→拖动→切歌→退出全链路（2026-09-23 晚，APK 36BD3A5B…，见 [test-results/2026-09-23-m4-public-e2e](test-results/2026-09-23-m4-public-e2e/README.md)）。**部分覆盖**：只测了 Wi-Fi 出口这一种公网网络；第二种（蜂窝）未测——无线调试本身依赖 Wi-Fi，切蜂窝会断 adb 链路，需 USB 有线调试或第二台手机才能补。TLS/域名按路线 A 维持明文（见上文 TLS 结论）。
- [x] W1 卡顿修复真机验收（APK 36BD3A5B…，2026-09-23 晚，无线 adb）：关省电 180s 位置推进 1.001x 且诊断 `seek=0`；开省电出现 `speed` 变速追赶 9 条、`seek` 仍 0；自动切歌两段零 seek、无连环 seek；进度条端点像素实测 14dp 圆点/5dp 轨道（亮暗一致）、拖动恰一次合法 seek；暗色冷启动首帧即暗色启动窗口无白闪；听感由用户确认连续。见 [test-results/2026-09-23-w1-recheck](test-results/2026-09-23-w1-recheck/README.md)。
- [ ] 公网弱网/丢包/抖动条件下的真机表现（未测；fault-proxy 注入此前只在本地用过）。
- [x] 版本回滚演练：首次部署时"仅具备停用/恢复候选条件"的缺口已关闭——升级到 `releases/20260923-2157` 后按 [deployment.md](deployment.md) 第 5 节回滚命令切回 `20260922-2159`，两次 health 第 2 秒 200、PID 4191→14935→15175、`WorkingDirectory`/ExecStart 路径不变、NRestarts=0，13 项抽查"基线/升级后/回滚后"均 **13/0**（2026-09-23 晚，见 [test-results/2026-09-23-m4-rollback-drill](test-results/2026-09-23-m4-rollback-drill/README.md)）。**两次 restart 各清空一次内存房间**，已用受控房间实测 `200 → 404`；执行前确认无活跃房间，未影响真实会话。新 release 保留在服务器作为将来真实升级候选。
- [ ] 15 路实际音频带宽在云端重测（LOAD-15 云端部分，归 M4；云端时间片已由升级/回滚演练释放，具备开始条件）。

## 测试记录入口

- [2026-09-21 PHQ110 真机播放测试](playback-test-2026-09-21.md)：含完整操作过程、状态采样、问题处理和结论边界。

- [2026-09-22 M4 首次部署与隧道联调](test-results/2026-09-22-m4-first-deploy/README.md)：服务端 13/13 + 隧道 9/9，含部署后基线、SHA256 校验、纠偏与清理记录。

- [2026-09-23 W1 卡顿修复真机验收](test-results/2026-09-23-w1-recheck/README.md)：关/开省电各 180s 采样与诊断 seek/speed 分布、自动切歌、进度条端点像素实测、暗色冷启动与听感确认。

- [2026-09-23 W2 M4 公网 E2E](test-results/2026-09-23-m4-public-e2e/README.md)：公网全链路七步 + 命令时间线、RTT/校时/version 实测、云端只读状态、第二房间复测。

- [2026-09-23 M4 升级/回滚演练](test-results/2026-09-23-m4-rollback-drill/README.md)：两段式（本地打包 + 独占云端时间片）；升级/回滚双向证据、13 项抽查三次全过、受控房间实测"重启清空内存房间"、CRLF 清单与验收脚本两处新坑、原始输出归档。

下一批任务的执行步骤与报告字段见 [执行单](execution-plan.md)。
