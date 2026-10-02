# 01 Android 界面与应用入口

2026-10-02 最新 UI 交付见 [聊天键盘报告](../test-results/2026-10-02-chat-keyboard/README.md)及 [verification](../verification.md)：安卓 180 项/24 套件、Lint 0；APK 041B4295… 已安装/回拉 MuMu，浅深 IME/发送/恢复/播放连续性通过。PHQ110 仍为 89E90EEB…，新布局真机及完整设备矩阵待验；头像/ACC 历史证据保持对应版本。

当前 UI 的聊天入口由服务端可选 chat 能力控制，关闭时只显示队列/点歌，已选聊天页回到队列；两页保留原生图标、Role.Tab 与 selected 语义。RoomPlayer 的拖动/待确认 seek 随 entryId 变化复位。

修复前历史（2026-10-01 独立复验）：当前 `6C3E8758…` 版本普通 147 项通过；累计分页、查询代次和版本冲突恢复的 5 项回归及 RoomLayout 接线核对完成，ACC-02 源码 / 自动化关闭。聊天原文与原身份重试有通过证据，超时恢复 / 广播关联仍有失败，ACC-03 未整体关闭。ADB 无设备，新的真机草稿切页 / IME / 通知栏与 TalkBack 保留待验。证据见 [本轮复验](../test-results/2026-10-01-queue-chat-reacceptance/README.md)。

## 职责和边界

显示连接、房间、成员和播放器状态，收集操作意图。页面不持有 ExoPlayer，不决定全房间播放位置，不自行重放离线副作用。
ListenApplication 持有进程级 RoomClient；页面通过 StateFlow 观察 UiState，播放器生命周期属于 PlaybackService。
当前源代码已应用 2026-10-01 精简版原生 UI；构建、APK 与设备结论见 [本轮 Android 记录](../test-results/2026-10-01-android-ui/README.md)，进度仍只以 [verification.md](../verification.md) 为准。

## 当前入口与数据

2026-10-02 键盘优化：Scaffold 保留 IME 避让，MiniPlayer 只在 `WindowInsets.ime.getBottom(LocalDensity.current) == 0` 时显示，键盘弹出给聊天输入框/点歌搜索让位、关闭恢复；Manifest 明确 adjustResize。播放器状态、Controller/Service 位于显示条件外，开关键盘不改变播放或草稿。见 [实测](../test-results/2026-10-02-chat-keyboard/README.md)。

2026-10-01 头像更新：`AnimalAvatars.kt` 将服务端 avatarId 映射到 15 张离线内置 WebP。成员摘要 `AvatarStack` 每个重叠 12dp（40dp 外框），最多三个，主题色描边；成员清单与聊天气泡共用动物头像，聊天使用发送时的 senderAvatarId，缺失/未知 ID 才回落原字素占位。`ThemeMode` 仅 Light / Dark，默认 Light，旧 System 偏好回落 Light，已存浅/深选择保留。代码、APK 与设备证据见 [头像记录](../test-results/2026-10-01-animal-avatars/README.md)。

