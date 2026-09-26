# 01 Android 界面与应用入口

## 职责和边界
显示连接、房间、成员和播放器状态，收集操作意图。页面不持有 ExoPlayer，不决定全房间播放位置，不自行执行网络重试。
ListenApplication 持有进程级 RoomClient；页面通过 StateFlow 观察 UiState，播放器生命周期属于 Service。
每轮交付的完整叙述见 [验收记录](../verification.md) 与 docs/test-results/ 对应场景目录；本文只描述当前状态与简要变更。

## 当前入口与数据
- `MainActivity.kt`：Compose 首页/房间页（单 Activity），通知权限申请、MediaController 绑定、TopBar/StatusBanner/MembersSection/PlaylistSection/InviteQrDialog/InviteConfirmCard。
- `ui/RoomPlayer.kt`：常驻底部 `MiniPlayer` + `ModalBottomSheet` 展开页 `PlayerSheet`；`RoomPlayerState`（positionMs/dragged/pendingSeek）挂房间会话作用域（key 含 token，防跨房复用）；seek 确认判定纯函数 `seekConfirmed`；`PlayingIndicator` 动效条。
- `ui/MemberAvatar.kt`：圆形头像（主题派生 6 色色板按 memberId 稳定散列，`avatarPaletteIndex`/`memberAvatarGlyph` 纯函数）+ 在线状态点；`ui/DisplayName.kt`：字素/码点安全工具（`firstGrapheme`、`splitAvatarPrefix`、`takeCodePoints`、`composeNickname`），约定"昵称首字素是 emoji 即头像"（用户手动输入，无选择器）。
- `ui/InviteQr.kt`：zxing 位图生成；`ui/PlaybackView.kt`：仅 `mediaId`/`failed` 两个观测字段 + `showStatusNotice` 横幅判定；`ui/ScreenState.kt`：`screenStates()` 按 500ms 过滤进度刷新。
- `InviteCode.kt`：邀请口令编解码纯函数（详见下节）。
- `ui/theme/`：Material 3——Google 蓝 #0B57D0 固定色板 + Android 12+ Monet 动态取色 + 暗色方案；`Shape.kt` 按用途集中圆角 token。
- `network/Models.kt`：UiState、RoomState、Track、Member、Credentials。
- 本机保存服务器地址、最近成功加入的公开房间码与昵称（`rememberSaveable` 表单 + ConnectionStore 偏好）；成员令牌不持久化。

## 当前流程
输入信息 → RoomClient.join → 获得身份和曲库 → WebSocket 状态更新 → 页面刷新。
有效身份触发 Service/Controller 绑定；页面销毁释放 Controller，正在播放的 Service 可继续。
房主控制调用 command；成员播放按钮只改变本机跟听状态。退出调用 leave。

