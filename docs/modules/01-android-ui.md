# 01 Android 界面与应用入口

## 职责和边界
显示连接、房间、成员和播放器状态，收集操作意图。页面不持有 ExoPlayer，不决定全房间播放位置，不自行执行网络重试。
ListenApplication 持有 RoomClient；页面通过 StateFlow 观察 UiState，播放器生命周期属于 Service。

## 当前入口与数据
- MainActivity.kt：Compose 首页/房间页、通知权限申请、MediaController 绑定。
- ui/theme/：Material 3 主题——Google 蓝 #0B57D0 固定色板 + Android 12+ 壁纸动态取色（Monet）+ 暗色方案；标题级字重在 Typography 统一为 SemiBold；Shape.kt 按用途集中圆角 token（横幅/列表行/输入框/卡片/全宽按钮）。
- ListenApplication.kt：创建进程级 RoomClient。
- network/Models.kt：UiState、RoomState、Track、Member、Credentials。
- 首页输入昵称、邀请码；服务器地址默认折叠在“高级设置”内（地址为空时自动展开）；房间页显示状态横幅、正在播放卡片、成员、歌单。
- 本机只保存服务器地址。成员令牌不持久化。

## 当前流程
输入信息 → RoomClient.join → 获得身份和曲库 → WebSocket 状态更新 → 页面刷新。
有效身份触发 Service/Controller 绑定；页面销毁释放 Controller，正在播放的 Service 可继续。
房主控制调用 command；成员播放按钮只改变本机跟听状态。退出调用 leave。

## 界面结构（2026-09-23 简洁 UI；2026-09-23 晚 UI 优化批次）

- 入房页：创建/加入两个 Tab，只有加入模式显示邀请码；昵称、邀请码与一个主按钮。服务器地址默认折叠为“高级设置：更换服务器地址”，已记住地址的用户不面对基础设施细节；地址为空（首启）时自动展开。
- 失败消息在表单按钮上方持续显示，连接中禁用输入和重复提交；语义 liveRegion 提示读屏用户。
- 顶栏：房间码降为 titleMedium 并用等宽字体（降低 B/8、0/O 误读），角色简写；操作区为分享（系统分享面板）、复制（Snackbar 反馈）、退出房间（确认弹窗，退出后需重新输码）；列表底部不再放退出按钮。
- 通知权限（Android 13+）延迟到入房成功后申请且每次安装只问一次，不再冷启动即弹。
- 房间内按系统返回只退出界面，Toast 提示“仍在后台播放，可在通知栏停止”；播放由 Service 继续。
- 正常连接收进人数摘要，成员默认折叠，展开显示房主与在线/离线文字；不只依赖颜色传达状态。
- 异常、本机暂停和非默认消息保留横幅；媒体错误采用错误色与图标，提供退出入口，重连可立即重试。
- 播放卡片固定标题“当前歌曲”，曲名允许两行，64dp 播放按钮；房主/成员操作影响在控制区说明，校时完成后才启用播放/拖动。
- 页面通过 MediaController 的 Player.Listener 读取 isPlaying、STATE_BUFFERING、playerError 和 mediaId；PlaybackView 只负责展示，不修改 UiState 或同步规则。实际播放器观测只用于对应曲目，迟到的旧曲目数据不能把新歌显示为播放中。
- 播放按钮仍通过 RoomClient.setPlaying 发送用户意图；缓冲时可暂停，成员本机暂停不影响房间。
- 歌单为轻量列表行，仅当前曲目高亮并标“当前”（TalkBack 读作 stateDescription“当前曲目”）；非房主点击歌曲不再静默无响应，弹 Snackbar“只有房主可以切歌”。
- 进度采用既有乐观预览和快照确认，5 秒未确认提示重试；预览绑定房间身份与曲目，切歌清除拖动状态。
- 页面保留 IME 内边距；操作按钮用最小高度，允许大字体撑高，不缩小触控区域。
- 内容区在 560dp 以上宽度限宽居中，避免平板/横屏拉伸；图标统一 Material Outlined 族；启动窗口主题按系统明暗切换（values-night），消除暗色冷启动白闪。

