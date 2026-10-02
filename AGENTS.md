# AGENTS · 开发会话指南

本项目用 AI 辅助持续开发。任何新会话（包括中断后恢复）从本文开始，按顺序读少量文档即可继续，无需重读整个项目。

## 恢复开发的标准入口（按序阅读；不必通读全文，verification.md 优先看「本轮新增 / 当前状态一览 / 尚待验收」三节）

1. `docs/verification.md` —— **进度唯一事实来源**。"本轮完成/本轮新增"是最近交付，"尚待验收"是待办清单。
2. `docs/next-development-plan.md` —— M0-M4 路线图、当前任务顺序、验收标准。
3. `docs/modules/README.md` —— 模块索引；改动哪个模块就读对应 `docs/modules/<编号>.md`（含已实现/待开发分界）。
4. `docs/development-pitfalls.md` —— **开发陷阱清单**：实际踩过的坑与规避方法（编码、adb、UI 自动化、Compose、协程测试）。动手前通读，踩到新坑必须回填。

点歌队列/即时聊天扩展（v2）的开发规格见 [docs/ListenTogether-queue-chat-design.md](docs/ListenTogether-queue-chat-design.md)。2026-09-30 已交付 QC-0→QC-E 本地实现，但**后续独立验收未通过**：已有 56/56 与安卓 130 项通过，额外 7 项服务端/5 项客户端检查复现缺陷，修复清单见 [验收报告](docs/test-results/2026-09-30-queue-chat-acceptance/README.md)。**未部署云端、未提交 Git**；实际修复与设备进度仍以 verification.md 为准。

历史证据按需查：`docs/test-results/<日期-场景>/README.md`（**完整场景目录**，完整索引见 verification.md「测试记录入口」）；使命完结的一次性历史文档在 `docs/archive/`（播放测试 2026-09-21、W1/W2 交接单 2026-09-23）。

## 当前进度快照（2026-10-02：聊天键盘 MuMu 实测通过；安卓 180/24、Lint 0；APK `041B4295…` MuMu 安装/回拉，PHQ110 仍为 `89E90EEB…`；无真机任务 server 74/74、脚本 51/51 已验；云端 v1 未动；新布局真机/完整设备矩阵/双真机/发布待验）

- **聊天键盘与歌曲栏（2026-10-02）**：按真实 IME 高度收起/恢复 MiniPlayer，明确 adjustResize；180 项/24 套件、Lint 0/构建，固定 `.workbuddy/chat-keyboard-debug.apk` SHA256 `041B4295…`，MuMu Android 15 安装/回拉、浅深/发送/恢复/播放连续实测通过。临时键盘/3002 合成实例已清理，PHQ110 新包未安装；未改 3000 调试服务/真实曲库/云端/Git/同步参数。[键盘报告](docs/test-results/2026-10-02-chat-keyboard/README.md)。

- **无真机任务（2026-10-02）**：专辑第 9 字段与 Media3 元数据、Chrome 删除/空库截图和恢复（8/8）、WSL Linux 共享文件回收（3/3）、真实 token 失效 HTTP/WS（2 项）与 systemd 坏 dist/缺依赖/回滚（5/5）通过；纯后端 -ServerOnly 包与固定 APK 041b4295… 已准备，未装机/上云/提交 Git/改真实曲库/调同步参数。报告 [desktop tasks](docs/test-results/2026-10-02-desktop-tasks/README.md)；完整设备、生产维护与 M2 仍待验。

- **随机动物头像与双主题（2026-10-01）**：15 个 256px WebP 动物，服务端随机分配且同房唯一，离线宽限占用/重连保留/退出释放，聊天保存发送时头像。摘要 40dp、重叠 12dp；主题只有浅色/深色，默认浅色并保存（旧 System 迁移浅色）。server 70/70、安卓 177/23 套件、Lint 0/构建；APK `89E90EEB…` 已覆盖安装 PHQ110 并回拉一致，浅深摘要/成员/聊天、两项菜单与冷启动保存目视通过。本机后端保留调试，脚本成员已离房；未改真实曲库/云端/Git/同步参数。见 [头像报告](docs/test-results/2026-10-01-animal-avatars/README.md)。

