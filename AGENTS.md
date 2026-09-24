# AGENTS · 开发会话指南

本项目用 AI 辅助持续开发。任何新会话（包括中断后恢复）从本文开始，按顺序读少量文档即可继续，无需重读整个项目。

## 恢复开发的标准入口（按序阅读，总计约 600 行）

1. `docs/verification.md` —— **进度唯一事实来源**。"本轮完成/本轮新增"是最近交付，"尚待验收"是待办清单。
2. `docs/next-development-plan.md` —— M0-M4 路线图、当前任务顺序、验收标准。
3. `docs/modules/README.md` —— 模块索引；改动哪个模块就读对应 `docs/modules/<编号>.md`（含已实现/待开发分界）。
4. `docs/development-pitfalls.md` —— **开发陷阱清单**：实际踩过的坑与规避方法（编码、adb、UI 自动化、Compose、协程测试）。动手前通读，踩到新坑必须回填。

历史证据按需查：`docs/test-results/<日期-场景>/README.md`（17 个场景目录，完整索引见 verification.md「测试记录入口」）；使命完结的一次性历史文档在 `docs/archive/`（播放测试 2026-09-21、W1/W2 交接单 2026-09-23）。

## 当前进度快照（2026-09-25 反馈二小轮，以 verification.md 为准）

