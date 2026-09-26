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
- 本机保存服务器地址、最近成功加入的公开房间码与昵称；成员令牌不持久化。

## 当前流程
输入信息 → RoomClient.join → 获得身份和曲库 → WebSocket 状态更新 → 页面刷新。
有效身份触发 Service/Controller 绑定；页面销毁释放 Controller，正在播放的 Service 可继续。
房主控制调用 command；成员播放按钮只改变本机跟听状态。退出调用 leave。

## 输入恢复与二维码入房（2026-09-25 夜）

- `JoinInputSaver` 用 `rememberSaveable` 保存地址、昵称、邀请码、创建/加入模式及公开邀请数据；配置变化时表单内容保留。成员令牌不进入 SavedState。
- 只持久化最近成功入房的房间码与昵称供手动重入；应用重启后不会静默入房。成员身份失效时「重新加入房间」使用当前房间码并换发新令牌。
- 加入页移除剪贴板邀请入口与把整段口令粘进邀请码框的自动识别，改为相机扫码；8 位手动邀请码仍保留作为备用。扫码结果仍进入确认卡，用户需再点击加入。
- 房间顶栏增加二维码展示；二维码载荷沿用 `InviteCode.encode`，只有房间码和服务器地址，不含成员令牌。扫描用 JourneyApps ZXing 4.3.0 的 Activity Result API，不依赖 Google Play Services；相机权限只在第一次点扫描时请求。
- 性能对照新增 `benchmark` build type：R8 优化继承 release、`isDebuggable=false`、独立 applicationId 和 debug 签名，并仅在 benchmark manifest / BuildConfig 开 HTTP。R8 包已成功构建并安装；新版设备帧耗时待补测，不能据旧 debug 数据判定修复完成。这个包仅供连现有试用 HTTP 服务的设备测量，不能发布。（帧耗时已于 09-25 深夜在同一脚本、同一曲目、播放中条件下补测：R8 快滑 0.77% / 带停顿 0.16%，同源码 debug 为 7.66% / 2.08%——见「界面提示精简」节末与 [夜轮验收记录](../test-results/2026-09-25-night-acceptance/README.md)。）

## 界面提示精简（2026-09-26 凌晨，用户指示）

> 本节覆盖上文「界面结构」中"播放卡片固定标题『当前歌曲』…操作影响在控制区说明"与「布局收拢」中 MiniPlayer"歌名/状态"的描述：状态文字与同步说明已全部移除。

- 删除 `ui/PlaybackView.kt` 的 `playbackLabel` 纯函数，以及三处承载面：MiniPlayer 歌名下方的状态副标题、`PlayerSheet` 顶部「当前歌曲 + 状态」行、`PlayerSheet` 底部「播放与暂停同步给所有人 / 暂停只影响自己 · 进度由房主控制 / 连接就绪后即可播放」说明行。理由：这些文字对操作没有增量信息——播放/暂停态已由播放键图标与歌单当前曲动效条表达，异常态由状态横幅表达。
- `PlaybackView` 随之只保留仍被消费的观测字段 `mediaId` 与 `failed`（`showStatusNotice` 用它们判定"当前曲的音频错误"）；`MiniPlayer`/`PlayerSheet` 去掉 `playback` 参数，播放/暂停一律取服务端快照 `ui.room.playing` 且叠加 `ui.locallyPaused`。
- **保留的反馈面**：状态横幅（连接中/重连+立即重试/失效+重新加入房间+退出/本机暂停/音频错误/非默认消息，`liveRegion=Polite`）、入房页表单内联错误、歌单当前曲高亮与 `PlayingIndicator`、播放键与切歌键图标。
- **一条未定性的真机疑点**（随文案删除而关闭，恢复任何"本机是否出声"显示前必须先查清）：真机上 `PlaybackView.playing`（只由 `Player.Listener.onEvents` 刷新，且会话经 `ForwardingSimpleBasePlayer.getState()` 改写）持续为 false，而 `dumpsys media_session` 是 PLAYING 且位置前进——159 秒配对采样 13/13 样本不一致。该路径不参与同步判定，故删除显示面后无功能影响。
- 单测 86 → 84（净删 2 项 `playbackLabel` 状态文案回归；`showStatusNotice` 的旧曲目/失败/本机暂停判定保留）。门禁：84 项 cleanTest 实跑 0 失败、Lint issues=0；终稿 debug `BCF3DE16…` / benchmark `9E17F291…` **未装机**（此后无真机）。

