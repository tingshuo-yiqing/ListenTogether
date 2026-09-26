# AGENTS · 开发会话指南

本项目用 AI 辅助持续开发。任何新会话（包括中断后恢复）从本文开始，按顺序读少量文档即可继续，无需重读整个项目。

## 恢复开发的标准入口（按序阅读，总计约 600 行）

1. `docs/verification.md` —— **进度唯一事实来源**。"本轮完成/本轮新增"是最近交付，"尚待验收"是待办清单。
2. `docs/next-development-plan.md` —— M0-M4 路线图、当前任务顺序、验收标准。
3. `docs/modules/README.md` —— 模块索引；改动哪个模块就读对应 `docs/modules/<编号>.md`（含已实现/待开发分界）。
4. `docs/development-pitfalls.md` —— **开发陷阱清单**：实际踩过的坑与规避方法（编码、adb、UI 自动化、Compose、协程测试）。动手前通读，踩到新坑必须回填。

历史证据按需查：`docs/test-results/<日期-场景>/README.md`（29 个场景目录，完整索引见 verification.md「测试记录入口」）；使命完结的一次性历史文档在 `docs/archive/`（播放测试 2026-09-21、W1/W2 交接单 2026-09-23）。

## 当前进度快照（2026-09-26 晚：设备复测 517A776B 闭环 + 后端上云 20260926-1822，以 verification.md 为准）

- **后端已上云（2026-09-26 晚，本轮最新，release 20260926-1822）**：09-26 后端修复（清扫清空 hostId + 首个上线成员立即接任）随打包上云；prev=20260924-0937 保留可回滚。打包 tsc 0 错误 → scp → 解包 **42/42** 校验 → listen 账号构建干净 → 符号链接切换 + restart（清内存房间，用户已授权）。旧版基线与新版 `m4-deploy-verify.sh` 均 **14/14**；**专项验证**：HostA 掉线 75s 被清扫 → MemberB 加入首份状态即 `hostId=MemberB`（hostIsB: true）。设备端对新后端入房冒烟未做（第三次 USB 掉线，如实标注）。证据：[2026-09-26 云端部署](docs/test-results/2026-09-26-cloud-deploy/README.md)。
- **设备复测（2026-09-26 傍晚）**：用户恢复提供真机（USB），debug `517A776B…` 装机 PHQ110（`pm path` 回拉一致；首次回拉因 `adb pull` 静默截断不匹配，重拉后逐位一致——装机核对必须同时看字节数与哈希，陷阱 2.15）。云端（当时旧后端 release 20260924-0937）+ 23 首真实曲库全部通过：冷启预填、播放全链路（`dumpsys` PLAYING、1.0x）、**seek 三场景（拖回开头/拖中间/快速连拖）全部确认无假横幅（修复①闭环）**、展开页/环形切歌/暂停恢复、二维码反解 + 用户相机扫码入房、`member-sim` 成员进出、**过期横幅→「重新加入房间」房主侧闭环且 24 字符昵称原样（修复②闭环）**、24 码元昵称边界（表单输入即截断、恰 24 建房/重入均过）、空房回收内联报错。**断网手段约束（用户指示）：不得关闭热点、不得再开飞行模式**——飞行模式会连带关热点，已弃用；后续复现「断网 60s+ 清扫」改用 `svc data disable`（仅断蜂窝数据，陷阱 2.16）。未覆盖如实标注：双人真机同屏、触感手感/大字号/小屏/弱网注入。证据：[2026-09-26 设备复测](docs/test-results/2026-09-26-device-retest/README.md)。
- **本地审计收尾（2026-09-26 下午）**：seek 确认窗口改单调时钟（`elapsedRealtime`，墙钟差值会被系统对时跳变扭曲，陷阱 9.7；判定抽纯函数 `seekConfirmed`，SeekConfirmTest 4 项）；过期横幅「重新加入房间」改经 `composeNickname` 合成昵称（≤24 码元）。后端 23/23、安卓 **96/96** 实跑（上轮 91 按文件口径少计 1，真实基线 92）、Lint 0、Debug/R8 构建通过；debug `517A776B05C30EEBF2E7A0E2B68FE315F959748F0C3C8057FC20B975B69D98A3`（**已装机并真机复测**）/ benchmark `764D0FE19B27DEC71EA629115297CE1D74911DF1E782F775A2282F149239F1B8`（未装机）。证据：[legacy-fixes 补充小轮](docs/test-results/2026-09-26-legacy-fixes/README.md)。
- **遗留逐项修复（2026-09-26）**：邀请提示改扫码/手动入房、解析拒绝长码截断；全员清扫清空房主 + 首次上线立即接任；倍速 load/seek/暂停真正写回播放器、删除重复缓存；修复旧 dump 采样并撤回 PlaybackView 确定性归因（三张原截图显示正常）。后端 23/23、安卓 91/91、脚本 3/3、Lint 0、Debug/R8 构建通过；debug `EC5FCF0A987D10087CE88CEC228CF4509CDCC5B4E6D06E0CC79662005A4C4870` / benchmark `F943E3CA4942B84E23169CF0927A07BE11D607329F27DA86B27225F894E2438B`，均未装机。其中后端修复**已于同日晚部署上云（20260926-1822，见上方新条目）**；缺设备、TLS、新功能项保持边界。证据：[legacy-fixes](docs/test-results/2026-09-26-legacy-fixes/README.md)。
- **历史轮次摘要（2026-09-23 ~ 09-26 凌晨，均已闭环，详述见 verification.md「交付历史索引」与 docs/test-results/）**：①界面收拢——单卡片表单、常驻 MiniPlayer + PlayerSheet、成员头像堆叠、顶栏统一「一起听歌」；批次 A 的房间动态流（`ui/RoomActivity.kt`）、伪封面（`ui/TrackArtwork.kt`）、入房头像选择器、歌单搜索（`PlaylistFilter`）、保存长图（`ui/PlaylistImage.kt`）已按试用反馈**全部删除，对应文件不复存在**（勿按旧记录去找），界面现状以 [模块 01](docs/modules/01-android-ui.md) 为准。②能力闭环——邀请口令编解码（剥 `:3000`、绝不含令牌）+ 二维码邀请、通知栏/展开页环形切歌（`TrackQueue.skip`）、入房输入恢复与 Expired「重新加入房间」、`benchmark` 性能变体。③后端两波上云——09-24 release 20260924-0937（E-05 握手限连 / E-09 建房配额 / Q-3 事件与 health 计数），09-26 release 20260926-1822（见首条）。④M4 四项部署门槛全部关闭（09-23）；云端曲库 23 首真实音乐（demo-load 已移除、备份 media-originals/，负载重测需先恢复——陷阱 8.10）；入口维持 `http://8.166.126.136:3000` 明文 IP（路线 A，试用机无法备案）。⑤**滚动帧耗时结论只认 R8 包口径**（0.16%–0.77%）；debug 包数据（27.27%/13.38%）不可外推到用户构建。
- **下一步**：
  - **设备已装机 `517A776B…`（09-26 傍晚真机复测通过，见上方新条目）**：seek 单调时钟与过期重入两修复已闭环；本轮复测还顺带覆盖了相机扫码入房（用户人工）与 `member-sim` 成员进出。仍挂起的设备项：双人真机同屏（缺第二台）、空歌单、2 倍系统字号、小屏布局、emoji/代理对昵称目视（`input text` 打不进非 ASCII）、快滑中切歌、触感人工手感。
  - **播放态历史疑点已重新定性**：旧 dump 采样不可靠，17/18/19 原截图显示「播放中」；不再视为已证实的 PlaybackView 缺陷。脚本已修，未来本机状态/歌词需独立验证。
  - 批次 B（可选，未开始）表情互动 reaction——需新增 WS 消息 + 服务端广播 + 云端部署窗口（restart 清房间），属协议扩展，动手前先定协议与 `protocol.test.ts` schema；
  - 第一版歌词方向已定案未开工（曲库 ID 绑定 LRC、本机位置驱动逐行高亮、手动翻看暂停跟随 + 「回到当前歌词」、只用人工维护的授权来源），详见 `docs/next-development-plan.md`「歌词功能建议方案」一节；歌词时间轴的实际位置、缓冲和 seek 须独立验证，旧 dump 证据不能预判其必然失败。
  - M2 双机同步——缺第二台手机，设备到位后按主计划验收（W5）；好友互动的单机验收已由 `scripts/member-sim.mjs` 覆盖，双机项仍需真机；
  - TLS/域名正式化——用户已决策路线 A（试用期维持 IP 明文），转正式实例备案或迁香港时一并解决（W7）；`benchmark` 变体是本机测试专用、不分发，正式 release 继续拒绝 HTTP；
  - 真实令牌作废（后端无入口）、公网弱网注入真机测试——条件具备时补测。
