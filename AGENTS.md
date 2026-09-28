# AGENTS · 开发会话指南

本项目用 AI 辅助持续开发。任何新会话（包括中断后恢复）从本文开始，按顺序读少量文档即可继续，无需重读整个项目。

## 恢复开发的标准入口（按序阅读，总计约 600 行）

1. `docs/verification.md` —— **进度唯一事实来源**。"本轮完成/本轮新增"是最近交付，"尚待验收"是待办清单。
2. `docs/next-development-plan.md` —— M0-M4 路线图、当前任务顺序、验收标准。
3. `docs/modules/README.md` —— 模块索引；改动哪个模块就读对应 `docs/modules/<编号>.md`（含已实现/待开发分界）。
4. `docs/development-pitfalls.md` —— **开发陷阱清单**：实际踩过的坑与规避方法（编码、adb、UI 自动化、Compose、协程测试）。动手前通读，踩到新坑必须回填。

历史证据按需查：`docs/test-results/<日期-场景>/README.md`（29 个场景目录，完整索引见 verification.md「测试记录入口」）；使命完结的一次性历史文档在 `docs/archive/`（播放测试 2026-09-21、W1/W2 交接单 2026-09-23）。

## 当前进度快照（2026-09-27：曲库删除（单曲 + 批量）+ 元数据抓取并入管理器 + 三源匹配，锚 A586F93C；后端仍 `20260927-1240`，以 verification.md 为准）

- **曲库删除已落地（2026-09-27 深夜，本轮最新）**：按用户指令给唯一管理入口 `node scripts/metadata-manager.mjs` 补上"删除音乐"。`DELETE /api/tracks/:id?run=<批次>&files=audio,cover,lyrics`，**闸门先行**：先整库 `loadCatalog` 自检（坏库回 409、一个文件都不动、不留空批次目录）→ 移除条目过 `writeAndValidate`（失败 422 逐字节回滚）→ **才**把文件移进回收目录 `.workbuddy/media-trash/<批次>/<库内相对路径>`（`--trash` 可挪根；每批一份 `manifest.jsonl` 记条目原文与文件来去，可手工放回，绝不 `unlink`）。音频/独立封面/歌词**三类都按引用计数**：只有独占文件随曲目走，共用的留原地并点名"谁还在引用"；`covers/` 之外的封面只删条目不动文件。界面顶栏「多选删除」+ 单曲删除，对话框逐首列"标题｜歌手｜id｜音频/封面/歌词"再按类勾选，批量独立成败、失败留窗口可重试。门禁：离线单测 **31/31**、可复跑离线驱动 **77/77（8 组，新增删除组）**、浏览器在临时 4 首曲库上实跑批量/单曲/坏库三条路径。**只动 `scripts/` 与文档**：未改服务端/协议/安卓，未上云（云端删曲仍走 `add-media.ps1` + 服务器 `media-manage.sh`），无截图证据（自动化视口不可用）。顺带修掉两处真实缺陷（`managedCoverPath` 的 POSIX 目录判断恒假、封面/音频漏做引用计数），陷阱回填第 7 节两条。

- **元数据管理只有一个入口（2026-09-27 晚）**：按用户指令把命令行同步器 `scripts/fetch-metadata.mjs` **删除**（文件不复存在，勿按旧记录去找），抓取/打分/缓存并入共享模块 `scripts/lib/metadata-sources.mjs` + 可视化管理器 `scripts/metadata-manager.mjs`。三源可选：`qq`（默认，一次请求拿全字段）/`netease`（榜首常是翻唱，靠阈值卡住）/`musicbrainz`（唯一给可读流派），**共用一套打分与阈值**（国内平台按结果名次折算相关度）。界面按曲或批量出候选，勾选后经 `apply` 落库并过 `loadCatalog` 校验。出网只取文本与封面地址：不下载音频、不带登录 Cookie、每源独立限速。离线单测 **31/31**（含 `readId3Tags` 两项，早期文档记的 29 是并发会话前的口径；`scripts/check.ps1 -Scope scripts`，新增该档）+ 可复跑的离线驱动 **77/77**（`docs/test-results/2026-09-27-metadata-sources/manager-offline-check.mjs`，起真管理器 + 临时曲库、不出网；第 [7] 组（原 [6]，UX 轮插入歌词组后顺延）用 `--import` 预加载把第二个实例的 `globalThis.fetch` 换成必抛，钉住"平台不通→502 不写缓存、批量其余首照常"的降级契约），驱动当场抓出并修好一处真实缺陷（缓存里的封面地址绕过当次阈值）；真实 23 首三源抽查 + 浏览器"匹配→勾选→应用"落盘对账已通过。**只改本机脚本与文档**：未改服务端/协议/安卓，未部署。⚠️ 该轮登记过"`media/catalog.json` 入库模板已还原 `[]`"，**现已不成立**——同日 media 分区重构轮把它写成了本机 23 首真实编目（`audio/` 前缀布局，跟踪文件，`git status` 可见），要恢复空模板需另行确认。详见 [元数据源整合记录](docs/test-results/2026-09-27-metadata-sources/README.md) 与 [模块 08](docs/modules/08-library-audio.md)。