- **反馈二小轮（2026-09-25，无新 hash）**：按用户指示「去掉房间号显示，去掉保存长图功能，其它部分放弃验证，实现功能就行不需要测试」——①TopBar 房间页不再显示房间码胶囊，与入房页统一为「一起听歌」（房间码仅存于邀请口令文本与加入前确认卡）；②`ui/PlaylistImage.kt` 整文件删除，MainActivity 移除 exporter 装配与歌单标题行按钮（无关联单测）。仅 compileDebugKotlin 确认通过；单测/Lint 未跑（用户指示免测）。**APK 已于 09-25 单独重建装机：C685CE0A…（仅 assembleDebug）**。③试用反馈轮真机验收终止补验：已实测通过通知栏/展开页上一首下一首环形切歌（Bug④ 修复成立，公网 23 首）、顶栏无复制图标/房主标注、无搜索框、口令文本无 :3000；成员 Snackbar、粘贴重入同房未验即关闭，保存长图场景随功能删除作废（见 test-results/2026-09-24-feedback-round）。
- **试用反馈轮（2026-09-24 夜，APK 011DD835…）**：①通知栏/蓝牙上一首下一首修复——根因是 ForwardingSimpleBasePlayer 透传单条目 ExoPlayer 可用命令（无 NEXT、PREVIOUS 被 ExoPlayer 实现为 rewind，根本到不了 handleSeek）；覆写 getState() 追加命令、handleSeek 路由到新增 `sync/TrackQueue.skip(±1)` 环形回绕纯函数（房主 select，成员 Snackbar 拒绝）；PlayerSheet 标题行同步加切歌钮。②顶栏去复制图标与「房主」标注，房间码胶囊只读化（09-25 进一步整体移除）。③歌单搜索整体移除（PlaylistFilter 与 9 项单测删除，长图导出全量歌单；长图后于 09-25 删除）。④口令 encode 剥掉约定端口 `:3000`，`RoomClient.join` 对无端口 URL 补回 3000（显式 :8080 等非默认端口保留，两向 round-trip 有单测）。⑤云端曲库按反馈移除 demo-load（23 首，备份 media-originals/20260924-221628/，m4-deploy-verify 14/14）。单测 **74 项** cleanTest 实跑全过、Lint 0。新坑回填陷阱 9.4（media3 可用命令透传）/9.5（kotlin.math.floorMod 不存在）/8.10（曲库启动加载、改后必须重启）。
- **UI 重构轮（2026-09-24 晚）**：入口页收拢为「标题区+单卡片表单」（删欢迎大卡）；播放器常驻底部（新 `ui/RoomPlayer.kt`：MiniPlayer + ModalBottomSheet 展开页，RoomPlayerState 挂房间作用域，seek 确认模型原样迁移）；成员区压缩为头像堆叠单行；歌单当前曲行播放中显示动效条。未改 server/、网络层与行为约定；73 项单测 cleanTest 实跑、Lint 0；APK 6C231394…（已被 011DD835 覆盖）；PHQ110 真机 10 项场景验收通过，证据见 docs/test-results/2026-09-24-ui-refresh。
- **M4 四项部署门槛已全部关闭（2026-09-23 晚）**：①首次部署+13 项服务端验证+隧道联调（09-22）；②真机公网 E2E 建房→播放全链路（W2，APK 36BD3A5B…）；③升级/回滚演练双向通过（W3，13 项抽查三次各 13/0）；④LOAD-15 云端公网重测通过（W4：15 路×600s 全 206 零失败、2.847Mbps=本地基线 99.1%，见 docs/test-results/2026-09-23-load15-cloud）。云端曲库现为 23 首真实音乐（96.5 分钟，192k；demo-load 已按试用反馈移除，备份在 media-originals/，负载重测需先恢复——陷阱 8.10）。入口维持 `http://8.166.126.136:3000` 明文 IP 直连（路线 A，试用机无法备案）。
- **本轮工具与文档轮（2026-09-24，纯工具/文档、无新 hash）**：Q-2 `scripts/check.ps1` 安卓段改为 `:app:cleanTestDebugUnitTest :app:testDebugUnitTest`（Gradle 会把输入未变的测试判 UP-TO-DATE 跳过实跑，门禁"通过"其实是上一轮结论），并顺带按陷阱 1.5/1.6 在脚本内收窄 EAP、只认 `$LASTEXITCODE`；E-06 README「行为约定」新增明文边界（IP 明文 HTTP、令牌可被窃听、无撤销机制、正式使用须 TLS/域名）；A-02 轻量版 docs/protocol.md 追加 JSON Schema + `server/test/protocol.test.ts`（从文档提取 schema 校验真实消息，`additionalProperties:false` 抓实现漂移，最小校验器无运行时依赖）。后端测试 **18→20 项**；`-Scope all` 全过（后端 20/20、安卓 53 项本轮实跑、Lint 0、链接通过）；APK 锚 **E814F90E…** 不变。
- **后端防线已上云（2026-09-24 上午，release 20260924-0937）**：E-05 `/ws/:code` 握手限连（令牌+来源 IP，10 秒 5 次，超出 429 拒绝升级；阈值高于 1/2/4/8/16 秒退避）；E-09 建房存量配额（Room 记 creatorIp，同 IP 活跃房间 ≤3，超出 429，空房 5 分钟回收即释放）；Q-3 结构化排障事件（room/member/host/ws 事件，无令牌与昵称）+ `/health` 返回 `{ok,rooms,onlineMembers,wsConnections}`；Q-4/Q-5 后端测试 7→18 项。部署证据：解包 42/42 校验、基线 13+SKIP → 新版 **14/14**、E-05 `open×5→429`、E-09 `200,200,429,429` 终态 rooms=3、journal 事件与 `ws.handshake_rejected` 实证、error 计数 0；prev=20260922-2159 未动用。APK 锚 E814F90E… 不变（本轮未改 Android）。`m4-deploy-verify.sh` 14 项（health 字段解析 + 建房配额预检，连续重跑看陷阱 8.9）。
- **客户端缺陷修复（2026-09-24）**：A-01 PlaybackService 会话代次守卫（applyState/onPlayerError/循环/焦点四处加代次检查）；E-07 seek 乐观预览确认条件过松修复（改用相对推进量确认）；Q-1 新增 DiagnosticsLogTest 8 项 JVM 单测。53 项单测 + assembleDebug + Lint 0 通过；APK **E814F90E…**。真机验收待设备在线。
- **收尾汇总（2026-09-24）**：scripts/check.ps1 -Scope all 全过（后端 tsc 0 错误 + 7/7 测试；安卓单测 45 项 UP-TO-DATE + assembleDebug + Lint 0；文档链接检查通过）；APK 锚定 **36BD3A5B…** 不变（该轮未改产品代码、未重建 APK）；并行开发方案 W1–W4 已全部标注完成（T1–T4 清零）。
- **文档结构优化（2026-09-24）**：verification.md 重建为"当前状态+索引"结构（33 个历史小节压缩为交付历史索引与 APK 版本历史两张表）；execution-plan.md 并入主计划与开发规范后删除、learning.md 并入模块索引后删除；handover-2026-09-23.md 与 playback-test-2026-09-21.md 归档至 docs/archive/；并行方案压缩已完成工作流。
- 其余此前完成项（M0/M1/M3 各项、W1 卡顿修复真机验收等）见 verification.md 各节。
- **下一步**：
  - 试用反馈轮 + 反馈二小轮的收尾门禁（APK 已重建装机 C685CE0A…，但单测/Lint 门禁未跑）——下轮动 Android 时随改随补，不再安排真机补验（用户已指示终止）；
  - M2 双机同步——缺第二台手机，设备到位后按主计划验收（W5）；
  - TLS/域名正式化——用户已决策路线 A（试用期维持 IP 明文），转正式实例备案或迁香港时一并解决（W7）；
  - 真实令牌作废（后端无入口）、公网弱网注入真机测试——条件具备时补测。