### 邀请口令（2026-09-24 批次 1）

- 口令由 `InviteCode.encode/decode` 纯函数统一编解码（四行纯文本：来一起听歌 / 房间码 X / 服务器 URL / 复制提示；地址缺失时省略服务器行）。decode 用锚点正则容错解析（房间码/邀请码 + 8 位十六进制、URL），容忍微信/QQ 加引号、前后闲聊行、全角冒号与大小写混用；找不到锚点返回 null 不抛异常。
- 约定端口省略：encode 对 `http(s)://主机:3000` 形式的地址剥掉 `:3000`（正则 `^(https?://[^/?#]+):3000$`），口令里服务器不带端口号；`RoomClient.join` 在唯一入口把未写端口的 URL（okhttp 回填成协议默认 80/443）补回 3000，显式非默认端口（如 :8080）两向都原样保留。 round-trip 由 InviteCodeTest 与 RoomClientSessionTest 覆盖。
- 分享面板 EXTRA_TEXT 使用完整口令（同一 encode 来源，不各自硬编码）；口令中的复制提示引导收信人整段复制后用「粘贴邀请」加入。
- 加入 Tab 在邀请码输入框上方新增「粘贴邀请」按钮：点击读一次剪贴板并解析（Android 13+ 系统自带"已粘贴"提示，App 不重复告知）；解析成功弹出邀请确认卡，失败 Snackbar「未识别到有效邀请，请复制完整邀请后重试」，表单不动。
- 智能识别兜底：邀请码输入框粘贴超过 8 字符且含「房间码」锚点的文本时尝试解析，成功即接管表单，失败保留用户输入。
- 邀请确认卡：Surface(surfaceVariant) + Banner 形状，展示房间码（等宽）与服务器地址；口令地址与已记住地址不同时显示 Info 图标与「将使用邀请中的服务器地址」（不阻断，入房以口令地址为准）；「重新输入」拆卡回手填。确认卡容器 liveRegion=Polite。
- 确认卡与入房错误横幅互斥展示：入房失败优先显示错误横幅，确认卡数据保留、已填昵称不受影响；入房进行中（busy）粘贴与「重新输入」禁用。
- 口令可包含服务器地址（公开信息），绝不包含成员令牌。

### 成员可视化与歌单搜索（2026-09-24 批次 2）

- 成员头像：展开成员列表后每行显示圆形头像，取昵称首字符（空白时兜底「友」），背景色从主题派生的 6 色固定色板（primary/secondary/tertiary 及各自 container，配对对应 on 色）按 memberId 稳定散列取索引——同一成员颜色恒定，不硬编码色值，亮暗方案自动跟随。实现收敛在 `ui/MemberAvatar.kt`（色板索引为纯函数 `avatarPaletteIndex(memberId, paletteSize)`，可注入色板大小做 JVM 测试）。
- 在线状态点：头像右下角 10dp 圆点，在线 colorScheme.primary、离线 colorScheme.outline，加 surface 色描边保证任意头像底色上可见；「房主 · 在线/离线」文字行保留，不单靠颜色传达状态。折叠/展开结构与「N 人一起听」摘要不变。
- 歌单搜索（2026-09-24 批次 2 加入）按试用反馈于当晚移除：搜索框、`PlaylistFilter` 与相关单测删除，歌单恢复完整列表轻量行（长图导出的筛选依赖一并去除）。成员头像与状态点保留。

### 试用反馈：紧凑布局、滚动与长图（2026-09-24）