- `MainActivity.kt`：单 Activity 组合根，屏幕状态过滤、MediaController 绑定/释放、通知与相机权限、相机/相册扫码、退出确认和播放器弹层；不在页面创建播放器。
- `ui/HomeScreen.kt`：`JoinInput` / `JoinInputSaver` / `JoinForm` / `InviteConfirmCard`，收集昵称、公开邀请码与地址，连接仍调用 `RoomClient.join`。
- `ui/CommonUi.kt`：`TopBar` / `ScanSourceSheet`，应用名称与原生图标；房间顶栏提供主题选择和退出，首页加入模式提供扫码。
- `ui/RoomScreen.kt`：`RoomContent` 委派 `RoomLayout`，保留 `StatusBanner` 与连接文案；`ui/RoomLayout.kt` 持有房间页签、搜索词、聊天草稿、成员面板开关及已读水位，以房间身份为保存边界。
- `ui/QueueScreen.kt`：待播列表、房主长按拖排/边缘滚动；`ui/QueueSwipeRow.kt` 处理第一次左滑展开、按钮/第二次左滑删除及右滑收起，成员只撤回自己的歌。`ui/QueueMove.kt` 计算服务端锚点、滚动速度与分页去重。
- `ui/ThemeSelector.kt`：顶栏主题图标与浅色/深色菜单；`appearance.xml` 只保存界面选择。组合根同步状态栏/导航栏图标明暗，不重建房间或播放器。
- `ui/CatalogScreen.kt`：`CatalogSearchState` 管理 300ms 防抖、查询代次、曲库 revision、累计结果和错误恢复；`CatalogScreen` / `SongCover` / `SongCopy` 连接真实点歌操作与封面。
- `ui/ConversationScreen.kt`：正式/本地待确认气泡、发送者、未读入口与发送/失败/重试反馈；草稿从 `RoomLayout` 传入，未确认原文与操作身份保存在 `RoomClient`。
- `ui/MembersSheet.kt`：成员清单与唯一的房间邀请入口；二维码、复制与系统分享使用同一个 `InviteCode.encode` 结果。
- `ui/RoomPlayer.kt`：键盘未占用底部时显示的 `MiniPlayer` 和原生 `ModalBottomSheet` 的 `PlayerSheet`；`RoomPlayerState` 共享进度、拖动与待确认 seek，状态 key 含房间 token；`seekConfirmed` 使用单调时钟窗口。
- `ui/LyricsState.kt` / `ui/LyricsFollow.kt` / `ui/LrcParser.kt`：显式区分加载、无歌词、读取失败、无时间轴与逐行歌词；切歌及 `lyricsVer` 变化重建内容；手动/惯性滚动停止 3 秒后恢复跟随。
- `ui/CoverView.kt`：`rememberCoverBitmap` 调用既有 `RoomClient.fetchCover` / `CoverCache`，列表 48dp、迷你条 44dp、展开封面按可用竖屏高度适配；失败保留静态占位，不使用原型示意素材。
- `ui/MemberAvatar.kt` / `ui/AnimalAvatars.kt` / `ui/DisplayName.kt`：服务端分配的动物图、重叠摘要；旧服务缺字段时使用成员 ID 稳定主题色、昵称首字素/emoji，占位截断保持代理对安全。`ui/InviteQr.kt` / `ui/LocalQrDecoder.kt` 提供真实二维码生成与相册解码。
- `ui/PlaybackView.kt` / `ui/ScreenState.kt`：媒体错误与状态横幅判断、屏幕进度刷新过滤；高频进度在播放器作用域读取，避免整页随进度重组。
- `ui/theme/`：暖白 / 松绿 / 柔杏固定 Material 3 浅深方案，默认 `dynamicColor=false`，默认浅色，只提供保存的浅/深选择；`Color.kt` / `Theme.kt` / `Shape.kt` 集中颜色、系统字体 sp 字阶和组件圆角。
- `network/Models.kt`：UiState、RoomState、Track、Member、Credentials、PendingChat / ChatDelivery。本机保存地址、最近成功加入的公开码与昵称，成员令牌不持久化。

## 当前流程

输入/扫码确认 → RoomClient.join → 获得身份 → WebSocket 房间/待播/聊天状态更新 → 页面刷新。
有效身份触发 Service/Controller 接线，页面销毁释放 Controller，后台播放生命周期由 Service 管理。队列变化以服务端快照为准，局部 spinner 与拖排预览不冒充操作成功。
房主控制调用 `setPlaying` / `command("seek")` / `skipNext`；成员播放按钮只改变本机暂停/恢复跟听。退出确认后调用 `leave`，房间身份变化清理本页草稿、查询、预览与展开状态。

## 界面结构（当前原生实现）