## 界面结构（当前）
- **入房页**：文字标题区 + 单卡片表单——创建/加入分段、昵称（输入即按码点截断 24 码元）、邀请码框、相机扫码按钮、高级设置（服务器地址，空地址自动展开）、错误横幅与一个主按钮；连接进度条在卡片下方。已移除：剪贴板"粘贴邀请"入口与整段口令智能识别（09-25 夜改扫码）、头像 emoji 选择器、欢迎大卡。
- **扫码入房**：ZXing（`com.journeyapps:zxing-android-embedded`）Activity Result 方式，不依赖 Google Play Services；`CAMERA` 权限首次点击时请求，manifest 声明 `<uses-feature android:name="android.hardware.camera" android:required="false"/>`；结果进入邀请确认卡，需再点"加入"。8 位手动房间码保留为备用入口。
- **顶栏**：房间页与入房页统一显示「一起听歌」（房间码不再上顶栏，仅存于口令文本与确认卡）；操作区为二维码展示、分享（系统分享面板）、退出（确认弹窗）。二维码/口令载荷沿用 `InviteCode.encode`——只有房间码与服务器地址，绝不含成员令牌。
- **状态横幅**（`liveRegion=Polite`）：连接中/重连+立即重试、身份失效+「重新加入房间」+退出、本机暂停、当前曲音频错误、非默认消息；入房失败优先横幅、确认卡数据与昵称保留。保留的状态反馈只此一处，另有播放键图标与歌单当前曲高亮/动效条（09-26 已删除"当前歌曲+状态"文字等同步说明类低价值提示）。
- **成员区**：默认一行 = `AvatarStack`（≤5 重叠头像 + N 圆片）+「N 人一起听 · 状态」+ 箭头；展开为成员列表（`MemberAvatar` + 「房主 · 在线/离线」文字），限高 180dp 独立滚动。已删除：房间动态流（快照差分时间线，09-25 晚按反馈移除）。
- **歌单面板**：圆角面板，固定标题+数量，LazyColumn 独立滚动；行 = 序号 + 歌名 + 时长，当前曲 primaryContainer 高亮 + `PlayingIndicator`（固定 20dp Canvas，仅绘制期读值不重测）；切歌跟随滚动（用户正在滑动/已在屏内时让路）；非房主点歌弹「只有房主可以切歌」Snackbar。已删除：歌单搜索、PNG 长图导出、歌曲首字伪封面。
- **播放器**：`MiniPlayer`（bottomBar：3dp 细进度 + 歌名 + 44dp 播放键，整条 `clickable` 展开）；`PlayerSheet`（`skipPartiallyExpanded=true` 一屏完整展开：标题行含上一首/下一首 48dp 圆钮、完整滑条、时间）。环形切歌经 `sync/TrackQueue.skip`，房主 select、成员拒绝。
- **seek 显示**：乐观预览 + 快照确认（判定 `seekConfirmed`：相对推进量 + 1500ms RTT 余量，窗口用 `elapsedRealtime` 单调时钟），5 秒未确认提示重试；预览绑定房间身份与曲目。
- **输入恢复**：`JoinInputSaver` 经 `rememberSaveable` 跨配置重建保留表单（令牌不入 SavedState）；冷启预填最近房间码/昵称但不静默入房；Expired 横幅「重新加入房间」用当前房间码 + `composeNickname` 合成昵称换发新令牌。
- **其它**：通知权限（Android 13+）入房成功后申请、每次安装只问一次；房间内按返回只退出界面，Toast 提示后台仍在播放；560dp 以上限宽居中；edge-to-edge + IME 内边距；暗色启动窗口主题消除冷启动白闪；触控最小尺寸不缩水（大字体撑高）。
- **触感与无障碍**：播放/切歌轻触感（`TextHandleMove`），拖动结束保留 LongPress；MiniPlayer 用 `clickable`（读屏可达）；成员行 `clickable(onClickLabel)` + `stateDescription`；当前曲行 stateDescription「当前曲目」；头像圆片 48dp + `selectableGroup()`；状态不单靠颜色传达。
- **benchmark 构建变体**：R8 shrink/minify、`isDebuggable=false`、包名后缀 `.benchmark`、仅此变体允许 HTTP——本机帧耗时基准专用，不分发（构建细节见 [模块 09](09-build-deployment.md)）。

## 邀请口令（InviteCode）
- encode 产出四行纯文本（来一起听歌 / 房间码 X / 服务器 URL / 复制提示；地址缺失省略服务器行）；对 `http(s)://主机:3000` 剥掉约定端口 `:3000`。
- decode 锚点正则容错解析（引号、闲聊行、全角冒号、hex 大小写），8 位码后校验字母数字边界——超长错误码直接拒绝、不截短；无锚点返回 null 不抛异常。
- `RoomClient.join` 对未写端口的 URL 补回 3000，显式非默认端口（:8080）双向保留；round-trip 由 InviteCodeTest 与 RoomClientSessionTest 覆盖。
- 分享面板 EXTRA_TEXT 与二维码同源（encode 单点生成）。口令可含服务器地址（公开信息），绝不含令牌。