- 首页使用主题色欢迎卡与 48dp 最小触控高度的创建/加入分段切换；房间顶栏左对齐，避免房间码与三个操作按钮挤在中间。Activity 启用 edge-to-edge，由 Scaffold/IME inset 保留安全区。
- 播放卡使用无阴影 Surface、16dp 内边距，52dp 播放按钮与曲名同排；歌单项间距收至 8dp，保持行高至少 56dp。560dp 限宽修正为先 widthIn 再 fillMaxSize；会话切换重建列表滚动状态，避免退出时首页继承歌单滚动位置。
- `ui/ScreenState.kt` 的 `screenStates()` 过滤 UiState.positionMs 变化；播放器单独订阅原始进度。此前 PlaybackService 每 500ms updatePosition 驱动页面与 LazyColumn 内容重建，现在只有播放器消费该频率的状态。房间快照、version、错误、身份、曲库与本机暂停全部保留，seek 确认不变。
- 歌单行拆为独立 PlaylistRow，缓存时长文本，提供 track 前缀 key 与 contentType；横幅、成员、播放器使用独立 key，插入异常横幅不复用错位组件。
- `ui/PlaylistImage.kt` 新增「保存长图」：点击时冻结房间码、当前歌曲与完整歌单；系统文件保存器创建 PNG，IO 线程离屏绘制全部歌曲（含未组合/未滚到的行）。支持 API 26+，无需存储权限；取消不写入，失败尝试删除本次空文档。仅导出房间码和歌单，不含地址、令牌或成员信息。
- 图片固定 1080px 宽、歌名自动换行；高度按内容测量，超过 12000px 明确提示歌单过长，不静默截断。RGB_565 位图上限约 26MB，绘制完毕回收。
- **系统长截屏边界**：本地 Compose UI 1.8.0 源码已默认接入 Android 12+ ScrollCapture，无需旧实验开关；继续使用单一 LazyColumn 的标准滚动语义。ColorOS 是否显示系统入口尚未实测，「保存长图」是应用内歌单导出兜底，不是声称已修复 OEM 原生整页长截屏。
- 新增 ScreenStateTest 3 项，验证进度去重、业务变化透传、seek 确认快照保留。构建与设备覆盖边界见 [本轮记录](../test-results/2026-09-24-ui-scroll/README.md)。

### 布局收拢：单卡片表单 + 常驻播放器（2026-09-24 UI 重构轮）

- 入房页收拢为「标题区 + 单卡片表单」：删除 primaryContainer 欢迎大卡，改为无卡片的文字标题（headlineMedium「此刻，一起听」+ 副标题）；创建/加入分段、昵称、邀请码/粘贴邀请、高级设置、错误横幅与主按钮全部收进一张 surfaceContainer 卡片（CardShape），视线在一个动作区内完成"选路径→填信息→点按钮"；分段条底色改 surface 与卡片区分。连接中的 LinearProgressIndicator 移到卡片下方。
- 播放器常驻底部：`NowPlayingCard` 从列表项拆为 `ui/RoomPlayer.kt` 两态——Scaffold bottomBar 的 `MiniPlayer`（顶部 3dp 细进度 + 歌名/状态 + 44dp 播放键，整条点击进入展开）与 `ModalBottomSheet` 承载的 `PlayerSheet`（完整拖拽滑条、时间、同步说明）。`RoomPlayerState`（positionMs/dragged/pendingSeek）挂在房间会话作用域，Sheet 关闭不中断 seek 快照确认与 5 秒兜底；确认模型与容忍窗口公式不变（相对推进量 + 1500ms RTT 余量）。`input.dragged` 从 JoinInput 迁入播放器状态，JoinInput 只留表单输入。
- 成员区压缩为头像堆叠：默认一行 = `AvatarStack`（最多 5 个重叠头像，步距 28dp，后来者先绘制使首个头像状态点不被遮挡；超出以 +N surfaceVariant 圆片收尾）+ 「N 人一起听 · 状态」+ 展开箭头；整行 selectable 点击展开完整成员列表（行样式不变）。
- 顶栏房间码胶囊只读化（试用反馈轮调整）：房间码单独一枚 secondaryContainer 胶囊（PillShape + 等宽字体），不再内嵌复制图标、不可点按，也不再显示「房主」标注；操作区保留分享与退出两个入口。口令 encode 单一来源不变。
- 歌单当前曲行动效：当前曲目且房间播放中时，行首音符图标替换为 `PlayingIndicator`（3 根 500ms 错相跳动竖条，infiniteRepeatable Reverse）；暂停时回到静态图标。当前行 primaryContainer 淡底与 stateDescription 不变。
- 表面层级收敛：页面只剩 background / surfaceContainer（卡片与底部条）/ surfaceVariant（次要信息条）三层；无新依赖，未改 server/ 与网络层；RoomClient 调用与行为约定不变。