- **入房页**：创建/加入标题与单卡片表单；48dp 分段、昵称、加入模式的 8 位邀请码、可折叠高级设置（地址空时默认展开）、真实错误与一个主按钮。切模式保留输入，处理中禁用重复操作并显示 spinner；不默认填入云端地址，不冷启自动入房。
- **扫码入房**：加入模式顶栏进入相机/相册来源选择。相机仍用 ZXing Activity Result，首次请求 CAMERA 权限；相册走系统 GetContent，无需读存储权限。识别后展示公开邀请确认卡，再由用户点击加入；拒绝相机权限仍能相册或手填。
- **公共骨架**：顶栏「一起听歌」+ 主题选择 + 退出图标（确认弹窗）；主题仅浅/深并保存，首次默认浅色。成员摘要最多 3 个轻微重叠的动物头像与在线人数，点击展开成员面板；必要连接/媒体反馈在统一区域；队列/点歌/聊天三个图标页签具备动作名称与选中语义。三页各自保存滚动，切页不改变播放。
- **成员与邀请**：成员清单显示昵称、房主标记及在线/离线，限高 180dp 独立滚动；面板本身竖屏高度受限并可滚动。二维码在本面板展开，复制给真实完成反馈，分享调用 Android 系统面板；顶栏没有邀请/分享入口，口令始终不含成员令牌。
- **队列**：仅列待播，行内真实 48dp 封面、曲名、歌手，不显示时长、点歌人、随机来源或序号，不重复展示当前曲。房主长按行拖排，边缘自动滚动，放手提交 `entryId + beforeEntryId + expectedQueueVersion`，取消/版本变化/失去权限恢复快照；读屏提供向前/向后自定义动作。按用户后续反馈删除三个点菜单：第一次左滑只展开「删除/撤回」，点击按钮或再次左滑提交真实 `queueRemove`，右滑收起；服务端回显前保留条目并显示处理态。房主可删除任意待播项，成员只能撤回自己的歌曲；无权限行不注册侧滑。无上移/下移菜单或常驻拖动柄；空态提供「去点歌」。
- **点歌**：搜索歌名/歌手，首屏按页加载，更多同 revision 累计去重，旧查询代次不能覆盖新查询；409 曲库变化清页重查，网络失败保留错误与重试入口。只在行尾 `+` 发起 `queueAdd`，真实当前曲/待播里已有该歌才显示禁用 `✓`，处理中显示局部 spinner；随机图标每次调用 `queueAddRandom(1)`。配额与容量仍由既有业务校验，不保留五首随机入口或模拟成功。
- **聊天**：他人左侧头像/昵称，自己右侧；保留原文与发送者，省略逐条时间。草稿跨页/配置重建保留，离房清理；`chatSend` 接管原文后才清输入。原始 PendingChat 区分 Sending / Failed / Unconfirmed / Confirmed，明确失败和暂未确认提供原身份重试，限频等待/过期状态可读；不伪造 seq 或服务端时间。首次完整快照（含空窗口）建立已读基线，翻看时新消息不强抢位置，提供回到底部入口。
- **当前曲与展开页**：只有底部 `MiniPlayer` 可展开播放器；迷你条保留真实封面、曲名/歌手、独立播放键及房主下一首，空当前曲不显示旧媒体。展开页按封面→曲名→歌手→真实 LRC 排列，主体可滚动，关闭和进度/播放/下一首固定可达；无封面/歌词切换、回到开头按钮或常驻权限说明。成员不提供共享 seek/下一首可点击动作；读屏播放动作明确「暂停本机」「恢复跟听」。
- **进度与歌词**：滑条平时隐藏时间数字，触摸按下/拖动/键盘操作时显示预览与总时长，进度语义始终完整。seek 沿用乐观显示→快照确认→5 秒待确认提示，不提前改变播放器；切条目/清空清旧预览。真实歌词读取失败有「重试歌词」，无引用与失败分别展示；手势和惯性结束 3 秒恢复当前行，没有回位按钮。
- **系统与范围**：单 Activity、560dp 内容上限、edge-to-edge，IME 内边距放在 Scaffold 保证聊天输入及播放器整体避让。主题默认浅色，仅提供保存的浅/深选择；不增加两倍字号开关、横屏专用布局、WebView 或网页产品入口。Android 系统字号仍使用 sp；既有系统字号、真机/双机和听感待办不因此关闭。
- **通知栏与性能**：本轮保留 PlaybackService / MediaSession 既有通知栏与同步策略；下一首仍是 `skip-next`，空当前曲清媒体。R8 benchmark 变体仅作本机帧耗时基准，不分发；本轮 debug 截图/功能观察不能替代 R8 性能或双真机声音结论。

## 邀请口令（InviteCode）

- encode 产出公开房间码与服务器地址的纯文本，对约定 `http(s)://主机:3000` 省略端口；地址缺失时不伪造地址，任何入口不带令牌。
- decode 锚点正则容错解析，8 位码后校验字母数字边界；超长错误码拒绝、不截短，解不出邀请返回 null。
- RoomClient.join 对缺省端口补回 3000，显式非默认端口双向保留；二维码、复制与系统分享都使用同一份 encode 产物。

## 异常与资源

验证空昵称、错误地址、房间过期、服务不可达；保留可修改输入，不泄露令牌。配置重建不重复入房或产生第二播放器，退出/换房后的迟到响应不能恢复旧 UI。
CatalogSearchState 只管理页面检索结果与代次；RoomClient 管理会话、网络与待确认操作身份，PlaybackService 管理播放。聊天缺口/缺块、实时窗口与播放观察者等存量 v2 项仍按 [独立验收报告](../test-results/2026-09-30-queue-chat-acceptance/README.md) 跟进；本轮必要接线不等于整个 ACC 清单通过。

## 验收