- **本地封面管理（2026-09-27）**：`scripts/metadata-manager.mjs` / `.html` 已支持封面上传、替换、移除；图片落在 `media/covers/`，catalog 写入可选 `cover`，服务端独立图片优先、ID3 回退，`coverVer` 按图片内容变化。服务端 **30/30** 通过；临时曲库上传→读取→移除 smoke 通过。只完成本机闭环，云端发布与真机真实图片目视待补。

- **云端真机补验与歌词修复（本轮最新）**：相机新入口已由用户实际扫码确认；云端歌词冷缓存下载与服务器哈希一致，播放跟随/切歌/占位通过。真机复现并修复「暂停歌曲手动翻页后不归位」（旧逻辑只监听当前行，恢复状态不触发定位），新增 `LyricsFollow.kt` + 4 项单测。**用户确认：不显示「回到当前歌词」提示/按钮，停止手势与惯性滚动 3 秒后自动回位，再滑动重新计时**。最终包 `A586F93C…` 已装机并回拉一致，127/127 单测、Lint 0、Debug/R8 构建通过；测试成员已退出，仅建一间测试房，未部署后端。详见 [本轮证据](docs/test-results/2026-09-27-cloud-device-followup/README.md)。

- **修补上云：配额文案 + 建房来源 IP 进日志（2026-09-27 白天，本轮最新）**：用户反馈「为什么显示同一来源最多创建三个房间？难道之前创建的都没有清掉吗？」。排查结论：**配额机制正常**——用户房间在部署 restart 时已清空，是我的三个验收空房占满额度；日志里 12:32:47→12:34:49 四条 `room.deleted reason=empty-timeout` 是回收正常工作的直接证据（机制：空房保留 5 分钟供掉线重连，配额按「同来源 IP 同时活跃 ≤3」计、不按历史累计）。但反馈暴露两个真实问题并已修：①**429 文案没提自动回收**（用户合理误以为配额只增不减）→ 改为「…；空的房间保留 5 分钟后自动回收，请稍后重试或使用已有房间」，分钟数由 `EMPTY_ROOM_MS / 60_000` 推导；②**`room.created` 不带来源 IP**，排查只能靠时间线反推 → 事件增加 `creatorIp`，并在 `src/events.ts` 红线注释里显式登记该例外（仅排障、不下发客户端、不参与身份判定）。两条都补了回归测试（文案含「5 分钟后自动回收」×2 处、`room.created` 带 `creatorIp`）。服务端 **28/28**；release **`20260927-1240`**（prev `20260927-1226` 可回滚，tarball `d9f0e2f8…` 一致）；公网实测第 4 次建房返回新文案、日志出现 `"creatorIp":"182.102.17.83"`；基线 14/14。**只改服务端，无需重装 APK**。证据：[cloud-patch-quota-message](docs/test-results/2026-09-27-cloud-patch-quota-message/README.md)。
- **后端与歌词上云（2026-09-27 白天）**：用户指示「上云」，把元数据第一二轮后端 + 23 个 `.lrc` 部署到试用实例（release `20260927-1226`，后被 1240 取代）。①后端打包 `listen-together-…-server-only.tar.gz`，服务器侧 `npm ci`→`tsc`→`prune --omit=dev`；②`media/lyrics/` 23 个 `.lrc` 解到持久层；③云端 catalog 3 字段 → 追加 `lyrics` 引用（保留中文 `file` 名、**不补 artist**），由新增 `scripts/build-cloud-catalog.mjs` **本地生成**（避免服务器侧拼中文）。**注意：不要用 `package-deploy.ps1` 部署**——它会把本地 `media/`（ASCII 名布局）打进包，会覆盖云端中文名曲库。④验收：基线 14/14；公网专项 catalog 7 字段 23 首、`hasLyrics` **23/23**、歌词 200 中文原样、占位 200、不存在 404、无令牌 401、无路径泄漏；服务器侧逐条 stat `lyrics refs ok=23 bad=0`。⑤部署踩坑：`npm ci` 的 `EACCES` 根因是 `/opt/listen-together/.npm` 缓存归属 root（连带一堆指向 node_modules 的 `TAR_ENTRY_ERROR ENOENT` 噪声，易误判为包损坏）；带中文的脚本过 PowerShell→ssh 管道会串码（连引号都被吃），改 scp 上传后执行——陷阱回填 **10.1**。**未做**：设备端对云端新后端的歌词冒烟（用户当时正在用手机，未强制重启其 APP；设备 baseUrl 已是云端，退出重入即可看到）。证据：[cloud-deploy-lyrics](docs/test-results/2026-09-27-cloud-deploy-lyrics/README.md)。
- **首页与扫码交互（2026-09-27 白天）**：按用户四批反馈一次交付，**只动 `android/app`**、未改协议。①首页标语「此刻，一起听 / 和朋友分享同一段旋律」整块删除；②扫码入口从表单整行按钮**移到顶栏右上角**（只在未入房且处于加入分支显示；入房后同一位置由「显示邀请二维码」接管）；③**新增相册选图扫码**——`ui/LocalQrDecoder.kt` 用 ZXing core 直接解码（zxing-android-embedded 只做相机取景框，没有扫本地图能力），两段式读取（`inJustDecodeBounds` 算 `inSampleSize` 再解码，避免大图 OOM）+ 三档缩放兜底，入口是 `ScanSourceSheet` 底部弹窗（「用相机扫描」/「从相册选择图片」，相册走 `GetContent("image/*")` 不申请存储权限、解码在 `Dispatchers.IO`）；④`InviteQrDialog` 去掉解释文字、标题收为 `titleMedium`、二维码留边距。**真机**：用户实测相册选图扫码成功入房；截屏经 `jsQR`（与生成端 `qrcode` 不同实现）独立反解确认码可扫。门禁：全量 Gradle 链全绿，**123/123 单测、Lint 0**；debug `854846985C5420A68CF05E677267FC9185CA0B6317432197181D8B46538BB77E`（**已装机且回拉逐位一致**）。**未覆盖**：相机实时扫在新入口下的回归（需真人对准屏幕）。证据：[home-scan-ux](docs/test-results/2026-09-27-home-scan-ux/README.md)。陷阱回填 2.17/3.10。
- **元数据第二轮真机验收 + 歌词状态缺陷修复（2026-09-27 凌晨）**：用户提供 USB 真机，按「先设备后云端」完成设备门槛。①**曲库落地**：为不动公网，把云端 23 首（133MB）拉到本地起本机后端（打包时用 `tar --transform` 换成 `<id>.mp3` ASCII 名——Windows 自带 tar 按 ANSI 解析 tar 头会把中文名解成乱码，陷阱 1.8；新增 `scripts/build-local-catalog.mjs` 装配 catalog + lyrics 引用）；设备经 `adb reverse` 以**成员**身份跟听，新增 `scripts/host-remote.mjs` 由电脑侧当房主控制。②**真机通过**：歌词渲染、逐行跟随（5 次采样 0:55→1:37 逐一对齐）、手动翻看暂停跟随、松手 4 秒自动恢复、「回到当前歌词」按钮出现、切歌重载、无时间轴占位（单车）、无歌词占位、文件恢复后正常渲染、占位封面三处目视、播放跟听链路与自动切歌。③**发现并修复真实缺陷**：catalog 有 `lyrics` 引用但 `.lrc` 缺失时歌词区**卡「加载中」>2 分钟**；埋点证明 producer 已正确置 null，问题在渲染分支——`produceState` 用 `""`/`null` 兼职"加载中/没内容"，分支里又按 `hasLyrics` 二分，使「这首歌还没有歌词」**不可达**。修复：新增 `ui/LyricsState.kt` 纯函数显式区分 Loading/NoLyrics/NoTimeline/Ready，`LyricsSection` 按枚举渲染，新增 `LyricsStateTest` 7 项（含"加载文案≠失败文案"断言，该断言当场抓出修复第一版的同类错误）；陷阱回填 1.8/1.9/1.10/3.9/4.8/5.9/5.10。服务端 28/28、安卓 118/118、Lint 0；debug `7C503FDD…`（已装机，已被 85484698 取代）。证据：[metadata-r2-device](docs/test-results/2026-09-27-metadata-r2-device/README.md)。**云端仍未部署**（新后端 + 21 个 `.lrc` + catalog 引用 + restart 清房间，等用户开窗）。
- **歌曲元数据第二轮（2026-09-26 深夜）**：按用户指令「先生成歌词文件、封面统一占位、再开始第二轮」。①`scripts/fetch-lrc.mjs` 经授权从 lrclib.net 批量抓取，**21/23 命中**（单车/红日确无 synced 条目，写说明性占位），产物 `media/lyrics/`；②封面**临时停用提取**——服务端 `cover`/`coverVer` 强制 null（注释标注一行即恢复骨架），`/cover` 在位但一律 404，安卓三处统一新组件 `CoverPlaceholder`；③歌词管线——Track 内部 `lyricsPath` + catalog.json 可选 `lyrics`（realpath 根内/`.lrc`/≤256KB 启动校验）+ catalog 下发 7 字段（`hasLyrics`）+ 新路由 `GET /lyrics/:id`（Bearer，三档 404 语义，text/plain no-store）+ `media-manage.sh lyrics` 子命令（时间戳必填、BOM 剥离）；④安卓 `LrcCache`/`RoomClient.fetchLyrics` + 纯函数 `ui/LrcParser.kt`（`parseLrc`/`indexAt`，LrcTest 11 项）+ PlayerSheet `LyricsSection`（跟随高亮、手动翻看暂停跟随 500ms、「回到当前歌词」）。门禁：服务端 28/28、安卓 111/111、Lint 0。初版锚 `b1e80573…`（已被本轮取代）。第三轮（专辑、通知歌手、lyricsVer）未开工。
- **歌曲元数据第一轮（2026-09-26 深夜）**：服务端 Track 扩 `artist`/`cover`/`coverVer`（手填 > ID3 兜底，>1MB 封面跳过）；catalog 下发扩字段；新增 `GET /cover/:id` 鉴权 + 缓存头（**第二轮起封面提取已临时停用，路由保留一律 404**）；安卓 Models 解析 + CoverCache（`<id>-<coverVer>` 文件 IO，骨架保留）+ `rememberCoverBitmap`；PlaylistRow/MiniPlayer/PlayerSheet 加歌手副行；服务端 26/26、安卓 100/100、Lint 0；debug `43A29FB6…`（未装机，已被 b1e80573 取代）。证据：[track-metadata-r1](docs/test-results/2026-09-26-track-metadata-r1/README.md)。