## 当前界面调整（2026-09-25 晚，试用反馈）

本节覆盖下方历史轮次中有关头像选择、房间动态与伪封面的描述。

- 入房页移除头像选择器，不再读取/保存头像偏好，也不再自动给昵称追加旧头像；手动输入的 emoji 昵称仍按原有成员显示规则兼容。
- 删除房间动态派生/订阅、最近动态摘要、时间线及相对时间刷新（原 `ui/RoomActivity.kt` 和 13 项专属测试移除）。成员区只显示人数、连接状态和可展开的当前成员列表。
- 删除 `ui/TrackArtwork.kt` 与 1 项专属测试；MiniPlayer 和展开页直接显示歌曲标题，不再显示歌曲首字封面。进度条拖动、seek 确认、音频播放逻辑保持原样（用户明确反馈进度条问题已解决）。
- 房间改为「固定成员区 + 圆角歌单面板 + 底部播放器」。歌单标题与总数固定在面板顶部，曲目 LazyColumn 独立滚动，行首改为序号，当前曲保留高亮和播放动效；成员展开限制 180dp 并可独立滚动，避免挤掉歌单。
- 滚动优化：`PlayingIndicator` 原来每帧改变 Box 高度，现改为固定 20dp Canvas、仅在绘制阶段读取动画值，避免逐帧重组/测量曲目行；收键盘手势仅保留在入房页；切歌跟随不再计算混合列表的头部偏移，用户正在滑动/惯性滚动时跳过跟随。
- 保留已有 `screenStates()` 进度隔离、稳定条目 key/contentType 和时长缓存。21:54 后 PHQ110 无线补验确认固定布局及功能移除；连续滑动 janky 27.27%、带停顿 13.38%，仍有掉帧，不能宣称卡顿完全解决。详见本轮验收记录。

## 界面结构（2026-09-23 简洁 UI；2026-09-23 晚 UI 优化批次）

- 入房页：创建/加入两个 Tab，只有加入模式显示邀请码；昵称、邀请码与一个主按钮。服务器地址默认折叠为“高级设置：更换服务器地址”，已记住地址的用户不面对基础设施细节；地址为空（首启）时自动展开。
- 失败消息在表单按钮上方持续显示，连接中禁用输入和重复提交；语义 liveRegion 提示读屏用户。
- 顶栏：房间码降为 titleMedium 并用等宽字体（降低 B/8、0/O 误读），角色简写；操作区为分享（系统分享面板）、复制（Snackbar 反馈）、退出房间（确认弹窗，退出后需重新输码）；列表底部不再放退出按钮。
- 通知权限（Android 13+）延迟到入房成功后申请且每次安装只问一次，不再冷启动即弹。
- 房间内按系统返回只退出界面，Toast 提示“仍在后台播放，可在通知栏停止”；播放由 Service 继续。
- 正常连接收进人数摘要，成员默认折叠，展开显示房主与在线/离线文字；不只依赖颜色传达状态。
- 异常、本机暂停和非默认消息保留横幅；媒体错误采用错误色与图标，提供退出入口，重连可立即重试。
- 播放卡标题行只显示歌名与时长（2026-09-26 起不再有"当前歌曲"标题与状态副标题），曲名允许两行，64dp 播放按钮；播放/暂停由按钮图标与歌单当前曲动效条表达，校时完成后才启用播放/拖动。
- 页面通过 MediaController 的 Player.Listener 读取 playerError 与 mediaId（`PlaybackView` 只有这两个字段），仅用于判定"当前曲的音频错误"是否占用横幅，不修改 UiState 或同步规则；迟到的旧曲目数据不能把新歌报成失败。播放/暂停显示一律取服务端快照 `ui.room.playing` 叠加 `ui.locallyPaused`，不用本机 `isPlaying`（旧采样证据已于 09-26 复核更正，见下方记录）。
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

### 一起听体验轮：房间动态流 + 伪封面 + 跟随滚动 + 头像 emoji（2026-09-25 批次 A）