[本轮 Android 记录](../test-results/2026-10-01-android-ui/README.md)登记本轮实际单测、Lint、assembleDebug、APK SHA256 和可取得的 MuMu 截图/操作证据；未知结果不由本文推断。
HTML [精简原型记录](../test-results/2026-10-01-ui-minimal/README.md)只验证设计参考，不能代替 Android 界面或真实业务链路。
真机触感、TalkBack、相机/跨设备邀请、系统字号、听感及双真机同步保留待验；MuMu 仅覆盖本轮已记录的模拟器场景，不能关闭原生历史待办或 95% 双真机门槛。未部署云端、未改真实曲库，未自动提交 Git。

## 核心注释

解释页面状态订阅、Controller 绑定/释放、会话 key、查询代次、拖排锚点/取消、聊天身份重试与共享播放/本机暂停的区别；不为普通 Text 布局逐行翻译代码。
## 变更记录（详述见 verification.md 与 test-results）

- 2026-09-21：建档（基于单机版本）；M3 Google 蓝 Material 3 重构，PHQ110 实测通过。
- 2026-09-22：交互修补四项（IME 内边距、复制 Snackbar、Expired 快捷退出、滑块禁用说明）。
- 2026-09-23：简洁 UI 重构（首页 Tab/轻量歌单）+ UI 评审优化 12 项（地址折叠高级设置、顶栏重排、通知权限延迟、图标统一 Outlined、暗色启动主题等）+ 进度条 14dp 圆点端点；均真机验证。
- 2026-09-24：批次 1 邀请口令闭环（InviteCode + 确认卡）；批次 2 成员头像色板 + 歌单搜索（搜索当晚移除）；UI 重构轮——单卡片表单、`ui/RoomPlayer.kt` MiniPlayer+PlayerSheet 常驻、头像堆叠、当前曲动效条；试用反馈轮——通知栏/展开页环形切歌钮、口令隐 `:3000`、去搜索。
- 2026-09-25：反馈二小轮——顶栏去房间码胶囊、「保存长图」整体删除（`ui/PlaylistImage.kt` 移除）。批次 A「一起听体验轮」——房间动态流、伪封面、歌单跟随、触感/无障碍、头像 emoji（100 项单测 + 独立复核 9 处修正；当天下午 PHQ110 真机 6 项场景通过，修复展开页半屏回归）。09-25 晚试用反馈——按用户指示删除头像选择器、房间动态流（`ui/RoomActivity.kt`）、伪封面（`ui/TrackArtwork.kt`），歌单改圆角面板固定标题+独立滚动+序号；`PlayingIndicator` 改固定尺寸 Canvas 绘制期读值。夜轮——`JoinInputSaver` 输入恢复、`lastRoom` 预填、Expired 重新加入、二维码邀请（`ui/InviteQr.kt`）、`benchmark` 变体。
- 2026-09-25 深夜 → 09-26 凌晨：门禁补齐（`CAMERA` 补 uses-feature、UseKtx 清理）；6 项真机场景通过；R8 vs debug 帧耗时 A/B（R8 掉帧 0.16%–0.77%）；按用户指示删除 `playbackLabel` 与状态文字提示（单测 86→84）。
- 2026-09-26：遗留修复——邀请提示文案改扫码/手动入房、decode 拒长码；seek 确认窗口改单调时钟 + `seekConfirmed` 纯函数；重新加入补 `composeNickname`；撤回对 PlaybackView 的旧采样疑点归因（三张截图均正常）。傍晚 PHQ110 真机复测（`517A776B…`，云端 23 首曲库）：seek 三场景、过期重入闭环、扫码入房、昵称边界全过，见 [设备复测记录](../test-results/2026-09-26-device-retest/README.md)。
- 2026-09-26 深夜 / 09-27：**歌曲元数据第一二轮 UI** —— 歌单行/MiniPlayer/展开页三处歌手副行（artist 为空不占行高）；封面有图时通过 Bearer 请求并按 `coverVer` 缓存，缺图统一使用 `CoverPlaceholder`；展开页歌词区按用户确认改为停止滚动 3 秒自动回位且不显示按钮。**09-27 真机验收**通过并修复歌词状态缺陷：`""`/`null` 兼职"加载中/没内容"导致 404 曲目卡在「加载中」——判定抽为 `ui/LyricsState.kt` 纯函数（`lyricsUiState`/`lyricsPlaceholderText`，显式区分 Loading/NoLyrics/NoTimeline/Ready），`LyricsStateTest` 7 项钉住。见 [真机记录](../test-results/2026-09-27-metadata-r2-device/README.md) 与陷阱 4.8。
- 2026-09-27 白天：**首页与扫码交互（试用反馈）**——①首页「此刻，一起听 / 和朋友分享同一段旋律」标语块删除，进入即见表单；②扫码入口从表单整行按钮**移到顶栏右上角**（`TopBar` 的 `onScanInvite`，只在未入房且处于加入分支时显示；入房后同一位置由「显示邀请二维码」接管）；③新增 `ui/LocalQrDecoder.kt` + `ScanSourceSheet` 底部弹窗，**支持从相册选图扫码**（ZXing core 直接解码，两段式读取避免大图 OOM），相机实时扫保留；④`InviteQrDialog` 去掉解释文字、标题收为 `titleMedium`、二维码留 12dp 边距。真机：相册选图扫码成功入房（用户实测），截屏经 `jsQR` 独立反解确认码可扫。见 [本轮记录](../test-results/2026-09-27-home-scan-ux/README.md) 与陷阱 3.10。