- 日常入口：转入试用反馈驱动的修复循环或 0.2.0 收尾。

## 常用命令（Windows PowerShell）

```powershell
# 后端（演示曲库）
cd D:\ListenTogether; .\scripts\start-demo.ps1        # 前台窗口，Ctrl+C 停止
# 健康检查
Invoke-WebRequest http://127.0.0.1:3000/health

# 安卓构建 + 单测 + Lint（cleanTest… 保证单测本轮实跑，不加会被 Gradle 判 UP-TO-DATE 跳过）
cd D:\ListenTogether\android
.\gradlew.bat :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug

# 真机联调（PHQ110；USB 或无线，多设备/多 transport 时加 -Serial）
cd D:\ListenTogether; .\scripts\install-debug.ps1     # 装 APK + USB 转发 + 启动 APP
# 无线调试（免 USB，USB 抖动时首选；配对→连接→reverse 必须一次做完，见陷阱清单 2.7）
cd D:\ListenTogether; .\scripts\connect-wireless.ps1 -DebugHost <IP:调试端口> -Port 3000,3001 -Install -Verify
# 手机端诊断日志：adb shell run-as com.listentogether.app ls files/diagnostics/
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
```

## 环境备忘

- 构建：JDK 17、Android SDK Platform 35、Build Tools 35.0.0、Gradle 8.11.1（wrapper 自动下载）。
- 后端：Node.js 24 / TypeScript / Fastify；依赖用 `npm ci`；演示后端用 demo-media 合成曲库。
- 真机：PHQ110（OPPO），地址填 `http://127.0.0.1:3000`（依赖 adb reverse）；后端重启会丢失房间（内存态）。
- 后台运行的演示后端日志在 `demo-backend.log`。
- 负载/注入脚本：`node scripts/load15.mjs --model playback --duration 600 --bitrate 192`（成员必须持 WS，勿删该逻辑）；`node scripts/fault-proxy.mjs --port 3001` + `/__fault/{delay,cut,audio401,clear}`。
- 长时后台任务用 `Invoke-CimMethod Win32_Process Create` 启动（工具超时会杀子进程树，见陷阱清单第 6 节）；注意 WorkBuddy 会话内 CIM 进程创建可能被安全策略拦截，SSH 隧道等长任务可改用后台任务方式挂起、收尾 TaskStop。
- 交付 APK 的 SHA256 每轮记入 verification.md，历史 hash 保留在同一节。
- 云端：`ssh aliyun`（8.166.126.136，root，密钥登录）；部署基线 /opt/listen-together（releases/<id> + server 符号链接 + media 持久层），`systemctl status|restart listen-together`；升级/回滚命令见 docs/deployment.md 第 5 节；后端重启丢失内存房间。

## 开发规则（详见 docs/development-standards.md）

- 代码、单元测试、模块文档、verification.md 必须在同一次交付中同步更新；不得用"代码已写完"替代验收。
- 踩到新坑立即回填 docs/development-pitfalls.md（现象→根因→规避），同类问题不允许出现第二次。
- 代码与文档注释使用中文；核心接口写时钟域/单位/线程/失败行为；不加逐行翻译式注释。
- 行为约定以 README"行为约定"与 docs/protocol.md 为准：单进程、内存房间、服务端为播放唯一来源、明确点击播放才能解除本机暂停。
- 测试分层见 docs/modules/10-testing-observability.md：纯单测不访问公网；真机结论必须附操作步骤与实测数据。
- 双机相关验收在没有第二台手机时保持挂起并显式标注。