### 顶栏去房间码 + 移除保存长图（2026-09-25 反馈二小轮）

- 顶栏（`MainActivity.kt` TopBar）不再显示房间码胶囊：房间页与入房页统一显示应用名「一起听歌」，操作区仍为分享与退出两个入口。房间码仅出现在邀请口令文本与加入前的邀请确认卡中（`InviteCode` 逻辑不变）。
- 「保存长图」功能整体删除：`ui/PlaylistImage.kt`（PlaylistImageExporter/PlaylistImageButton/writePlaylistImage）文件删除，MainActivity 移除 import、`rememberPlaylistImageExporter` 与 `imageExporter` 参数透传、歌单标题行的 `PlaylistImageButton`；无关联单测（原为 0 项），无残留引用，`:app:compileDebugKotlin` 通过。上文「试用反馈：紧凑布局、滚动与长图」小节中的长图导出与系统长截屏兜底描述保留为历史记录，能力已于本轮移除。
- 本轮按用户指示不做真机验收与额外测试（"实现功能就行不需要测试"）。

## 下一阶段
拆分连接页、房间页和播放器组件，保留单 Activity；采用单一不可变状态，避免控件各自推测连接情况。
本机播放/缓冲/失败状态已接入；下一步补真机视觉与控制器断连场景验收。
页面仅在允许的前台生命周期发起 Service 启动；异步入房在后台完成时延后绑定到页面恢复。
房主等待操作确认期间显示状态，5 秒未确认请求同步，不自动重发。

## 异常与资源
验证空昵称、错误地址、房间满/过期、服务不可达；保留可修改的地址和昵称，不泄露令牌。
配置变化不能重复入房或产生第二播放器；退出后旧结果不能把页面送回旧房间。
后台页面不负责高频轮询；进度由播放层统一提供。

## 验收
旋转/切后台/恢复不会重复入房；登录等待时返回或修改地址不会出现旧数据。
成员按钮文案和实际权限一致；空曲库、缓冲、离线、过期都有可操作提示。
口令可包含服务器地址（公开信息），绝不包含成员令牌。测试按钮点击、加载和错误状态，不靠固定屏幕坐标断言。

## 核心注释
注释 MainActivity 的控制器生命周期、UiState 中共享/本地字段、每个用户意图的权限和副作用。
后续新增 ViewModel/组件时解释状态来源；不为 Text 等明显布局语句逐行加注释。

## 变更记录
2026-09-21：基于现有单机版本建档；上述下一阶段能力尚未实现。
2026-09-21：Material 3（Google 风格）界面重构完成——状态机展示、复制邀请码、立即重试入口已落地；亮/暗两套主题与播放回归在 PHQ110 截图/实测通过。
2026-09-22：交互修补四项——IME 内边距+点空白收键盘、复制 Snackbar 反馈、Expired 快捷退出、滑块禁用原因说明；时间格式化支持 h:mm:ss（1 小时以上，FormatTimeTest 4 项覆盖；单测总计 36 项）。RoomClient 调用与行为约定不变；真机视觉抽查并入下一次真机批次。