- 2026-09-27 下午：云端真机补验复现并修复「暂停歌曲翻歌词后不归位」；新增 `LyricsFollow.kt` + 4 项回归，恢复时同一行也重新滚动。按用户反馈移除「回到当前歌词」按钮，改为停止滚动 3 秒自动恢复，继续滚动重置计时；切歌重建歌词取值与列表状态。相机新入口已由用户实际扫码确认。证据见 [本轮记录](../test-results/2026-09-27-cloud-device-followup/README.md)。

- 2026-09-28 深夜：**结构拆分 + 封面双层缓存**。①MainActivity 868→284 行，只留组合根（ScreenState 采样、MediaController 接线、扫码落地、弹窗装配）与 `formatTime`；界面构件按页拆为 `ui/HomeScreen.kt`（JoinInput/JoinInputSaver/JoinForm/InviteConfirmCard）、`ui/RoomScreen.kt`（RoomContent/StatusBanner/MembersSection/AvatarStack/PlaylistSection/PlaylistRow）、`ui/CommonUi.kt`（TopBar/ScanSourceSheet/InviteQrDialog），全部 `internal`，单 Activity + 单一不可变状态原则不变。②`CoverCache` 加内存 LruCache（堆 1/8、按 byteCount 计费、键含目标像素）+ 按 `targetPx` 降采样解码（`inSampleSize` 2 的幂）——44dp 缩略图不再解全尺寸 500×500 位图；`rememberCoverBitmap` 增加 `size: Dp` 参数（歌单行/MiniPlayer 44dp、展开页 180dp，尺寸也进 produceState 键）。③帧耗时复测（PHQ110 同工况快滑 12 次，21 首带真实封面）：debug 14.3% 掉帧/p90 40ms，R8 benchmark **1.1%/p90 16ms**——卡顿主因是 debug 包工具链（结论与 09-24 R8 口径一致），封面功能未破坏 R8 流畅度。

- 2026-10-01：**精简原生 UI 落地**。暖色双主题与入房表单、房间图标三页、成员集中邀请、精简歌曲行、房主长按拖排/边缘滚动、单首随机、真实失败消息原 ID 重试、首快照未读基线和封面/LRC 同时呈现已写入 Kotlin / Compose；累计分页/查询代次与本地处理态为必要接线。源码、构建、APK 和模拟器证据见 [本轮 Android 记录](../test-results/2026-10-01-android-ui/README.md)；存量 v2 独立验收和真机/双真机待办仍以 verification.md 为准。

## 精简设计参考与原生边界

[逐屏规格](../ListenTogether-ui-design.md)与[单文件 HTML](../ui-prototype/index.html)保留为视觉/交互参考；Android 直接实现 Jetpack Compose，未包装 HTML 或使用 WebView。原型示意封面/歌词、角色和模拟连接状态不进入产品；新 UI 使用原有真实状态、封面缓存与 LRC 链路。
本轮只在本机交付源码与 APK；旧 d29c5e86… 和历史 HTML/真机证据不转记为新 UI 通过，当前结果由本轮证据和 verification.md 登记。

## 待验与后续

本轮必要客户端接线需以对应回归结果判断；其余 [v2 ACC 修复清单](../test-results/2026-09-30-queue-chat-acceptance/README.md)仍开放，不能因 UI 完成改为已修复。真实设备的歌词快滑手感、2 倍系统字号、IME/TalkBack/邀请与双真机项保持原待办；通知栏歌手、album 协议等其它后续项不在本轮新增 UI 范围。云端发布另待明确授权。