- **此前 ACC 修复与真机验收（2026-10-01）**：ACC-01、ACC-03 至 ACC-12 代码/自动化检查通过，ACC-02 延续关闭；server 63/63、安卓 173/22 套件、Lint 0/构建、脚本 51/51、原探针 7/7+5/5。运行时 schema、命令去重/字节预算、分块调度、聊天/队列恢复和播放隔离、空曲清媒体、能力标志与重连探测已补齐。该修复包 `ABCB8582…` 覆盖安装 PHQ110；蓝牙中断/本机暂停期间自然耗尽、IME/聊天等证据严格区分 b5d83aaf… 与最终包。无线 192.168.43.15:41293，本机后端保留调试；完整弱网/权限/旧 APK 426/双真机仍待验。见 [修复报告](docs/test-results/2026-10-01-queue-chat-fixes/README.md)。未部署云端、未改真实曲库、未提交 Git、未调同步参数。

- **修复前 UI 独立复验（2026-10-01，历史失败）**：server 56/56、安卓 147 项门禁与 Lint/assembleDebug 通过；服务端原探针 7/7 失败、失效队列/慢写 3/5 失败、客户端附加 7/11 失败。**ACC-02 源码与自动化已关闭，ACC-03 部分修复，剩余 11 项开放，整体仍未通过**。APK `6C3E8758…` 不变，70 个产品文件哈希固定证据；ADB 无设备，未装机/操作手机/启动 MuMu或常驻播放后端；未改产品、曲库、云端或 Git。见 [修复前复验报告](docs/test-results/2026-10-01-queue-chat-reacceptance/README.md)；后续修复状态以上一条与 verification.md 为准。

- **原生 UI（2026-10-01）**：暖色浅/深、右上主题选择（跟随系统/浅色/深色并保存）、图标三页、成员集中邀请、真实封面/LRC；房主长按拖排/边缘滚动，待播第一次左滑展开、按钮或第二次左滑删除、成员仅撤回自己的歌；点歌真实 ✓ 与随机一首，聊天保留原文/发送者/原 ID 重试。147 项单测、Lint 0、debug APK 与 MuMu 原生核心场景证据见 [本轮报告](docs/test-results/2026-10-01-android-ui/README.md)。IME 软键盘未取得显示证据，真机/双机仍待验；ACC 后续状态以上述独立复验为准，未部署/改真实曲库/提交 Git。

- **v2 独立验收（2026-09-30 晚，未通过）**：最先修复认证 WS 发 null 导致的未捕捉异常；随后闭环分页覆盖、聊天失败丢文本/无原 ID 重试、缺口与缺块恢复、实时 100 条上限、聊天触发播放观察者、去重边界/房间字节上限、队列分块等。已有门禁通过不关闭这些缺陷。PHQ110 装机包与 d29c5e86… 回拉一致，用户自行调试本机 v2，验收仅做代码/测试和只读观察。详情见上述报告；未改功能源码、云端或真实曲库。