- 日常入口：试用反馈驱动的修复循环，或批次 B / M2 / 歌词条件成熟时推进。

## 常用命令（Windows PowerShell）

```powershell
# 后端（演示曲库）
cd D:\ListenTogether; .\scripts\start-demo.ps1        # 前台窗口，Ctrl+C 停止
# 健康检查
Invoke-WebRequest http://127.0.0.1:3000/health

# 安卓构建 + 单测 + Lint（cleanTest… 保证单测本轮实跑，不加会被 Gradle 判 UP-TO-DATE 跳过）
cd D:\ListenTogether\android
.\gradlew.bat :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
# 性能变体（R8 已 shrink/minify、isDebuggable=false、包名后缀 .benchmark、仅此变体允许 HTTP；帧耗时基准用它，本机测试专用不分发）
.\gradlew.bat :app:assembleBenchmark   # 安装要 adb install --no-streaming
# 注意：该包 `run-as` 会被拒、`am start -n <包名>/.MainActivity` 因后缀报不存在，取证改用 dumpsys media_session / gfxinfo / 截图（陷阱 2.14）

# 真机联调（PHQ110；USB 或无线，多设备/多 transport 时加 -Serial）
cd D:\ListenTogether; .\scripts\install-debug.ps1     # 装 APK + USB 转发 + 启动 APP
# 无线调试（免 USB，USB 抖动时首选；配对→连接→reverse 必须一次做完，见陷阱清单 2.7）
cd D:\ListenTogether; .\scripts\connect-wireless.ps1 -DebugHost <IP:调试端口> -Port 3000,3001 -Install -Verify
# 手机端诊断日志：adb shell run-as com.listentogether.app ls files/diagnostics/
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

# 脚本成员（单机验收好友互动：加入/掉线/回来/离开；成员必须持 WS）
cd D:\ListenTogether; node scripts/member-sim.mjs join <房间码> "脚本小王" --hold 20 --target http://8.166.126.136:3000
# 房间码不在界面显示：从设备诊断 JSONL 或云端 journalctl 的 room.created 事件取
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