2026-09-23：实现首页路径切换、入房错误、紧凑连接状态、成员折叠、轻量歌单及本机播放状态；新增 PlaybackViewTest 状态回归。构建与设备验收结果见 verification.md，未将自动化替代目视验收。
2026-09-23 凌晨：UI 优化批次（系统评审后落地）——服务器地址折叠进高级设置（空地址自动展开）；退出房间移至顶栏并加确认弹窗；通知权限改为入房后申请；新增邀请码系统分享、房间码等宽字体、返回键后台播放提示、非房主点歌 Snackbar 提示、歌单 stateDescription、560dp 大屏限宽；主题层标题字重固化、Shape.kt 圆角 token、图标统一 Outlined 族、暗色启动主题消除白闪；删除未使用的 StatusGreen/StatusAmber。RoomClient 调用与行为约定不变。
2026-09-23 上午：上述 UI 优化批次真机验证通过（PHQ110 无线通道，地址折叠/顶栏三入口/退出确认/播放反馈/返回 Toast 全过；分享面板与非房主 Snackbar 等待后续条件），记录见 test-results/2026-09-23-ui-optimize。
2026-09-23 傍晚：进度条端点样式改造——material3 1.3 默认手柄是 4×44dp 竖长条（用户报告"很长的竖线不美观且占空间"），改为自定义 thumb/track：14dp 圆点手柄 + 5dp 细轨道，禁用态仍取 SliderDefaults 色，拖动/乐观预览逻辑不变；NowPlayingCard 加 @OptIn(ExperimentalMaterial3Api)。真机目视验收并入下一批次。
2026-09-24：批次 1 邀请口令闭环——新增 InviteCode 编解码纯函数（8 项 JVM 单测）；顶栏复制/分享改用完整口令（同一 encode 来源）；加入 Tab 新增「粘贴邀请」按钮 + 邀请确认卡 + 智能识别兜底；验收项「复制的邀请码不含地址或令牌」修订为「口令可包含服务器地址（公开信息），绝不包含成员令牌」。RoomClient 调用与行为约定不变；真机验收（复制→粘贴闭环/分享文本/智能识别/失败路径/地址不一致提示）待设备在线。
2026-09-24：批次 2——成员状态可视化 + 歌单搜索。成员行新增圆形头像（主题派生 6 色色板 + memberId 稳定散列取色，纯函数可测）与 10dp 在线状态点（在线 primary/离线 outline），「房主 · 在线/离线」文字保留；歌单区新增搜索框，过滤逻辑抽为 PlaylistFilter 纯函数（trim/大小写不敏感/子串匹配，返回命中原索引），空结果占位「没有匹配的歌曲」，当前播放高亮在过滤结果中依然生效，搜索仅影响本地显示。新增 9 项 JVM 单测（PlaylistFilterTest 6 + AvatarPaletteIndexTest 3）；无新依赖、未改 server/；真机目视验收待设备在线。

2026-09-24：试用反馈轮——紧凑首页/播放器、进度刷新隔离、缓存歌单筛选与条目复用、歌单 PNG 长图导出。73 项 JVM 单测；真机视觉、滚动帧率、保存器与 ColorOS 原生长截屏待设备在线，未将代码检查等同真机通过。

2026-09-24 晚：UI 重构轮——入口页收拢为「标题区+单卡片表单」（删欢迎大卡，分段/输入/错误/按钮同卡）；播放器常驻底部（`ui/RoomPlayer.kt`：MiniPlayer + ModalBottomSheet 展开页，`RoomPlayerState` 挂房间作用域，seek 确认模型原样迁移）；成员区压缩为头像堆叠单行（≤5 + +N，点击展开）；顶栏房间码胶囊化点按复制（删独立复制按钮）；歌单当前曲行播放中显示 `PlayingIndicator` 动效条。无新依赖、未改 server/ 与行为约定；73 项单测 cleanTest 实跑全过、Lint 0；APK 6C231394…；PHQ110 真机 10 项场景验收通过（多人堆叠/跨生命周期 seek 兜底/暗色抽查标注未覆盖），见 test-results/2026-09-24-ui-refresh。
2026-09-24 夜：试用反馈轮——①顶栏去复制图标与「房主」标注，房间码胶囊只读化；②`PlayerSheet` 标题行新增上一首/下一首 48dp 圆钮（房主可用，成员点按弹「只有房主可以切歌」，与歌单行为一致）；③歌单搜索整体移除（搜索框/`PlaylistFilter`/相关单测，长图导出不再带筛选词）；④口令 encode 剥掉约定端口 `:3000`（`RoomClient.join` 对无端口 URL 补回 3000，显式非默认端口保留）。无新依赖；单测 74 项（净删 8 项搜索、新增 2 项端口 round-trip + TrackQueue 5 项此前已计）cleanTest 实跑全过、Lint 0；APK 011DD835…；真机验收见 test-results/2026-09-24-feedback-round。