- **后端已上云（2026-09-26 晚，本轮最新，release 20260926-1822）**：09-26 后端修复（清扫清空 hostId + 首个上线成员立即接任）随打包上云；prev=20260924-0937 保留可回滚。打包 tsc 0 错误 → scp → 解包 **42/42** 校验 → listen 账号构建干净 → 符号链接切换 + restart（清内存房间，用户已授权）。旧版基线与新版 `m4-deploy-verify.sh` 均 **14/14**；**专项验证**：HostA 掉线 75s 被清扫 → MemberB 加入首份状态即 `hostId=MemberB`（hostIsB: true）。设备端对新后端入房冒烟未做（第三次 USB 掉线，如实标注）。证据：[2026-09-26 云端部署](docs/test-results/2026-09-26-cloud-deploy/README.md)。
- **设备复测（2026-09-26 傍晚）**：用户恢复提供真机（USB），debug `517A776B…` 装机 PHQ110（`pm path` 回拉一致；首次回拉因 `adb pull` 静默截断不匹配，重拉后逐位一致——装机核对必须同时看字节数与哈希，陷阱 2.15）。云端（当时旧后端 release 20260924-0937）+ 23 首真实曲库全部通过：冷启预填、播放全链路（`dumpsys` PLAYING、1.0x）、**seek 三场景（拖回开头/拖中间/快速连拖）全部确认无假横幅（修复①闭环）**、展开页/环形切歌/暂停恢复、二维码反解 + 用户相机扫码入房、`member-sim` 成员进出、**过期横幅→「重新加入房间」房主侧闭环且 24 字符昵称原样（修复②闭环）**、24 码元昵称边界（表单输入即截断、恰 24 建房/重入均过）、空房回收内联报错。**断网手段约束（用户指示）：不得关闭热点、不得再开飞行模式**——飞行模式会连带关热点，已弃用；后续复现「断网 60s+ 清扫」改用 `svc data disable`（仅断蜂窝数据，陷阱 2.16）。未覆盖如实标注：双人真机同屏、触感手感/大字号/小屏/弱网注入。证据：[2026-09-26 设备复测](docs/test-results/2026-09-26-device-retest/README.md)。
- **本地审计收尾（2026-09-26 下午）**：seek 确认窗口改单调时钟（`elapsedRealtime`，墙钟差值会被系统对时跳变扭曲，陷阱 9.7；判定抽纯函数 `seekConfirmed`，SeekConfirmTest 4 项）；过期横幅「重新加入房间」改经 `composeNickname` 合成昵称（≤24 码元）。后端 23/23、安卓 **96/96** 实跑（上轮 91 按文件口径少计 1，真实基线 92）、Lint 0、Debug/R8 构建通过；debug `517A776B05C30EEBF2E7A0E2B68FE315F959748F0C3C8057FC20B975B69D98A3`（**已装机并真机复测**）/ benchmark `764D0FE19B27DEC71EA629115297CE1D74911DF1E782F775A2282F149239F1B8`（未装机）。证据：[legacy-fixes 补充小轮](docs/test-results/2026-09-26-legacy-fixes/README.md)。
- **遗留逐项修复（2026-09-26）**：邀请提示改扫码/手动入房、解析拒绝长码截断；全员清扫清空房主 + 首次上线立即接任；倍速 load/seek/暂停真正写回播放器、删除重复缓存；修复旧 dump 采样并撤回 PlaybackView 确定性归因（三张原截图显示正常）。后端 23/23、安卓 91/91、脚本 3/3、Lint 0、Debug/R8 构建通过；debug `EC5FCF0A987D10087CE88CEC228CF4509CDCC5B4E6D06E0CC79662005A4C4870` / benchmark `F943E3CA4942B84E23169CF0927A07BE11D607329F27DA86B27225F894E2438B`，均未装机。其中后端修复**已于同日晚部署上云（20260926-1822，见上方新条目）**；缺设备、TLS、新功能项保持边界。证据：[legacy-fixes](docs/test-results/2026-09-26-legacy-fixes/README.md)。
- **历史轮次摘要（2026-09-23 ~ 09-26 凌晨，均已闭环，详述见 verification.md「交付历史索引」与 docs/test-results/）**：①界面收拢——单卡片表单、常驻 MiniPlayer + PlayerSheet、成员头像堆叠、顶栏统一「一起听歌」；批次 A 的房间动态流（`ui/RoomActivity.kt`）、伪封面（`ui/TrackArtwork.kt`）、入房头像选择器、歌单搜索（`PlaylistFilter`）、保存长图（`ui/PlaylistImage.kt`）已按试用反馈**全部删除，对应文件不复存在**（勿按旧记录去找），界面现状以 [模块 01](docs/modules/01-android-ui.md) 为准。②能力闭环——邀请口令编解码（剥 `:3000`、绝不含令牌）+ 二维码邀请、通知栏/展开页环形切歌（`TrackQueue.skip`）、入房输入恢复与 Expired「重新加入房间」、`benchmark` 性能变体。③后端两波上云——09-24 release 20260924-0937（E-05 握手限连 / E-09 建房配额 / Q-3 事件与 health 计数），09-26 release 20260926-1822（见首条）。④M4 四项部署门槛全部关闭（09-23）；云端曲库 23 首真实音乐（demo-load 已移除、备份 media-originals/，负载重测需先恢复——陷阱 8.10）；入口维持 `http://8.166.126.136:3000` 明文 IP（路线 A，试用机无法备案）。⑤**滚动帧耗时结论只认 R8 包口径**（0.16%–0.77%）；debug 包数据（27.27%/13.38%）不可外推到用户构建。
- **下一步**：
  - **设备端云端歌词冒烟已关闭（09-27 下午）**：冷缓存下载、渲染、播放跟随、切歌和占位已验；最终歌词交互为无按钮、停止滚动三秒自动回位。
  - **相机实时扫新入口回归已关闭（09-27 下午）**：用户实际对准电脑二维码确认识别，随后设备入房取证通过；首次权限分支本轮未重测。
  - **可选**：云端 catalog 补 `artist`（当前无该字段，安卓显示为空不占行高）——用 `scripts/build-cloud-catalog.mjs` 去掉 `--no-artist` 重新生成 + 重传 + restart。
  - **部署注意**：曲库相关改动（音频/歌词/catalog）**必须 restart** 才生效（启动时一次性加载，陷阱 8.10）；`package-deploy.ps1` 会打包本地 `media/`（ASCII 名），**部署前务必确认不会覆盖云端中文名曲库**。
  - 元数据第三轮未开工（专辑字段、通知栏歌手、`lyricsVer` 缓存失效）。
  - **设备已装机 `A586F93C…`（09-27 下午真机通过）**：歌词暂停翻页恢复、无按钮三秒回位已闭环，自动化快滑与滑动后切歌已覆盖。仍挂起：双人真机同屏（缺第二台）、空歌单、2 倍系统字号（含歌词排版）、小屏布局、emoji/代理对昵称目视、快滑/触感人工手感。「回到当前歌词」按钮点击项随用户删除按钮作废。
  - **本地曲库环境（本轮新建，可复用）**：`D:\ListenTogether\media` 现有 23 首真实音乐（ASCII 名 `<id>.mp3`）+ `lyrics/` 23 个 `.lrc`，均被 gitignore 覆盖（不入库）。**`media/catalog.json` 是入库的模板，已还原为 `[]`**；本机要跑真实曲库时先装配再起后端：`node scripts/build-local-catalog.mjs`（源 catalog 在 `.workbuddy\media-stage\catalog.json`，同样是本机留档），然后 `MEDIA_DIR=D:\ListenTogether\media` 起服务（合成测试音另走 `scripts/start-demo.ps1`）。
  - **播放态历史疑点已重新定性**：旧 dump 采样不可靠，17/18/19 原截图显示「播放中」；不再视为已证实的 PlaybackView 缺陷。歌词时间轴跟随已由本轮真机独立验证。
  - 批次 B（可选，未开始）表情互动 reaction——需新增 WS 消息 + 服务端广播 + 云端部署窗口（restart 清房间），属协议扩展，动手前先定协议与 `protocol.test.ts` schema；
  - M2 双机同步——缺第二台手机，设备到位后按主计划验收（W5）；好友互动的单机验收已由 `scripts/member-sim.mjs` 覆盖，双机项仍需真机；
  - TLS/域名正式化——用户已决策路线 A（试用期维持 IP 明文），转正式实例备案或迁香港时一并解决（W7）；`benchmark` 变体是本机测试专用、不分发，正式 release 继续拒绝 HTTP；
  - 真实令牌作废（后端无入口）、公网弱网注入真机测试——条件具备时补测。
- 日常入口：试用反馈驱动的修复循环，或元数据第三轮 / 批次 B / M2 条件成熟时推进。

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

# 曲库元数据管理（唯一入口；手工编辑/上传/封面/联网匹配三源/删除曲目（单曲 + 批量）都在这个界面）
cd D:\ListenTogether; node scripts/metadata-manager.mjs      # http://127.0.0.1:3100，需先 cd server && npm run build
# 删除只作用于本机 media/，文件进 .workbuddy/media-trash/<批次>/（含 manifest.jsonl，可手工放回）；云端删曲走 add-media.ps1 + 服务器 media-manage.sh
# 本机工具脚本单测（纯离线，不访问公网）
cd D:\ListenTogether; .\scripts\check.ps1 -Scope scripts
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