- **房间动态流（零协议改动）**：服务端只推全量快照（[protocol.md](../protocol.md)），没有事件通道，因此由客户端对连续快照做差分——新增 `ui/RoomActivity.kt`，纯函数 `RoomActivity.derive(previous, current, tracks, everOnline)` 把"有人加入/离开/上下线、房主转移、换曲、播放与暂停"翻译成 `RoomEvent`。三条约定写死在单测里：①首帧（刚入房、断线重连后的第一份快照）不产生事件，避免整屏"XX 加入了房间"；②服务端在成员离线 60 秒后才移除（store 的 tick），"离开"只在上一帧仍在线时产生，否则会在"掉线了"之后 60 秒补一条重复播报；③同帧换曲 + 开播只报换曲，一次切歌不刷两条动态。另有第④条：服务端 `add()` 先广播（新成员 online=false）、WS 连上后 `connect()` 才置 online=true，因此"在线"事件必须要求该成员**此前被见过在线**（调用方跨快照维护 `everOnline` 集合，`updateEverOnline` 只保留当前房间内的成员），否则每个新人都会刷出"加入了房间"+"回来了"两条假动态。
- **动态展示**：成员区折叠行第二行 = 连接状态 + 最近一条动态（不额外占一行），**只保留 10 分钟内的动态**（更早的从摘要淡出，避免两小时前的"离开了房间"读起来像刚发生；完整历史仍在展开的时间线里）；展开后成员列表下方是「房间动态」时间线（最近 8 条，最新在上，右侧相对时间）。事件保留 20 条（`ROOM_ACTIVITY_KEEP`），相对时间与淡出判定每 30 秒刷新一次（`rememberNowMs`，随成员区组合存在，离开房间即销毁）。
- **订阅来源**：`rememberRoomActivity` 直接收集 `RoomClient.state` 的原始快照，不走界面的 `screenStates()`——后者为播放进度做了 500ms 去重，会丢掉成员与播放状态的中间帧；退出房间清空事件与差分基准。
- **伪封面**：曲库没有封面字段（`Track` 只有 id/title/durationMs），新增 `ui/TrackArtwork.kt` 用"稳定取色 + 首字素"绘制——复用头像的 `avatarPaletteIndex`，同一首歌颜色恒定，配色取主题色对（container 与对应 on 色），渐变终点只向内容色靠拢 22% 以保住文字对比度；空标题回落 ♪。MiniPlayer 左侧 44dp 缩略图；PlayerSheet 改为「180dp 封面居中 + 标题居中 + 主控居中 + 进度与时间左右对齐」。
- **歌单跟随**：`rememberLazyListState` + 切歌后 `animateScrollToItem`；头部条目数 = 状态横幅（可选）+ 成员区 + 歌单标题，与 `Content` 的 item 顺序一一对应。目标行已在屏幕上时不滚动，不打断用户当前浏览位置。
- **触感与无障碍**：播放/暂停、上一首/下一首用轻触感（`HapticFeedbackType.TextHandleMove`，长按级重震留给拖动结束）；MiniPlayer 的整条点击由 `pointerInput + detectTapGestures` 改为 `clickable`——手势写法不产生语义点击动作，读屏点不开播放页；成员区整行改 `clickable(role=Button, onClickLabel="查看成员/收起成员")` + `stateDescription`（原 `selectable(selected=false)` 对读屏恒报"未选中"，且箭头的 `contentDescription` 会盖掉整行合并文本，人数与最近动态都听不到，箭头改为纯装饰）；头像圆片 48dp + 父行 `selectableGroup()`（读屏才会念"7 项中的第 M 项"）。
- **头像 emoji（零协议改动）**：协议 `members[]` 只有 `name`，新增 `ui/DisplayName.kt` 约定"昵称首个字素是 emoji 即当作头像"：`firstGrapheme`（按码点与字素簇，整体取回 ZWJ 组合、肤色修饰符、成对地区指示符）、`isEmojiGrapheme`（emoji 区块判定，不含 CJK 与拉丁字母）、`splitAvatarPrefix`、`takeCodePoints`（按码点截断，避免切出半个代理对让服务端存成 `?`）、`composeNickname`（`头像 + 空格 + 昵称`，总长 ≤ 24 码元，与 server 的 1–24 字校验一致；用户自己敲的 emoji 优先，不重复叠加）。入房表单昵称下方新增头像圆片选择器（「无」+ 6 个 emoji，横向可滑，`selectable(role=RadioButton)`，读屏用中文名），选择经 `ConnectionStore.loadAvatar/saveAvatar` 持久化（接口默认实现返回空，只关心地址的测试替身无需实现新方法）。成员行文字改用 `memberDisplayName`，头像 emoji 不在文字里重复出现（昵称只有一个 emoji 时文字行仍是它本身，避免成员行没有名字）；`MemberAvatar` 不再用 `take(1)` 取首字符。
- **状态归属（复盘后修正）**：`RoomPlayerState` 的 key 从 `client` 改为 `(client, credentials?.token)`——否则 `pendingSeek` 带着上一间房的快照 version 跨房间复用，新房间 version 从 0 起，确认分支永不成立，滑条卡在旧目标值并在 5 秒后凭空弹"未确认，请重试"；房间动态条目改用 `rememberSaveable` + `listSaver`，旋转/切深色/改字号重建 Activity 后时间线不再静默清零（`previous` 归零、重建后首帧只作基准），并返回 `State` 让读取发生在成员区条目内，避免每条动态重组整个房间页。
- **边界**：无新依赖、未改 `server/`、协议与行为约定不变（服务端仍是播放唯一来源，本地暂停不广播）。动态是纯本机派生的氛围信息，掉线重连后不补历史。
- **真机修正（2026-09-25 下午，PHQ110）**：`PlayerSheet` 原用默认的 `ModalBottomSheet` 半屏锚点，真机打开展开页时**进度滑条、时间与同步说明都在屏幕外**（要再滚一次才能操作主控制项），改为 `rememberModalBottomSheetState(skipPartiallyExpanded = true)` 后一屏内完整可见，小屏/大字体仍由内容列 `verticalScroll` 兜底。同一轮真机验收确认：动态流（加入/掉线/回来/离开 + 离线 60 秒被移除不补报）、时间线与相对时间分档、伪封面与当前曲动效、歌单跟随（屏外时滚到当前曲 / 屏内不跳动）、头像 emoji 与偏好持久化、暗色可读性均通过；触感无 adb 级客观证据，标为人工手感项。证据见 [2026-09-25 批次 A 真机记录](../test-results/2026-09-25-device-batch-a/README.md)。

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