## 异常与资源
验证空昵称、错误地址、房间过期、服务不可达；保留可修改的地址和昵称，不泄露令牌。
配置变化不能重复入房或产生第二播放器；退出后旧结果不能把页面送回旧房间。
后台页面不负责高频轮询；进度由播放层统一提供。

## 验收
旋转/切后台/恢复不会重复入房；登录等待时返回或修改地址不会出现旧数据。
成员按钮文案和实际权限一致；空曲库、缓冲、离线、过期都有可操作提示。
口令可包含服务器地址（公开信息），绝不包含成员令牌。测试按钮点击、加载和错误状态，不靠固定屏幕坐标断言。

## 核心注释
注释 MainActivity 的控制器生命周期、UiState 中共享/本地字段、每个用户意图的权限和副作用。
后续新增 ViewModel/组件时解释状态来源；不为 Text 等明显布局语句逐行加注释。

## 变更记录（详述见 verification.md 与 test-results）
- 2026-09-21：建档（基于单机版本）；M3 Google 蓝 Material 3 重构，PHQ110 实测通过。
- 2026-09-22：交互修补四项（IME 内边距、复制 Snackbar、Expired 快捷退出、滑块禁用说明）。
- 2026-09-23：简洁 UI 重构（首页 Tab/轻量歌单）+ UI 评审优化 12 项（地址折叠高级设置、顶栏重排、通知权限延迟、图标统一 Outlined、暗色启动主题等）+ 进度条 14dp 圆点端点；均真机验证。
- 2026-09-24：批次 1 邀请口令闭环（InviteCode + 确认卡）；批次 2 成员头像色板 + 歌单搜索（搜索当晚移除）；UI 重构轮——单卡片表单、`ui/RoomPlayer.kt` MiniPlayer+PlayerSheet 常驻、头像堆叠、当前曲动效条；试用反馈轮——通知栏/展开页环形切歌钮、口令隐 `:3000`、去搜索。
- 2026-09-25：反馈二小轮——顶栏去房间码胶囊、「保存长图」整体删除（`ui/PlaylistImage.kt` 移除）。批次 A「一起听体验轮」——房间动态流、伪封面、歌单跟随、触感/无障碍、头像 emoji（100 项单测 + 独立复核 9 处修正；当天下午 PHQ110 真机 6 项场景通过，修复展开页半屏回归）。09-25 晚试用反馈——按用户指示删除头像选择器、房间动态流（`ui/RoomActivity.kt`）、伪封面（`ui/TrackArtwork.kt`），歌单改圆角面板固定标题+独立滚动+序号；`PlayingIndicator` 改固定尺寸 Canvas 绘制期读值。夜轮——`JoinInputSaver` 输入恢复、`lastRoom` 预填、Expired 重新加入、二维码邀请（`ui/InviteQr.kt`）、`benchmark` 变体。
- 2026-09-25 深夜 → 09-26 凌晨：门禁补齐（`CAMERA` 补 uses-feature、UseKtx 清理）；6 项真机场景通过；R8 vs debug 帧耗时 A/B（R8 掉帧 0.16%–0.77%）；按用户指示删除 `playbackLabel` 与状态文字提示（单测 86→84）。
- 2026-09-26：遗留修复——邀请提示文案改扫码/手动入房、decode 拒长码；seek 确认窗口改单调时钟 + `seekConfirmed` 纯函数；重新加入补 `composeNickname`；撤回对 PlaybackView 的旧采样疑点归因（三张截图均正常）。傍晚 PHQ110 真机复测（`517A776B…`，云端 23 首曲库）：seek 三场景、过期重入闭环、扫码入房、昵称边界全过，见 [设备复测记录](../test-results/2026-09-26-device-retest/README.md)。

## 待开发
拆分连接页、房间页和播放器组件为独立文件（MainActivity 已 770+ 行），保留单 Activity；采用单一不可变状态。
歌词方向已定案未开工（方案见 [路线图](../next-development-plan.md)）；批次 B 表情互动属协议扩展，动手前先定协议。
