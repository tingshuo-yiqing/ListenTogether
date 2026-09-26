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
- **夜轮装机验收 + 界面提示精简（2026-09-25 深夜 → 09-26 凌晨，终稿 debug `BCF3DE16…` / benchmark `9E17F291…`，未装机）**：夜轮（入房恢复 / 二维码邀请 / `benchmark` 性能变体）此前只有构建记录，本轮补齐门禁与可做的真机场景后按用户指示精简文案收尾。**用户已明确此后无法提供真机**，故未覆盖项如实挂起而非强行补验。①门禁首轮失败：`PermissionImpliesUnsupportedChromeOsHardware`——扫码加了 `CAMERA` 权限却缺 `<uses-feature android:name="android.hardware.camera" android:required="false"/>`；补声明 + 清 2 条 `UseKtx`（二维码位图改 `androidx-core` 的 `createBitmap`/`set`）后 **86 项单测 cleanTest 实跑全过、Lint issues=0**。②装机（debug `9C480583…`、R8 benchmark `08607981…` 2.4MB vs debug 23MB，均 `pm path` 回拉 SHA256 逐位一致）通过 6 项：冷启不静默入房 + `lastRoom` 预填、`cmd uimode night yes` 强制重建后 `JoinInputSaver` 表单不丢、Expired 横幅「重新加入房间」换发新令牌、房间被回收后再入房内联报错且内容保留、邀请二维码对设备截图独立反解与 `InviteCode.encode` 行/字符逐位对应（已剥 `:3000`、无令牌）、benchmark 接受 HTTP 且建房选歌播放全链路（`dumpsys media_session` PLAYING + 位置前进）。③**滚动帧耗时同条件 A/B（关键结论）**：播放中同脚本同曲目，R8 快滑 777 帧掉 6 **0.77%**、带 1s 停顿 616 帧掉 1 **0.16%**（P95 14/16 ms），同源码 debug **7.66% / 2.08%**（P95 34/25 ms）——**上一轮记在 debug 包上的 27.27%/13.38% 不能外推到用户实际拿到的 R8 构建**，给用户的构建里歌单掉帧已在 1% 量级。④旧采样曾报告播放文案不一致，**09-26 复核撤回对 PlaybackView 的确定性归因**：脚本忽略 dump 失败、可能重读旧树，三张原截图实际均显示「播放中」；取证脚本已修，缺设备不作新真机结论。⑤**界面提示精简（用户指示）**：删 `playbackLabel` 纯函数与 MiniPlayer 副标题、展开页「当前歌曲 + 状态」行、「播放与暂停同步给所有人…」说明行，`PlaybackView` 只留 `mediaId`/`failed`，`MiniPlayer`/`PlayerSheet` 去掉 `playback` 参数；保留状态横幅（含重试/重新加入/退出）、歌单当前曲高亮 + `PlayingIndicator`、播放键图标。单测 86→**84** 实跑、Lint 0。新坑回填陷阱 **2.13**（同机两包测不了双人：ColorOS 后台断网 + 60 秒清扫，改走"单机 + `member-sim` + 本机后端"，且该链路是失效路径免费复现器）/**2.14**（`isDebuggable=false` 拒绝 `run-as`；`applicationIdSuffix` 使 `am start -n <id>/.MainActivity` 报不存在）/**3.7**（`input text` 打不进非 ASCII、URL 的 `://` 被两层引号吞、多行框清空要 `MOVE_HOME`+`FORWARD_DEL`）/**2.9 补充**（验 `rememberSaveable` 用 `cmd uimode night yes|no` 强制重建）/**5.6**（加权限与跑 Lint 必须同轮）/**5.7**（`grep -c "<issue"` 把 `<issues>` 数成 1 条）/**1.7 补充**（后台包装器必须回写 Gradle 退出码，否则 `BUILD FAILED` 被 `tail` 的 0 掩盖）。证据：[night-acceptance](docs/test-results/2026-09-25-night-acceptance/README.md)。
- **歌单滚动与界面精简（2026-09-25 晚，APK 80CF7629…，已装机）**：按用户反馈（"滑动延迟"专指上下滑动歌单）重构列表区——**批次 A 的房间动态流（`ui/RoomActivity.kt`）、伪封面（`ui/TrackArtwork.kt`）、首页头像选择与偏好读取/保存、歌曲首字封面已全部删除，对应文件与专属单测不再存在**（勿按上一条描述去找它们，`ui/DisplayName.kt` 与 `ui/MemberAvatar.kt` 保留）；歌单改为圆角面板（固定标题/数量 + 中间曲目独立滚动 + 底部播放器常驻）、序号替代重复音符、当前曲目高亮；`PlayingIndicator` 从组合阶段改高度改为固定尺寸 + Canvas 绘制期读值（只重绘不重测），切歌跟随在用户滑动时让路。86 项单测实跑、Lint 0、PHQ110 布局截图确认；当时的快滑 27.27% / 带停顿 13.38% 是 **debug 包口径**，已由下一条夜轮 A/B 澄清为不可外推。证据：[playlist-feedback](docs/test-results/2026-09-25-playlist-feedback/README.md)。
- **0.3.0 批次 A「一起听体验轮」（2026-09-25，APK D882D186…，已装机并真机验收）**：全部 Android 客户端、**零协议改动**——①房间动态流：新增 `ui/RoomActivity.kt`，纯函数 `RoomActivity.derive(previous, current, tracks, everOnline)` 对连续快照差分出"加入/离开/上下线/房主转移/换曲/播放暂停"（首帧不产生事件；离线 60 秒后被移除不再补报"离开"；同帧换曲不报播放态；**"在线"要求该成员此前被见过在线**——服务端 `add()` 先广播 offline、`connect()` 才置 online，否则每个新人都会刷出假的"回来了"，此缺陷在核对 store.ts 时自查发现并已修），成员区折叠行显示最近一条（仅保留 10 分钟内的，更早的淡出）、展开为「房间动态」时间线（最近 8 条 + 相对时间，每 30 秒刷新）；订阅走 `RoomClient.state` 原始快照而非 `screenStates()`（后者按 500ms 去重会丢中间帧）。②伪封面：新增 `ui/TrackArtwork.kt`（稳定取色 + 首字素，MiniPlayer 44dp 缩略图，PlayerSheet 改 180dp 封面居中 + 整页可滚动）。③歌单跟随滚动（`rememberLazyListState` + 切歌 `animateScrollToItem`，已在屏内不打扰、越界放弃）。④触感与无障碍（播放/切歌用轻触感 `TextHandleMove`、拖动结束保留 LongPress；MiniPlayer 由手势改 `clickable` 以便读屏；成员区改 `clickable(onClickLabel)` + `stateDescription`、头像圆片 `contentDescription` + `selectableGroup()` + 48dp）。⑤头像 emoji：新增 `ui/DisplayName.kt`（按码点/字素簇取字符，ZWJ 组合与地区指示符整体取回），约定"昵称首字素是 emoji 即头像"，入房表单选择器 + `composeNickname`（≤24 码元，与服务端校验一致），偏好存 `ConnectionStore.loadAvatar/saveAvatar`（接口默认实现，测试替身无需改）。新增 26 项单测（RoomActivityTest 13 + DisplayNameTest 10 + AvatarGlyphTest 3），**单测 74→100 项 cleanTest 实跑全过、Lint issues=0（报告先删再生，避免引用上一轮）、docs 链接检查通过**。因无设备，另起**独立复核**替代真机质量关：结论无阻断项，查出并修掉 9 处（既有缺陷 `rememberRoomPlayer` 只以 client 为 key → 换房后新房假报"未确认，请重试"，已改为按 token 重建；动态时间线改 `rememberSaveable` 以跨旋转/深色重建存活并返回 `State` 限定重组范围；成员区读屏文本被箭头图标盖掉 → `clickable(onClickLabel)` + 图标描述置空；末曲自然播完文案改"播放已暂停"；昵称改按码点截断 `takeCodePoints` 免切代理对；点击类触感改 `TextHandleMove`、拖动保留 LongPress；头像圆片 44→48dp 且加 `selectableGroup()`；两处失真注释）。**（该轮当时无设备，6 项场景先挂起；当天下午设备到位后已全部跑完，见下条）**；开工时先补跑门禁，得到与 09-25 装机锚 C685CE0A… 逐位一致的 APK，反馈二小轮的门禁欠账已关闭。新坑回填陷阱 4.6（`take(1)`/`take` 截断 emoji 代理对）/4.7（`remember` 的 key 漏了会话/配置维度）/1.7（Gradle 输出采集）/5.5 补充（`lintReportDebug UP-TO-DATE` 时磁盘报告可能是上一轮的）/第 7 节（替换吃掉行尾换行并合并两行 import，本轮真实踩到两次）。
- **批次 A 真机验收（2026-09-25 下午，PHQ110 / Android 14 / 云端后端）**：6 项场景通过，**真机抓到并修复 1 处回归**——`ModalBottomSheet` 默认半屏锚点让进度滑条/时间/说明落在屏幕外（独立复核曾预判"基本等同全展开"，预判被真机推翻），改 `rememberModalBottomSheetState(skipPartiallyExpanded = true)`，APK F5827821 → **D882D186** 并复验 ①②③⑥；装机后 `pm path` 拉回 base.apk 的 SHA256 与交付锚逐位一致。实测还包括：掉线超 60 秒被移除**不补报"离开了房间"**、时间线与相对时间分档（刚刚/1/2/3 分钟前）、当前曲行动效条、跟随滚动（屏外滚到/屏内不跳）、重装+重启后头像偏好保留、24 字昵称 + emoji 前缀入房不触发 400（服务端名字 `🐼 AliceLongName12345678`）。**触感无客观证据**（`dumpsys vibrator_manager` 不记录 `performHapticFeedback`，已回填陷阱 2.12）标人工手感项；**10 分钟摘要淡出**与 2 倍字号/≥3 人 `+N`/弱网时序未覆盖。新增 `scripts/member-sim.mjs` 把"缺第二台手机"从阻塞降级为脚本可覆盖（成员必持 WS、`--hold` 到期即掉线、逐行 JSON 输出），用法见模块 09。证据：[device-batch-a](docs/test-results/2026-09-25-device-batch-a/README.md)。
- **反馈二小轮（2026-09-25）**：按用户指示「去掉房间号显示，去掉保存长图功能，其它部分放弃验证，实现功能就行不需要测试」——①TopBar 房间页不再显示房间码胶囊，与入房页统一为「一起听歌」（房间码仅存于邀请口令文本与加入前确认卡）；②`ui/PlaylistImage.kt` 整文件删除，MainActivity 移除 exporter 装配与歌单标题行按钮（无关联单测）。仅 compileDebugKotlin 确认通过；单测/Lint 当轮未跑（用户指示免测），**已由 09-25 批次 A 开轮门禁补齐**。**APK 已于 09-25 单独重建装机：C685CE0A…（仅 assembleDebug）**。③试用反馈轮真机验收终止补验：已实测通过通知栏/展开页上一首下一首环形切歌（Bug④ 修复成立，公网 23 首）、顶栏无复制图标/房主标注、无搜索框、口令文本无 :3000；成员 Snackbar、粘贴重入同房未验即关闭，保存长图场景随功能删除作废（见 test-results/2026-09-24-feedback-round）。
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
  - **设备已装机 `517A776B…`（09-26 傍晚真机复测通过，见上方新条目）**：seek 单调时钟与过期重入两修复已闭环；本轮复测还顺带覆盖了相机扫码入房（用户人工）与 `member-sim` 成员进出。仍挂起的设备项：双人真机同屏（缺第二台）、空歌单、2 倍系统字号、小屏布局、emoji/代理对昵称目视（`input text` 打不进非 ASCII）、快滑中切歌、触感人工手感。
  - **播放态历史疑点已重新定性**：旧 dump 采样不可靠，17/18/19 原截图显示「播放中」；不再视为已证实的 PlaybackView 缺陷。脚本已修，未来本机状态/歌词需独立验证。
  - **邀请提示失真已修复（09-26）**：改为扫码/手动输入房间码，与当前入口一致；错误的长房间码不再被截为 8 位码。
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