2026-09-25：反馈二小轮——顶栏去房间码胶囊（房间页与入房页统一显示「一起听歌」）、「保存长图」整体删除（`ui/PlaylistImage.kt` 删除）。按用户指示未跑门禁，仅 `compileDebugKotlin`；APK 单独重建为 C685CE0A…。

2026-09-25：批次 A「一起听体验轮」——房间动态流（`ui/RoomActivity.kt` 快照差分纯函数 + 成员区最近动态行与展开时间线，零协议改动）、伪封面（`ui/TrackArtwork.kt`，MiniPlayer 缩略图 + Sheet 封面居中布局且整体可滚动）、歌单跟随滚动、触感反馈与无障碍修补（MiniPlayer 改 `clickable`、成员区 `stateDescription`、头像圆片 `contentDescription`）、头像 emoji（`ui/DisplayName.kt` 字素安全 + 入房表单选择器 + 昵称前缀与 24 字上限）。无新依赖、未改 `server/` 与协议；新增 RoomActivityTest 13 项、DisplayNameTest 10 项、AvatarGlyphTest 3 项，单测 74 → **100 项** cleanTest 实跑全过、Lint issues=0（报告先删再生避免引用上一轮）；另经**独立复核**修掉 9 处（详见本节上文与 verification.md）。APK 见 verification.md。

2026-09-25 下午：批次 A **真机验收（PHQ110 / Android 14 / 云端后端）**——通过。真机发现并修复 1 处 UX 回归：`ModalBottomSheet` 默认半屏锚点让进度滑条/时间/说明落在屏幕外 → `skipPartiallyExpanded = true`；APK 由 466C7B72（复核稿）→ F5827821 → **D882D186**（装机并复验）。6 项场景逐条实测（②伪封面与展开页布局、④头像 emoji 与偏好持久化、①房间动态流含 60 秒移除抑制、③歌单跟随、⑥暗色可读、⑤触感标人工），另用新增 `scripts/member-sim.mjs` 模拟成员进出/掉线/回来/离开；完整证据（含截图）见 [2026-09-25 批次 A 真机记录](../test-results/2026-09-25-device-batch-a/README.md)。