- **点歌队列/聊天扩展 v2（2026-09-30，QC-0→QC-E 本地完成；未提交 Git、未动云端与真实曲库）**：①协议 v2——`GET /api/capabilities` 探测（404=旧服务端）、业务 HTTP/WS 握手要求 `X-ListenTogether-Protocol: 2`（缺失 426）；新 APK 对 426/旧服务端转 **Incompatible 终态**不重连（连在产 v1 云端即此组合，属设计行为）；protocol.md 重写为 17 类消息 schema 且由 protocol.test.ts 从文档提取真实消息校验。②点歌闭环——建房空队列、首曲入队提升当前曲并暂停、成员配额 5（房主豁免）、同曲 409、随机加歌 1/5 部分成功、queue.move 锚点+expectedQueueVersion（冲突 409 回最新队列）、skip-next 保留播放意图、曲终耗尽即停；**select 指令已删除**。③去重/限流/背压——requestId+issuedAtMs 10 分钟去重（重放回放原 ack 不耗配额、限频不占结果槽位）、分类限流（命令 10/s、队列 5/10s、sync 各 2/s、聊天 5/10s，429 带 retryAfterMs）、硬保护 100/s→1008、待发 512KiB/连接与 64MiB/全服超 1013、快照 ≤32KiB 分块 + 同类快照合并。④聊天——500 码点/2048 字节、100 条环形窗口、seq 缺口检测；安卓「队列/点歌/聊天」三页互斥（未读徽标/pending 气泡/分块快照组装）。⑤规模（QC-D）——封面按需读取 + 32MiB 全服 LRU（`cover-cache.ts`）、loadCatalog 4 路并发（`pool.ts`）、路由 byId O(1)；2000 首合成夹具基准：启动 1.64s、RSS 89MB 有界、搜索 p95 0.048ms；15 人 600s 混合负载 429=0/seq 零跳变；慢客户端 429 不误踢；脚本 `scripts/qcd-{fixture,bench,mixed-load,slow-client}.mjs`。⑥门禁：服务端 **56/56** + 安卓 **130 项** + Lint 0；APK `d29c5e86…`（debug，未装机）。**剩余**：真机目视（队列/点歌/聊天页、通知栏下一首）、旧 APK 426 实测、双真机项、云端发布待授权。
- **23 首新歌上云 + 重复《唯一》清理（2026-09-30，纯数据轮，无代码改动）**：①上云前盘点发现本轮导入的 `wei-yi-2` 与既有 `wei-yi` 音频 md5 完全相同（同一首歌导入两次），走管理器 DELETE 接口删除、3 文件入回收批次 `20260930-034604`（manifest 可恢复），整库 45/45 可加载；②新增 23 首（成全→泡沫）共 70 文件 116MB 打包 scp 上云（远端 sha256 核对一致），云端 catalog 预备份至 `media-originals/catalog-pre-sync-20260930/`（增量同步，旧 22 首文件未动）；③**坑：chown 没加 `-R`，解包新文件仍是 root 属主 640，服务 loadCatalog EACCES 起不来进重启循环**——递归 chown + 640 后恢复，今后曲库上云的属主操作一律 `-R` 并抽查新文件属主；④重启前确认内存无活跃房间（`A84AFF71` 已 empty-timeout 自毁）；⑤验证：health 200、启动日志零 error、云端 catalog 与音频 md5 与本地逐位一致。GitHub 推送待用户指令。
- **管理器页面重构：视图拆分 + 列表节点缓存 + 版本告警误报修复（2026-09-29，纯前端）**：只改 `scripts/metadata-manager.html`（`metadata-manager.mjs` 零改动，其 HTML 是请求时现读磁盘，**3100 常驻进程无需重启即生效**）。①顶栏 5 平铺按钮 → `浏览曲库 / 批量匹配 / 新增歌曲` 三视图互斥（`body[data-view]` 驱动显隐、`aria-selected` 高亮，切视图不碰数据）；②`renderList` 由整表 `innerHTML` 重建改 `rowCache` 行节点缓存（筛选/排序/多选/删除只改类名与节点顺序）；③顺带修掉版本告警误报——页面由硬编码版本 `===` 改为 `PAGE_SERVICE_VERSION` 下界比较，服务端更新不再误报「旧版本」。门禁 51/51 + 三份页面驱动全绿；抓到并修复 `renderList` 空结果分支早退漏清场（陷阱 10.7/10.8）。函数拆分（`select`/`resourceRow`）本轮未做，等用户实际用过视图后单独一轮。证据：[2026-09-29 管理器 UI](docs/test-results/2026-09-29-manager-ui/README.md)。
- **本机与云端曲库已同为 22 首 Hi 形式（2026-09-29，无新代码）**：①曲库目录收敛为 catalog 引用 66 文件——88 个迭代旧版本（135MB）曾移入 `.workbuddy/media-trash/orphan-cleanup-2026-09-29-04-25-51/`，**清理轮已彻底删除**（仅留 `manifest.json` 作删除记录；云端在产曲库与 `media-originals/media-backup-hi-20260929/` 均有备份）；②main 推 GitHub（`629d3c6` → `34b53ec`；代理端口漂移用 `-c http.proxy` 覆盖）；③上云：旧曲库备份 `media-originals/media-backup-hi-20260929/` → 同步包 101MB（22 音频含 11 首 aac 转码产物 + 22 歌词 + 22 封面 + catalog）scp 解包、`chown listen-metadata:listen` + 640、`systemctl restart listen-together`（当时无活跃房间），基线 **14/14**，本地/云端 ju-hao 音频与封面 md5 逐位一致，catalog 首条 artist/album/year/lyrics/cover 全带；④客户端 coverVer/lyricsVer 随内容变化，设备下次入房自动重拉，**无需清缓存**。⚠️ 清理脚本「按前缀保留」的守卫正则被连字符截断（`hong-ri`→`hong`）误移《红日》《忘情水》5 文件，已取回并记入 manifest——批量脚本按前缀归类前先拿真实样本验（陷阱同族：副作用要对账，不能只看退出码）。
- **.aac 转码收编（2026-09-29，22/22 全部 Hi 化）**：`parseHiAudio` 放行 `.mp3/.aac/.m4a`（酷我 CDN 白名单不变）；管理器新增 `transcodeToMp3`（ffmpeg libmp3lame 192k、180s 超时、临时文件即用即删、产物过魔数 + 长度校验），`/higequ-replace` 与 `/api/higequ/import` 共用，ffmpeg 缺失/失败回 422。**播放链路照旧只读 MP3**，转码只发生在下载环节，不宣称无损。门禁 51/51（含真 aac 夹具 e2e）+ 驱动 85/85。
- **导入拼音命名 + 批量 Hi 替换 + 命名合规（2026-09-29）**：新增根依赖 `pinyin-pro`（MIT）+ `pinyinId()`（`情深深雨濛濛`→`qing-shen-shen-yu-meng-meng`、非中文按原文、64 位截断），`/api/higequ/import` 默认 ID 改拼音、重名自动 `-2`（不再 409，`body.id` 显式指定时仍 409）；命名合规全检修正 3 处反斜杠路径（`path.join` 在 Windows 写进 catalog，同步到 Linux 会坏）。
- **Hi 整首替换 + 搜索导入 + 面板重构 + 启动器幂等重启（2026-09-29）**：`/higequ-replace` 一次动作换音频 + 标题/歌手连名覆盖 + 专辑（非空才覆盖）+ 歌词 + 封面，去掉「先保存表单」拦截；`wx` 独占创建（先 mkdir）+ `writeAndValidate` 闸门，失败整组撤销，旧文件原地保留。新增 `/api/higequ/search`（无 1s 间隔/无缓存，人工挑条）与 `/api/higequ/import`（默认 `hi-<rid>`，重复 409 / 坏 rid 400 / 无直链 404 / 非 MP3 422 均不动库），`parseHiDetail` 加 `verifyIdentity:false`。新增面板改「Hi 搜索行内导入为主 + 手动上传收进折叠」（`textContent` 防注入）。`start-metadata.ps1` 改幂等重启——删掉硬编码版本比较与「复用已运行进程」分支，那正是用户撞上「接口不存在」的来源。门禁 51/51 + 85/85。
- **Hi 音频下载（2026-09-29，用户决策：单曲手动触发、仅开发测试、非商用、不限速）**：`higequ.mjs` 新增 `parseHiAudio`——站点把音频直链以 `let code="<base64>"` 服务端渲染进 player 页（酷我 CDN 免签名免 Referer），解码后仍须过 `allowedAudioUrl` 白名单（`*.kuwo.cn` 族 https/443/无凭证）；`metadata-assets.mjs` 加 `AUDIO_LIMIT`（64MB）；`POST /api/tracks/:id/higequ-audio` 复用 `syncTrack` 身份校验（判定字段是 `metadataAccepted`，消费 `identityAccepted` 会恒 undefined）→ 下载 → MP3 魔数校验 → `audio/<id>-<uuid>.mp3` 换指针，旧音频原地保留。其余来源（QQ/网易云/MusicBrainz）仍不下载音频。
- **M2 双机同步（2026-09-28 深夜，纯测试轮零代码改动）**：A=PHQ110 真机（房主）+ B=MuMu 12 模拟器（成员），云端 release 20260928-1815。测量工具本轮入库可复跑：`scripts/m2-diag-stats.mjs`（diag JSONL 按 `estimatedServerMs` 服务端时钟对齐、1 秒桶配对、`correction=seek/speed` 分级）与 `scripts/m2-sync-sample.mjs`（`dumpsys media_session` 交叉口径，读数偏斜按各自读取时刻外推）。10 分钟连续播放（自动顺播跨三首）：可比样本 **99.5%**（门槛 ≥90% ✅），跨端偏差 ≤500ms 占 **28.1%**（diag，p50=732ms）/ 49.0%（dumpsys）——**95% 门槛未达 ❌**；根因判明为 **MuMu 模拟器音频时钟慢 2–3%**（真机自身 drift p50=**258ms** 达标且零 seek；MuMu p50=934ms、约 75% 时间处于变速追赶）。三场景全过：切歌跟随偏差 161ms、成员本地暂停隔离、恢复跟听 790ms 回带内。**95% 门槛在真机-真机组合复测前显式挂起，模拟器配对不作该门槛判定依据**；期间不调同步参数。音频层同录比对与 15 人负载未重跑。
- **结构拆分 + 封面双层缓存（2026-09-28 深夜，当前安卓锚 `F79DFE09…`，128 单测、Lint 0、已装机并回拉逐位一致）**：先测后改——debug 包 14.3% 掉帧/p90 40ms，R8 benchmark **1.1%/p90 16ms**（结论仍是「帧耗时只认 R8 包口径」）。`CoverCache` 加内存 LruCache（堆 1/8、按 `Bitmap.byteCount` 计费、键含 `targetPx`）+ `inSampleSize` 降采样（44dp 缩略图不再解 500×500 全尺寸位图，滚回可见区不重复解码）；`MainActivity` 868→**284** 行（只留组合根与 `formatTime`），界面拆为 `ui/HomeScreen.kt` / `ui/RoomScreen.kt` / `ui/CommonUi.kt`（全 `internal`，权限 launcher 仍留在 Activity）。协议与服务端零改动。
- **lyricsVer 缓存失效 + 分支合并 + 云端管理器 metadata-03（2026-09-28 深夜，release `20260928-1815`，prev `20260928-1718`）**：catalog 协议扩到**第 8 字段 `lyricsVer`**（`coverVersion` 泛化更名 `contentVersion`，无歌词为 null）；安卓 `LrcCache` 缓存键 = `id-lyricsVer`（旧服务端缺字段时退回纯 id 键，向后兼容）——**「换歌词要手动清客户端缓存」的挂账就此关闭**。分叉分支合并进 main（merge `7428c0c`）。云端管理器发 `20260928-metadata-03`（独立版本目录 + 夹具验收 + 切链接 + rollback trap；服务器侧 `node --test scripts/lib` 37/37、离线驱动 85/85，**未重启播放后端**，生产 catalog 发布前后 SHA256 逐字节相同）。基线 14/14。
- **元数据链路真机验收 + 歌词乱码修复（2026-09-28 傍晚，release `20260928-1718`）**：真机抓到《有何不可》歌词「起」字渲染为 U+FFFD——根因是 `fetch-lrc.mjs` 用 `data += chunk` 逐块独立解码 https 响应 Buffer，跨块汉字整体损坏（**陷阱 10.4**），改 `setEncoding('utf8')` 后脚本 37/37；云端坏字节随同步被净本取代（坏件留档 `media-originals/lyrics-corrupt-backup-20260928/`）。封面在产版是 `const cover = null` 刻意停用，真实现（`12cb8de`）本轮才发版，产出 19/21 封面。**云端《红日》《忘情水》为用户经云端管理器删除**，故云端一度 21 首（09-29 同步后回到 22 首口径，见首条）。证据：[2026-09-28 元数据真机验收](docs/test-results/2026-09-28-metadata-device-check/README.md)。
- **Hi 歌曲优先 + 管理页面优化（2026-09-28）**：`higequ.com` 元数据适配（来源优先 Hi→QQ→网易云→MusicBrainz、`data-time` 歌词转 LRC、`og:image` 封面、12s/2MB 页面上限 + 1s 限速 + 同站跳转校验，只请求搜索/详情）；页面加专辑检索、缺项筛选、批量匹配、停止/重试、新旧值预览；**回收站恢复**（`scripts/lib/media-trash.mjs`，每批 `manifest.jsonl`，恢复后原回收副本保留，坏库先拒绝）；根目录 `start-metadata.cmd` → `scripts/start-metadata.ps1`。门禁 47/47 + 85/85。证据：[2026-09-28 Hi 管理器](docs/test-results/2026-09-28-higequ-manager/README.md)。
- **历史轮次（2026-09-23 ~ 09-27，均已闭环）**：界面收拢、邀请口令 + 二维码、通知栏/展开页环形切歌、批次 A 一起听体验；其中房间动态流（`ui/RoomActivity.kt`）、伪封面（`ui/TrackArtwork.kt`）、歌单长图（`ui/PlaylistImage.kt`）、头像选择器、歌单搜索（`PlaylistFilter.kt`）**均已按试用反馈删除，对应文件不复存在，勿按旧记录去找**；`scripts/fetch-metadata.mjs` **已删除**（抓取/打分/缓存并入 `scripts/lib/metadata-sources.mjs` + 管理器）；元数据三轮（服务端 ID3/歌词/封面 + 安卓解析与 UI）、曲库删除（单曲 + 批量，引用计数、文件进回收可放回）。详述见 verification.md「交付历史索引」与 `docs/test-results/`。
- **下一步**：
  - **点歌队列/聊天 v2 完整设备验收**：当前 APK `041B4295…` MuMu 键盘补验已通过、PHQ110 新包待装；上一 `89E90EEB…` 有设备证据，ACC 代码/自动化与基础单机取证完成；继续真实弱网/确认丢失原 ID 重试、成员端权限/手势、旧 APK 连新后端 426、系统字号/小屏与双真机；通知/IME/耳机与空曲按报告对应版本已补验。云端 v2 后端 + 新 APK 发布按部署手册，**待用户明确授权**。
  - **M2 95% 门槛**：等**第二台真机**；到位后用 `scripts/m2-sync-sample.mjs` + `m2-diag-stats.mjs` 按同口径复测出权威结论（期间不调 SyncMath/变速参数）。
  - **封面链路已闭环（原先的「云端发布 + 真机目视」待办作废）**：`cover` 真实现（`12cb8de`）在 release `20260928-1718` 才真正发版，09-28 傍晚真机已目视确认 **19/21 歌单行·迷你条·播放页真实专辑图**（《单车》《倔强》无独立封面按设计占位），09-29 22 首全套封面随曲库上云。
  - **云端下架维护**：已有云端管理器，6.3 已按本机/隔离 Linux 证据整理；生产实际删曲/重启/恢复仍需目标与维护授权。
  - **设备补测**：双人同屏与成员展开 180dp 滚动、空歌单、2 倍系统字号（含歌词排版）、小屏布局、emoji/代理对昵称目视、快滑/触感人工手感。
  - **公网弱网/丢包/抖动真机表现**（此前 fault-proxy 只在本地用过）、真实令牌失效后的设备 UI（服务端 leave/清扫已验）；WSL/systemd 失败注入已验，生产失败发布仍待维护。
  - **部署注意**：曲库改动（音频/歌词/catalog）**必须 restart** 才生效（启动时一次性加载，陷阱 8.10）；**不要用 `package-deploy.ps1` 部署曲库**——它会把本地 `media/`（ASCII 名布局）打进包覆盖云端曲库；上云走「云端旧库备份 → 同步包 scp → 解包 → chown/640 → restart」。
  - **清理待办已清（2026-09-29 清理轮）**：迭代旧版本 122MB、同步暂存目录、旧 release 包与一次性探针脚本均已删除（明细见 verification.md「工作区清理轮」），云端 `media-originals/` 下各份备份保留。
  - 专辑与媒体元数据：本地第 9 字段/安卓解析/Media3 artist+albumTitle 自动化已通过；新包实际通知显示与云端 v2 发布仍待验。
  - TLS/域名正式化——用户已决策路线 A（试用期维持 `http://8.166.126.136:3000` 明文 IP），转正式实例备案或迁中国香港时一并解决；`benchmark` 变体本机测试专用、不分发，正式 release 继续拒绝 HTTP。