2026-09-25 深夜：夜轮**装机验收轮**（无产品逻辑改动，除 Lint 修复）——门禁首轮被 `:app:lintDebug` 拦下（`CAMERA` 权限缺 `<uses-feature required=false>`），修复后 86 项单测实跑 + Lint 0；debug `9C480583` 与 R8 benchmark `08607981` 均装机并 `pm path` 回拉一致。真机通过：冷启预填不静默入房、`rememberSaveable` 跨重建存活、Expired 横幅「重新加入房间」换发新令牌、房间回收后的表单内联错误、邀请二维码截图反解（四行、无 `:3000`、无令牌）、benchmark 放行 HTTP 并播放成功；歌单滑动同条件 A/B 得 R8 0.77%/0.16% vs debug 7.66%/2.08%（澄清上一轮 27.27% 是 debug 口径）。**未覆盖**：相机扫码入房、双人同屏与成员展开滚动、空歌单/2 倍字号/小屏、emoji 昵称真机目视。证据见 [night-acceptance](../test-results/2026-09-25-night-acceptance/README.md)。

2026-09-26 凌晨：按用户指示**删除低价值状态提示**——`playbackLabel` 与 MiniPlayer 副标题、展开页「当前歌曲 + 状态」行、同步说明行全部移除；`PlaybackView` 只留 `mediaId`/`failed`，`MiniPlayer`/`PlayerSheet` 去 `playback` 参数；播放/暂停显示一律取服务端快照。单测 86 → 84、Lint 0；终稿 `BCF3DE16`（debug）/`9E17F291`（benchmark）**未装机**。真机遗留疑点（`PlaybackView.playing` 与 `dumpsys media_session` 不一致）随显示面删除关闭，根因未诊断。

2026-09-26 下午：本地审计收尾两处修复——①seek 确认窗口改用单调时钟（`SystemClock.elapsedRealtime`，`nowMs` 注入），墙钟差值会被系统对时跳变扭曲（陷阱 9.7）；确认判定抽为纯函数 `seekConfirmed`（版本新于发起时刻 + 相对贴合），SeekConfirmTest 4 项覆盖。②过期横幅「重新加入房间」改经 `composeNickname` 合成昵称（≤24 码元），不再透传原始输入。单测 96 项实跑（上轮 91 按文件口径少计 1，真实基线 92）、Lint 0；debug `517A776B…` / benchmark `764D0FE1…` **未装机**；真机 seek 听感留待统一测试。

2026-09-26 傍晚：**真机复测（PHQ110 / 云端真实曲库 23 首，在机 `517A776B`）**——两处修复回归面全过：seek 拖回开头/拖中间/快速连拖全部确认无假横幅（修复①行为无回归）；过期横幅→「重新加入房间」房主侧闭环，重入成功且 24 字符昵称原样（修复②闭环）。附带验证：冷启预填、云端播放全链路（`dumpsys` PLAYING、1.0x 前进）、下一首环形切歌、暂停恢复、二维码反解 + 用户相机扫码入房、`member-sim` 成员进出、24 码元昵称边界（表单输入即截断，恰 24 建房/重入均过）、空房回收后旧码加入的内联报错。断网手段按用户约束修正：不再用飞行模式（会关热点），后续用 `svc data disable`。证据见 [2026-09-26 设备复测](../test-results/2026-09-26-device-retest/README.md)。

## 2026-09-26 遗留项复核与修复
- 邀请末行改为「打开 App 扫描邀请二维码，或手动输入房间码加入」，与当前入口一致；旧口令仍可解析。
- decode 在 8 位码后检查字母数字边界，不再把 9 位及以上的错误码截短后加入另一个房间；标点分隔继续兼容。
- 上文“PlaybackView 持续为 false”的推断撤回：夜轮脚本可能重读失败 dump 后的旧树，而留存的 17/18/19 三张截图均显示「播放中」。已修脚本，尚无新真机采样，不宣称控制器绝对无缺陷；也不再把未证实的疑点列为歌词必然失败的根因。现有精简界面和服务端播放意图来源不变。详见 [本轮记录](../test-results/2026-09-26-legacy-fixes/README.md)。