- 日常入口：试用反馈驱动的修复循环，或 M2 条件成熟 / 元数据第三轮残留项推进。

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

# 曲库管理唯一入口（手工编辑 / 手工上传 / 封面上传替换移除 / 联网匹配【Hi歌曲·QQ·网易云·MusicBrainz】
#   / Hi 搜索导入新歌 / Hi 整首替换 / Hi 音频下载 / 删除单曲与批量 / 回收站恢复，全在这个界面）
cd D:\ListenTogether; start-metadata.cmd                    # 一键启动（幂等重启：先停 3100 旧进程再用最新代码起，打开浏览器）
cd D:\ListenTogether; node scripts/metadata-manager.mjs      # 或手动起，http://127.0.0.1:3100，需先 cd server && npm run build
# 删除只作用于本机 media/，文件进 .workbuddy/media-trash/<批次>/（管理器删曲批次含 manifest.jsonl，可经界面恢复）；云端删曲走 add-media.ps1 + 服务器 media-manage.sh
# 非 mp3（.aac/.m4a）导入时经 ffmpeg libmp3lame 192k 本地转码，ffmpeg 需在 PATH；播放链路本身只读 MP3
# 本机工具脚本单测（纯离线，不访问公网）
cd D:\ListenTogether; .\scripts\check.ps1 -Scope scripts
```

## 环境备忘

- 构建：JDK 17、Android SDK Platform 35、Build Tools 35.0.0、Gradle 8.11.1（wrapper 自动下载）。
- 后端：Node.js 24 / TypeScript / Fastify；依赖用 `npm ci`；演示后端用 demo-media 合成曲库。
- 真机：PHQ110（OPPO），地址填 `http://127.0.0.1:3000`（依赖 adb reverse）；后端重启会丢失房间（内存态）。
- 后台运行的演示后端日志在 `demo-backend.log`。
- 曲库（2026-09-30 现状）：`D:\ListenTogether\media` 为 **45 首真实曲库**（原 22 首 Hi 形式 + 09-30 上云的 23 首 Hi 搜索导入曲；音频/歌词/封面齐备、`<id>-<uuid>` 命名为主，导入端点音频按设计为 `<id>.mp3`），另有《红日》《忘情水》本地留存文件（云端已按用户决定删除、不在 catalog 引用中）。`media/catalog.json` **已入库**（真实编目，不是空模板）；`media/audio|lyrics|covers/` 被 gitignore 覆盖。要跑本机真实曲库：`MEDIA_DIR=D:\ListenTogether\media` 起后端（合成测试音另走 `scripts/start-demo.ps1`）。
- 负载/注入脚本：`node scripts/load15.mjs --model playback --duration 600 --bitrate 192`（成员必须持 WS，勿删该逻辑）；`node scripts/fault-proxy.mjs --port 3001` + `/__fault/{delay,cut,audio401,clear}`；QC-D 规模与负载：`node scripts/qcd-fixture.mjs --tracks 1000` 生成合成夹具（.workbuddy，不碰真实 media/）→ `qcd-bench.mjs --media <夹具>` / `qcd-mixed-load.mjs` / `qcd-slow-client.mjs`（均自起本地服务端，需先 `cd server && npm run build`）。
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
- 动手实现一个不熟悉的功能前，先搜 GitHub 上的相关开源实现（用 WebSearch/WebFetch 搜 `site:github.com` 或具体库名，本机未装 `gh` CLI）做参考，再写代码；搜到的结论（方案、坑、取舍）在交付说明里简述来源链接。只读参考，不整段拷贝代码，注意许可证。
