# 一起听歌 · 当前交付与验收记录

项目：D:\ListenTogether
更新日期：2026-09-29（最新：导入拼音命名 + 真实曲库批量 Hi 替换（10/22）+ 命名合规检查；此前：Hi整首替换/搜索导入、启动器幂等重启、M2 双机机制验证）
定位：**进度唯一事实来源**。当前状态看「状态一览」，待办看「尚待验收」；每轮交付以追加「本轮新增」小节的方式登记，测试细节由 docs/test-results/<日期-场景>/ 承载，更早的历史轮次已压缩为「交付历史索引」。

## 本轮新增（导入拼音命名 + 真实曲库批量 Hi 替换 + 命名合规检查，2026-09-29）

按用户指令「能替换的全部替换为 Hi 爬取形式（封面/音频/歌词），已有的不用管；检查命名错误并修正；一键爬取用拼音命名」执行。改本机脚本 + 操作本地真实曲库（`media/`，旧文件全部原地保留）；云端未动。

- **导入拼音命名**：新增根依赖 `pinyin-pro`（MIT，开源参考）+ 管理器 `pinyinId()`——歌名转无声调拼音 slug（`情深深雨濛濛`→`qing-shen-shen-yu-meng-meng`、非中文按原文、64 位截断）；`/api/higequ/import` 默认 ID 改为拼音，重名自动 `-2/-3` 后缀（不再 409，重复曲目由人删除）；`body.id` 显式指定时重复仍 409。全非字母数字回退 `hi-<rid>`。
- **真实曲库批量替换**：按「文件已是 `audio/<id>-<uuid>.mp3` 形式或刚导入」跳过（he-bu-ke、wang-fei、qing-shen-shen-yu-meng-meng），其余 19 首逐首 `/higequ-replace`——**成功 8 首**（痴心绝对/单车/富士山下/红豆/大眠/唯一/手放开/第一天，各 3–5s），**未替换 11 首**（句号/爱错/倔强/囚鸟/特别的人/爱情转移/背对背拥抱/淘汰/当你/天后/遇见）。
- **未替换根因（抓包判明）**：这 11 首的 player 页直链解码为 **`.aac`**（如 `kw-bj.kuwo.cn/.../1649598311.aac`）——站点交付格式差异；项目音频管线**只收 MP3**（loadCatalog `.mp3` 校验 + `audio/mpeg`，设计稿明确转码属另一条线），按边界正确跳过。若要收编需在管理器加「aac→mp3 本地转码」步骤（需 ffmpeg）或等站点给出 mp3 直链——属新决策，未动。
- **命名合规**：全库 22 首 file/lyrics/cover 全检（`<id>` 前缀 + 目录位 + 文件存在 + 无反斜杠）——修正 3 处（情深深雨濛濛改名时引入的 `\` 路径），其余全部合规；整库 loadCatalog 22/22 可加载。过程坑：我的改名脚本用 `path.join` 把 Windows 反斜杠写进了 catalog（同步上云到 Linux 会坏），已归一并复扫。
- **边界**：本地产物仅存本地（云端曲库仍是替换前状态，同步待用户指令）；`pinyin-pro` 入根 `package.json`（node_modules 已 gitignore）。

## 本轮新增（Hi 整首替换 + Hi 搜索导入新歌 + 新增面板重构 + 启动器幂等重启，2026-09-29）

按用户指令「重构上传新歌面板；增加直接在 Hi 上搜索爬取的接口；替换直接替换不用保存，连名字都直接替换」交付（用户已实测单曲音频替换走通）。**改本机脚本与文档，未部署云端**；接口不匹配旧进程的问题已通过重启管理器解决。

- **整首替换（替代 /higequ-audio，路由 `/higequ-replace`，旧路由不复存在）**：一次动作替换音频 + 标题/歌手（**连名覆盖**）+ 专辑（非空才覆盖）+ 歌词 + 封面；**去掉"先保存表单"拦截**（未保存编辑被服务端新值取代即"直接替换"语义），完成后 refresh 以新值为准。新文件全部 `wx` 独占创建（mkdir 先行）+ `writeAndValidate` 闸门，失败整组撤销；旧文件原地保留可回退。UI 按钮「⬇ 从 Hi 整首替换」。真网验证《富士山下》：200 / 7.2s，音频 4.0MB 换新（旧 6.2MB 保留）、专辑补全、歌词/封面新指针。
- **Hi 搜索导入新歌**：`POST /api/higequ/search`（`searchHi` 模块级导出，无 1 秒间隔/无缓存，人工挑条）+ `POST /api/higequ/import`（默认 ID `hi-<rid>` 可自定义；重复 409、坏 rid 400、无直链 404、白名单外 404、非 MP3 422，均不动库）；`parseHiDetail` 新增 `verifyIdentity:false`（导入以页面 spans 为准）并回传 title/artist。真网验证：搜索→导入「富士山下」200 / 4.4s，音频 4.0MB + 歌词 + 封面 + 条目（含专辑）一次到位。
- **新增面板重构**：「上传新歌曲」→「新增歌曲（Hi 搜索导入 / 手动上传）」：Hi 搜索框 + 结果行内一键导入（textContent 渲染防注入），手动上传收进内层折叠保留。管理器 serviceVersion 维持 `20260929-hi-audio`，**3100 进程已重启到本轮代码**；云端管理器未包含。
- **启动器幂等重启（提交 9bca7bf）**：`start-metadata.ps1` 删除硬编码版本比较与「复用旧进程」分支——改为每次双击先停 3100 监听进程、以最新代码重启（管理器无持久状态，重启零成本）。缘由：用户实测撞上「接口不存在」（浏览器新 UI + 旧进程无新路由），旧启动器硬编码版本已过期且只提示不处理。
- **门禁**：脚本离线 **51/51**（替换测试迁移+歌词/封面/字段覆盖断言；导入闭环：搜索→导入→重复 409→坏 rid 400→无直链 404 全链）、驱动 **85/85**。本轮新坑：写歌词/封面文件前必须先 mkdir（wx 遇缺目录直接 ENOENT）；`fetchLimited` 返回 Buffer，进 HTML 解析前必须 `.toString('utf8')`（并入陷阱 10.5 族）。

## 本轮新增（Hi歌曲音频下载：单曲手动触发、仅开发测试，2026-09-29）

按用户决策「能爬就爬，不用限速——手动操作不伤服务器，音频仅用于开发测试、非商用」交付，修订设计稿「不下载音频」红线（仅对本地管理器的 Hi 来源、单曲手动开放）。**改本机脚本与文档，未部署云端**（云端管理器仍 20260928-metadata-03，无此能力）。

- **实现**：①`higequ.mjs` 新增 `parseHiAudio`——实测站点把音频直链以 `let code="<base64>"` 服务端渲染进 player 页（酷我 CDN、免签名免 Referer，curl 抓包验证 ID3 头），解码后须过 `allowedAudioUrl` 白名单（`*.kuwo.cn` 族，https/443/无凭证）才是可用地址，测试夹具里的 `<audio src>` 依旧被无视；②`metadata-assets.mjs` 新增 `allowedAudioUrl` + `AUDIO_LIMIT`（64MB，实测单曲 4–15MB）；③管理器新增 `POST /api/tracks/:id/higequ-audio`：复用 `syncTrack` 的 higequ 身份校验（`metadataAccepted`，拒同名翻唱/现场版与低分）→ player 页 → 直链 → `fetchLimited` 下载（限重定向/域名/字节）→ MP3 魔数校验 → 新文件 `audio/<id>-<uuid>.mp3` + catalog 指针换新（`writeAndValidate` 闸门，失败撤文件），**旧音频原地保留**；④UI 编辑页新增「⬇ Hi音频」按钮（confirm 确认 + toast 回执）。不限速：无批量入口、逐首手动点击。serviceVersion 升 **`20260929-hi-audio`**。
- **验证**：脚本离线 **50/50**（higequ 解析 8 项新增：Base64/白名单/伪装域/非 443/非 .mp3/坏 Base64；管理器端点闭环 1 组：成功指针换新+旧文件保留+ID3 头、身份不符 422、无直链 404、白名单外 404、非 MP3 422，均不动库）、既有驱动 **85/85**；**真网单曲端到端**：临时副本曲库上对《有何不可》实抓——搜索→身份校验→直链→CDN 下载 **3.7MB / 6.7s**（未加限速）→ ID3 校验 → 指针换新、旧文件（5.8MB）原地保留，全程 200。
- **踩坑回填（陷阱 10.5）**：①`--import` 序列化 fetch 桩不能引用外层闭包（`player is not defined` 被端点包成 500，表象如网络失败）；②`syncTrack` 返回的判定字段是 `metadataAccepted`（身份+阈值合并口径），消费 `identityAccepted` 会恒 undefined——靠断言打印响应体当场定位。
- **边界**：音频仅限开发测试用途（用户决策），非商用；无批量抓取入口；其余来源（QQ/网易云/MusicBrainz）仍不下载音频；云端管理器未同步此能力。

## 本轮新增（恢复低分文字候选手动应用，2026-09-29）

2026-09-29：按用户指令恢复低置信度文字候选的手动应用。单曲 score < minScore 时只提示核对，不默认勾选，但可手动选择艺术家/专辑/年份/流派并应用；批量仍仅消费达标的 changes。资源未匹配到时不伪造封面或歌词候选。Chrome 实测 0.6 < 0.8 候选默认未选、可勾选并提交五月天；85/85接口回归通过。HTML按请求读取，刷新页面即生效，未改真实曲库。

## 本轮新增（本机管理器旧进程修复与当前歌词预览，2026-09-29）

- 用户截图来源仍为旧三源。实查本机 3100 的旧 Node 进程（PID 52392）返回 default=qq；HTML 每次请求读盘、ESM 来源注册表只在启动时加载，形成新页面配旧服务。已确认进程后仅重启本机管理器（新 PID 40440），实际 API 返回 serviceVersion=20260929-lyrics-preview、默认 higequ 与四源。
- 编辑区增加「预览当前歌词」及重新读取，读取 catalog 已保存引用；切歌与保存刷新时清除旧响应，按纯文本展示原始 LRC。无引用/丢文件明确提示，越界/非 .lrc/超 256KB 拒绝。新增 GET /api/tracks/:id/lyrics，仅只读。
- 页面检测服务版本并显示持久提示；启动器拒绝静默复用旧版，给出关闭旧进程再启动的指引。
- 47/47 离线单测、85/85 接口回归、Chrome（含歌词空缺/保存后读取/切歌旧响应/HTML按文本/旧服务提示/390px布局）PASS；启动器复用/新启动退出 0，缺构建/旧版本退出 1。
- 真实本机「有何不可」只读联网实测 source=higequ、metadataAccepted=true、lyrics=matched；已保存歌词读取 1142 字符。截图「倔强」catalog 未填 artist，ID3 回退为 kuwo，须手填正确歌手五月天并保存才可准确匹配；未替用户修改曲库。
- 仅本机管理器更新，云端版本、播放后端、安卓及真实曲库未改。[详细记录](test-results/2026-09-28-higequ-manager/README.md)。

## 本轮新增（M2 双机同步：真机 + MuMu 模拟器，机制与场景验证通过，95% 门槛待真机-真机复测，2026-09-28 深夜）

用户指示「真机+模拟器调试解决挂了很久的 M2（MuMu）」，中途改为「起云端环境来测试」。按主计划第 3 节标准执行，先按挂起项要求补齐测量方案与工具再测量。**纯测试轮：零代码改动（SyncMath/变速参数未动，遵守挂起期约束）**。证据：[2026-09-28 M2 双机](test-results/2026-09-28-m2-two-device/README.md)。

- **配对与角色**：A=PHQ110 真机（房主，debug `F79DFE09…`）+ B=MuMu 12 模拟器（成员，同 APK）；云端在产 release 20260928-1815、21 首真实曲库、房间 `C51742B9`；双机地址按陷阱 3.6/3.7 走存储层预置；省电均关。
- **测量工具（本轮入库，可复跑）**：`scripts/m2-diag-stats.mjs`（主口径：双机 diag JSONL 按 `estimatedServerMs` 服务端时钟对齐、1 秒桶配对，`correction=seek/speed` 分级统计——交接单第六节口径落地）；`scripts/m2-sync-sample.mjs`（交叉口径：每秒双机 `dumpsys media_session`，圈定本应用会话，顺序读取偏斜按各自读取时刻外推校正）。
- **10 分钟连续播放测量（自动顺播跨《红豆》《倔强》《囚鸟》）**：可比样本 **99.5%**（门槛 ≥90% ✅）；跨端偏差 ≤500ms 占比 **28.1%**（diag 口径，p50=732ms）/ 49.0%（dumpsys 口径）——**95% 门槛未达 ❌**。根因判明：**MuMu 模拟器音频时钟慢约 2–3%**——真机自身 drift p50=**258ms** 达标且零 seek，MuMu drift p50=934ms 且约 75% 时间处于变速追赶（窗口内 speed 纠正 448 次、0 次 seek、4 次缓冲），锯齿形态为「漂移爬升→变速/seek 回带内」的设计内循环，未失控。
- **场景验收（全部通过）**：①房主切歌成员跟随——双机同落新曲 ~4.7s 处、偏差 161ms；②成员本地暂停隔离——MuMu 冻结、真机继续前进；③恢复跟听——MuMu 恢复即重定位到 live 位置，**790ms** 内回带内（≤10s 门槛）。
- **M2 状态更新**：主计划从「缺第二台手机完全挂起」更新为「机制已验证（真机+MuMu），95% 门槛待真机-真机复测」；门槛在真机-真机组合复测前保持显式挂起（模拟器配对不作为该门槛判定依据）。第二台真机到位后用本轮工具按同口径复测即可。
- **边界**：音频层同录比对未做（标准允许仅报进度层）；15 人负载未重跑（沿用既有 load15 证据）；MuMu 为 x86_64（ARM 转译）不代表真机音频路径；观察到「持续时钟漂移下客户端反复脱离 500ms 带」的现象，若真机-真机也出现可讨论「小幅常驻变速」参数方向——本轮未动，仅记录。

## 本轮新增（Hi歌曲优先 + 管理页面优化，2026-09-28）

09-29 收尾：补验批量应用失败（409）后只重试失败歌曲、重新获取票据并应用成功，Chrome PASS；精简后的真管理器夹具复跑PASS。其他轮次记录原样保留。

按用户提供的 higequ.com 接入公开HTML元数据，并优化现有管理器。**只改本机脚本与文档，未修改真实曲库、服务端/协议/安卓，未部署云端**；云端管理器仍为上一轮 metadata-03。

- **来源优先与跳过**：默认 Hi歌曲 → QQ → 网易云 → MusicBrainz（明确选择旧源仍单源）；搜索严格核对标题/歌手及版本，详情读取专辑封面与 data-time 歌词转LRC，无年份/流派则留空；Hi歌词未取到再尝试 LRCLIB。12秒/2MB页面上限、1秒限速、同站跳转校验；仅扩展实际图床 img数字.kuwo.cn，资源仍过原票据和落库闸门，不请求音频。
- **页面**：专辑检索、分类缺项筛选、排序/计数、批量全库或当前筛选范围、停止后续匹配、失败重试、新旧值预览与实际来源说明、Hi原页面链接、窄屏适配。保留单曲歌词默认替换与批量只补缺的约定。
- **回收站**：新增清单及恢复入口；恢复原条目与回收文件副本，原回收件保留；已有ID/同名文件、路径越界拒绝，坏库先拒绝、提交失败撤销新副本，损坏批次不阻塞其他记录。
- **一键启动**：根目录 start-metadata.cmd → scripts/start-metadata.ps1；复用已运行管理器或隐藏启动后打开浏览器，缺构建产物明确提示。不会重启播放后端或自动同步曲库。
- **验收**：脚本离线 **47/47**，既有驱动 **85/85**，Chrome桌面/390px窄屏交互通过并留截图；启动器三分支模拟通过。真实只读抽查《有何不可》《单车》均拿到专辑/封面/时间轴歌词，两张JPG字节验证通过；《晴天》首次超时，重试成功。真实曲库未应用候选。
- **证据与参考**：[本轮验收](test-results/2026-09-28-higequ-manager/README.md)。GitHub调研参考 provider 分离设计，不复制代码；嵌套HTML解析、CRLF替换漏项与Windows Node测试入口教训回填陷阱清单。

## 本轮新增（结构拆分 + 封面双层缓存，2026-09-28 深夜，纯安卓重构、协议零改动）

回应「滑动卡顿 + 结构优化」：先实测定位，再按勘察结论动刀。APK 新锚 **`F79DFE09…`** 已装机。

- **卡顿定性（先测后改，PHQ110 同工况快滑 12 次、21 首带真实封面）**：debug 包 14.3% 掉帧/p90 40ms/p99 77ms；R8 benchmark（`assembleBenchmark` 重装实测）**1.1%/p90 16ms/p99 26ms**——用户手感的卡顿主因是 debug 包工具链（结论与 09-24「只认 R8 口径」一致），并证明 09-27 新增的歌单封面**没有**破坏 R8 流畅度。测量细节记于本轮会话，benchmark 包留在设备（`.benchmark` 后缀共存、不分发）。
- **封面双层缓存（真实热点修复）**：`CoverCache` 加内存 LruCache（堆 1/8、按 `Bitmap.byteCount` 计费、键 = `<id>-<coverVer>@<目标像素>`）+ 按 `targetPx` 降采样解码（`inJustDecodeBounds` 先读边界、`inSampleSize` 取 2 的幂）——44dp 缩略图不再解全尺寸 500×500 位图（约 1MB/行），且滚回可见区不再重复解码（原实现每次 `produceState` 重触发全尺寸解码）。`rememberCoverBitmap` 增加 `size: Dp` 参数并进 `produceState` 键（歌单行/MiniPlayer 44dp、展开页 180dp）；`RoomClient.fetchCover(track, targetPx)` 内存命中可主线程快速返回。
- **MainActivity 拆分（模块 01 挂账关闭）**：868 → **284** 行，只留组合根（ScreenState 采样、MediaController 接线、扫码落地、弹窗装配）与 `formatTime`（根包测试引用）；界面构件拆为 `ui/HomeScreen.kt`（221 行，JoinInput/JoinInputSaver/JoinForm/InviteConfirmCard，顺带删除 JoinForm 未使用的 snackbar 参数）、`ui/RoomScreen.kt`（308 行，RoomContent/StatusBanner/MembersSection/AvatarStack/PlaylistSection/PlaylistRow/statusLabel）、`ui/CommonUi.kt`（157 行，TopBar/ScanSourceSheet/InviteQrDialog），全部 `internal`；单 Activity + 单一不可变状态原则不变，权限 launcher 仍注册在 Activity（`ActivityResult` 契约不能挪进组合，见代码注释）。
- **门禁与装机**：单测 **128/128 实跑**、Lint 0、Debug 构建通过；`F79DFE09…` USB 装机回拉逐位一致。真机冒烟（房间 3BD75E24 延续）：歌单封面经新降采样路径正常显示、展开页 180dp 大图正常、歌词新键 `he-bu-ke-2065….lrc` 命中不重复下载、磁盘 19 张封面完好；优化后 debug 包同工况掉帧 **14.3% → 11.0%**（p90 40→34ms，内存缓存消除了重复解码尖峰；剩余为 debug 工具链固有开销）。证据截图 `16-refactor-smoke.png`/`17-refactor-playersheet.png`。APK 版本历史已补行。
- **边界**：本轮纯安卓重构，协议/服务端零改动；benchmark 包未重建（结构性变化对 R8 的影响待下次需要帧耗时结论时再测，届时以 benchmark 包为准）。

## 本轮新增（分支合并 + 云端管理器 metadata-03 + lyricsVer 缓存失效 release 20260928-1815，2026-09-28 深夜）

按优先级清挂账：①合并分叉分支；②云端管理器发新版对齐「匹配到歌词即默认勾选、应用即替换」口径；③`lyricsVer` 歌词缓存失效闭环（协议第 8 字段）。④元数据第三轮（通知栏歌手/专辑/编目自动生成）仍挂起未动。

- **①分支合并（main ← codex/metadata-manager-cloud，merge commit `7428c0c`）**：冲突仅 docs/verification.md（两侧各加了 09-28 顶部小节），按时间序手工合并并顺手修掉一处重复的更新日期行；`check-doc-links` 通过。此前 codex 分支上遗漏暂存的 `media/catalog.json`（21 首合并口径）已补提交（`02844ca`）。合并后 main 含全部历史，工作继续在 main。
- **②云端管理器 20260928-metadata-03（prev 20260928-metadata-02 可回滚）**：按既有发布流程（独立版本目录 + 夹具验收 + 切链接 + rollback trap），服务器侧 `node --test scripts/lib` **37/37**、离线驱动 **85/85**；发布前后生产 `media/catalog.json` SHA256 逐字节相同（21 首），管理器回 21 首、`/api/sources` 正常；**未重启播放后端**。tarball SHA256 `1c688613…`。
- **③lyricsVer（协议扩展：catalog 第 8 字段）**：服务端 `loadCatalog` 对每个 `.lrc` 算内容哈希+mtime 版本（`coverVersion` 泛化更名 `contentVersion`，与封面同源），`/catalog` 下发 `lyricsVer`（无歌词 null）；安卓 `Track` 解析 + `LrcCache` 缓存键改 `id-lyricsVer`（旧服务端缺字段时退回纯 id 键，向后兼容），换词后旧缓存自然失配重新下载，**「换歌词要手动清客户端缓存」的挂账就此关闭**。测试：服务端 `catalog.test.ts` 新增「换词版本必变/无词 null」断言、`cover.test.ts` null 语义扩展，**30/30** + tsc 0；安卓 `ModelsTest` 补解析与键命名用例，**128/128 实跑、0 失败**（127+1），Lint 0。文档同步：[protocol.md](protocol.md) REST 表、[设计稿](track-metadata-design.md)第 2 节（顺带把「固定 7 字段/album 下发」修正为实际的 8 字段、album 属第三轮未下发）、[模块 01](modules/01-android-ui.md)/[模块 08](modules/08-library-audio.md) 挂账关闭。
- **部署与装机（USB 冒烟通过）**：服务端 **release 20260928-1815**（prev 20260928-1718 可回滚；tarball SHA256 `f40cf886…`）已上云，基线 **14/14**；新 debug APK `F762D90579C91B6600B3C1F53B20FD69208C2A9377E13D1C55DDDC4FFC951671`（20,489,803 字节）USB 装机 PHQ110、回拉逐位一致。冒烟（房间 3BD75E24）：播放 PLAYING 1.0x、真实封面与歌手行正常、《有何不可》歌词净本渲染；**缓存键实证**——`cache/lyrics/` 出现新键 `he-bu-ke-2065500089251888.lrc`（0 个 U+FFFD），历史旧键 `<id>.lrc` 文件不再被命中（等待 LRU 淘汰），即 lyricsVer 链路端到端生效；「管理器换词 → 重启后端 → 客户端免清缓存自动拉新词」的完整 E2E 待下次实际换词时顺带验证（换词本就需重启后端加载新 catalog，见陷阱 8.10）。证据截图 `15-smoke-new-apk-lyrics.png`。
- **⑤清理**：删除本轮一次性产物（media 同步包 127MB + 暂存目录 136MB、两个 server-only 包、metadata-03 包、装机回拉 APK 副本），`.workbuddy` 维持 ~4.6MB；`media-originals` 三份备份（平铺旧库/坏歌词/合并前 catalog）全部保留。

## 本轮新增（元数据链路真机验收 + 云端曲库同步 + release 20260928-1718，2026-09-28 傍晚）

按用户指令「无线调试测元数据脚本：封面显示、歌词乱码」→「用云服务器测」→「media 本地重构完，云端还没同步」交付。真机当场抓到**歌词乱码真实缺陷**并闭环修复；封面从未在云端启用（部署缺口）随新 release 打开。证据：[2026-09-28 元数据真机验收](test-results/2026-09-28-metadata-device-check/README.md)。

- **歌词乱码（真机抓到 → 根因 → 修复 → 回归通过）**：《有何不可》第 4 行「起」字渲染为 U+FFFD。取证：云端 `he-bu-ke.lrc`/`te-bie-de-ren.lrc` 盘上字节已坏（2 文件 3 行），本地原件全净；09-27 12:27 的上云 tar 包**内已含坏字节**——根因是 `fetch-lrc.mjs` 用 `data += chunk` 逐块独立解码 https 响应 Buffer，跨块汉字整体变 U+FFFD（陷阱 10.4）。修复：`setEncoding('utf8')`；脚本门禁 37/37。云端坏字节已随同步被净本取代（坏文件留档 `media-originals/lyrics-corrupt-backup-20260928/`）；客户端按曲目 id 缓存歌词且无版本失效（既有挂账），本轮清缓存后重新下载验证净本渲染。
- **云端曲库同步（用户选定 21 首口径）**：云端 catalog 仅 21 首——《红日》《忘情水》为用户经云端管理器删除，保持剔除。本地重构布局（`audio/<id>.mp3` ASCII 名 + covers/lyrics）上云：旧平铺 mp3/covers/lyrics/旧 catalog 全量移入 `media-originals/media-flat-backup-20260928/`；合并保留云端 artist/album/year；《爱情转移》封面从云端取回按本地命名落盘 `covers/ai-qing-zhuan-yi.jpg`。音频抽样 md5 本地=云端（纯改名非转码）。本地 `media/catalog.json` 同步为 21 首口径（23 首合并版存档 .workbuddy）。
- **release 20260928-1718（prev=20260927-1240 可回滚）**：封面在产版是 `const cover = null` 置空停用（09-27 部署时刻意），真实现（commit 12cb8de）从未发版——本轮 server-only 打包上云（tarball SHA256 `65ac5e50…`；本地服务端 30/30 + tsc 0；服务器 npm ci→build→prune→切链接→restart），基线 **14/14**，dist 复核置空覆盖已移除、loadCatalog 产出 19/21 封面。两次 restart 均只清掉本轮自建的测试房间。
- **真机验收（PHQ110 无线 adb，装机锚回拉 `A586F93C…` 与当前 HEAD 重建逐位一致）**：21 首、歌手副行齐全；**19/21 歌单行/迷你条/播放页大封面真实专辑图**（《单车》《倔强》无独立封面按设计占位）；乱码修复行两处均完整；seek 2:10 当先行加粗跟随正确、繁简混排无乱码（lrclib 内容原样）；连续 9 次下一首切《特别的人》逐曲刷新；`dumpsys` PLAYING 1.0x。听感、双人同屏仍挂起；测试房间已退出。
- **边界**：通知栏歌手/专辑（第三轮）、`lyricsVer` 缓存失效挂账未动；本地与云端现已同布局同步，后续增删曲目需再走同步。

## 本轮新增（工作区三次清理，2026-09-28，无代码改动、无新代码 hash）

按[仓库清理标准](development-standards.md)六条执行的第三次清理：勘察（git 基线干净 + 全 docs 引用扫描）→ 逐项结论 → 清单经用户确认（A+B 全部执行）→ 只删安全区 → 删后门禁 → 本节登记。代码与协议零改动。

- **删除项（均 gitignore 覆盖、冗余/可再生，回收约 784MB，项目体积约 998MB → 214MB，git 跟踪文件零删除）**：①`.workbuddy/` 476MB → 4.5MB——删除 09-26 云端曲库上云的三个暂存（`tmp-lt-media.tar` / `tmp-lt-media-ascii.tar` / `media-stage` 各 133MB，本地 `media/` 完整 + 云端在产，纯冗余）、`cloud-device-followup/`（41MB，09-27 设备跟进 session 残留：两个过期 APK 副本 + 截图，docs 引用扫描零命中）、`deliverable-b1e80573.apk`（20MB 旧 session 交付副本）、`shots/`（14MB session 截图，证据已归档 docs/test-results/）、09-27 部署暂存与快照（deploy-stage-*/deploy2-stage-*/snapshot-*，<1MB）；②`android/app/build/`（313MB）全清后全量重建。
- **保留项**：`.workbuddy/memory/` 与可复跑驱动脚本（标准明文永不删）、`qrtool/`（二维码验证可复跑工具）、metadata/organize 脚本与 catalog 备份（09-27 个人曲库工作流，<1MB）、**`media/` 133MB 用户曲库本地副本**（云端 `/opt/listen-together/media` 在产 + `media-originals/` 有备份，本地用途不确定，按标准第 2 条保留并标注）、`demo-media/`（含本地唯一副本个人音频）、`docs/test-results/` 证据链、`server/`、`android/.gradle`（5.7MB 不值得动）。
- **门禁（实跑）**：全量重建后 `cleanTestDebugUnitTest → testDebugUnitTest → assembleDebug → lintDebug` BUILD SUCCESSFUL（3m22s，53/54 任务实跑），单测 **96/96 实跑、0 失败/错误/跳过**（XML 报告逐个统计），Lint 通过，`app-debug.apk` 再生 `a9289e82…`；`git status` 0 变更。（注：本轮时点装机锚为 517A776B…，当日晚间元数据轮后更新为 A586F93C…，见上方真机验收节。）

## 本轮新增（单曲匹配到歌词即默认勾选，应用即替换旧歌词，2026-09-28 晚）

按用户指令「修改掉这个设置，匹配到歌词后就可以替换掉旧的歌词」+「预览歌词现在能预览就不用再加」交付，只改本机 `scripts/` 与文档。**口径**：`/sync` 新增可选 `onlyIfEmpty`（补缺口径，已有值不进 `changes`）；单曲「匹配这首」不带它，故 LRCLIB 一命中就把 `lyrics` 报为默认勾选，本曲已引用歌词也照报，点「应用所勾选字段」即替换；批量「一键补缺」在 `/sync` 与 `/apply` 两端都带 `onlyIfEmpty: true`，已有歌词不动，界面那句「不会覆盖你已手填的内容」仍是真话。封面维持已有值不自动勾（换图须人工确认），歌词与封面的不对称是刻意的。**替换只换指针**：新文本另起 `lyrics/<id>-<uuid>.lrc`（`wx` 独占创建），catalog 改指它，旧 `.lrc` 原地保留（可能被别的曲目共用，也便于手工改回），写库照旧过整库 `loadCatalog`、失败逐字节回滚并撤销新文件。上一轮「已有歌词要在单曲候选中主动勾选」的表述自本轮起只对批量生效。**验证**：`check.ps1 -Scope scripts` **37/37**（真实管理器用例已改写：单曲口径 `changes.lyrics` 等于本次票据、`onlyIfEmpty` 口径为 undefined，并新增替换回归——指针换新文件且旧文件内容原样在盘）；离线驱动 **85/85** 复跑（其 `/sync` 不带 `includeLyrics`，不受影响）；Chrome UI 驱动 `docs/test-results/2026-09-28-metadata-assets/browser-check.mjs` 的模拟服务已按真实口径回 `changes` 并新增四条断言，实跑 PASS（`candidate-ui.png` 由该驱动重写）；另用真实浏览器在临时 1 首曲库走完「选已有歌词的曲 → 匹配这首 → 歌词框默认勾选 → 应用 → toast 已应用」，盘上核对 catalog 指向新 `.lrc`、`old.lrc` 内容未变。**未做**：未改服务端/协议/安卓，未碰真实 `media/`（验证全在一次性夹具，跑完即删）；**云端管理器 `listen-together-metadata` 仍是 20260928-metadata-02（旧口径），要生效需另发一版**；客户端歌词缓存按曲目 id 存、换歌词不自动失效（既有 `lyricsVer` 挂账）。证据：[元数据资源直用记录](test-results/2026-09-28-metadata-assets/README.md) 文末「追加小轮」。

## 本轮新增（歌词候选与封面一键应用，2026-09-28）

管理器匹配表新增「封面」「歌词」，勾选后直接下载/写文件/关联编目，无需先另存再上传；批量补缺包含二者，已有资源不自动覆盖。歌词独立尝试LRCLIB，按歌名/歌手/时长匹配，优先时间轴；未命中或失败跳过，不影响其他字段。资源票据绑定曲目与快照，限域名/超时/大小，整库校验失败回滚；换曲丢弃旧响应。脚本测试本机与Linux各37/37、原驱动85/85；Chrome实跑单曲/批量/换曲交互通过。云端真实抽查歌词synced 2138字节、封面JPG 58284字节，未应用生产曲库。管理器已升级20260928-metadata-02（prev 01），仅重启管理器，未重启听歌后端或发布APK。详见[验收记录](test-results/2026-09-28-metadata-assets/README.md)。

## 本轮新增（元数据管理器审查与上云，2026-09-28）

管理器已以独立服务 `listen-together-metadata` 部署，版本 `20260928-metadata-01`，仅监听云端 `127.0.0.1:3100`，通过 SSH 隧道访问。修复上传 audio/ 引用、共享封面清理、并发覆盖与非标准 JSON 字节回滚；补 Host/Origin 校验和回收批次防逃逸/防覆盖。服务端30/30、脚本31/31、管理器离线驱动85/85；Linux重跑31/31与85/85。生产23首清单发布前后逐字节相同，未同步本地音乐/封面，未重启播放后端（仍20260927-1240），未发布APK。独立管理账号与持久缓存/回收目录已经配置。详见[发布证据](test-results/2026-09-28-metadata-release/README.md)。此前“管理器只在本机、云端没有该工具”的范围描述自本轮起被本条取代；云端修改后仍需另行重启听歌后端。

## 本轮新增（曲库删除：单曲 + 批量，文件进回收目录可放回，2026-09-27 深夜）

按用户指令「这个脚本上没有删除音乐的功能，请你加上」交付。删除只在**本机可视化管理器**里做（`node scripts/metadata-manager.mjs`），云端曲库仍走 `scripts/add-media.ps1` + 服务器侧 `media-manage.sh`，本轮未碰服务端、协议、安卓。

- **接口**：`DELETE /api/tracks/:id?run=<批次名>&files=audio,cover,lyrics`。`files` 白名单外的 kind（含 `master` 之类臆造值）直接 400；批次名带路径穿越（`run=..%2Fescape`）400；不存在的 id 404。答复逐首回报 `{moved,skipped,failed,trashDir}`，**每一类文件都说明去向或为什么没动**，不做静默。
- **顺序是硬约束：闸门先行**。删除必须①先整库 `loadCatalog` 自检 →②移除条目并过 `writeAndValidate`（失败 422 逐字节回滚）→③**这之后**才动文件。反过来的话，"catalog 还引用着一份已经不存在的 MP3"会让后端下次启动直接失败。为此新增 **409** 分支：曲库当前校验不通过时回复「曲库当前校验不通过，未改动任何文件（请先修好曲库再删）」，并断言一个空批次目录都不留（没动文件就不该留痕）。409/422/500 三种失败口径分开：409=库本来就是坏的、422=这次写把它改坏了已回滚、500=非预期错误。
- **文件一律移入回收目录，绝不 `unlink`**：`TRASH_DIR/<批次>/<库内相对路径>`（默认 `.workbuddy/media-trash`，新增 `--trash` 可挪根，夹具据此把回收目录放在曲库**之外**）+ 每批次一份 `manifest.jsonl`，记录被删条目**原文**、每个文件的 `from`/`to`、`skipped` 原因、`failed` 报错。放回不靠记忆重填字段。跨分区/权限受限时（EXDEV/EPERM/EACCES）退化为复制后删原文件；移文件失败只进 `failed[]` 如实上报，条目删除照常成立（绝不出现"目录里还有条目、文件已消失"的半途状态）。
- **三类文件都按引用计数决定归属**（音频/独立封面/歌词同一套 `otherReferrers`）：只有**独占**的文件才随曲目进回收目录；被别的曲目共用的留在原地并在 `skipped` 里点名"谁还在引用"（例如「track-c 仍指向同一个音频文件，文件保留」）。这是把删除做对的关键——两首指向同一个 `.mp3` 或同一张封面时，无脑移走会把另一首当场变成坏条目。另外：`covers/` 之外的封面路径（手滑填错）**只删条目不动文件**，工具只回收自己放进去的东西。
- **界面**：顶栏「多选删除」进入勾选态（逐首复选框 + 底部选择条），每行也有单曲「删除」。对话框里先逐首列出「标题 ｜ 歌手 ｜ id ｜ 音频 / 独立封面 / 歌词」再按类勾选（本批没有该类就显示「本批没有」并置灰），确认后才发请求；批量逐首独立成败、带进度行，**失败的首留在对话框里并重新启用「确认删除」以便重试**，全部成功才关窗。批量共用一个批次名（`ui-<时间戳 36>`），一轮删除在回收目录里是一个可整体放回的批次。删除前若编辑器有未保存内容会先走 `confirmDiscard()`。动态文本仍用 `textContent` 渲染。
- **门禁与验证**：`scripts/lib/metadata-sources.test.mjs` 等离线单测 **31/31**（`scripts/check.ps1 -Scope scripts`；此前文档记的 29 是并发会话新增 ID3 两项前的口径，已按实跑更正）；**可复跑离线驱动** `docs/test-results/2026-09-27-metadata-sources/manager-offline-check.mjs` 由 6 组扩至 **8 组 / 77 项断言（77/77 通过）**，新增第 [8] 组专测删除：夹具里 track-a 与 track-b 共用一份 `.lrc`、track-a 与 track-c 共用一张走接口上传的独立封面、track-c 与 track-d 共用同一个音频文件、track-d 的 `cover` 手写指向库根 `stray.png`——4 组共享关系一次跑齐"闸门 409 不动任何文件 / 共用留文件并点名 / 最后一份引用消失才随曲目进回收目录并保留库内相对路径 / covers/ 外只删条目 / 没有独立封面如实说明 / manifest 行数与内容 / 删到空库管理器仍正常服务"。**驱动当场抓出两个真实缺陷**：①`managedCoverPath` 原先用 `resolve(COVER_DIR) + '\\'` 拼前缀判断归属，在 POSIX 口径下永远为假，表现为"独立封面明明在却认不出来"，改为与歌词同源的 `insideDir()` 统一跨平台目录比较；②引用计数原先只有歌词有，封面与音频漏掉。浏览器实跑（一次性拷 4 首真实曲库到临时目录起管理器）：批量删 2 首（共用的 `covers/he-bu-ke.jpg` 先留后走）、单曲删《痴心绝对》并**取消勾选音频**→ `audio/chi-xin-jue-dui.mp3` 原地不动、把 catalog 改成指向不存在的 mp3 制造坏库 → 界面出现红色 409 行且对话框不关、确认删除重新可点。证据：[元数据源整合](test-results/2026-09-27-metadata-sources/README.md)（同一证据目录追加「删除曲目」小节）。陷阱回填第 7 节两条（目录归属判断必须走同一个跨平台口径；删除这类"先写库还是先动文件"的顺序坑与 409/422 语义分工）。收口时复跑：`scripts` **31/31**、离线驱动 **77/77**、`check-doc-links` 通过，并顺手复跑**未改动**的服务端测试确认基线 **30/30**（HEAD 与模块 10 的口径一致，无漂移）。
- **未覆盖（如实标注）**：本轮**没有截图证据**——浏览器自动化侧 `take_screenshot` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`，改用可访问性快照 + `evaluate_script` + 盘上 `find` 核对文件去向。界面只跑完上述三条路径，**删到空库后的界面观感**（空状态提示）未单独目视，仅接口级断言 `GET /api/tracks` 返回 0 首且继续服务。未做真机（本轮不涉及安卓），未部署云端。
- **工作区状态提醒（并发会话遗留，非本轮改动）**：入库模板 `media/catalog.json` 当前是**本机 23 首真实编目**（`audio/` 前缀布局）而不是此前登记的 `[]`；上一小节"已还原为 `[]`"的表述因此过期。本轮删除功能**没有改动真实曲库**（所有删除动作都发生在临时夹具里）。要恢复"模板为空"的口径需另行确认，不擅自回退。

## 本轮新增（元数据抓取并入可视化管理器 + 三源匹配，2026-09-27 晚）

按用户指令「整合爬取音乐数据的脚本和元数据可视化脚本，方便管理」+「来源可以是 QQ 音乐或网易云音乐」+「删掉 CLI，只留界面」交付。元数据管理从此只有一个入口：`node scripts/metadata-manager.mjs`。

- **删除 CLI**：`scripts/fetch-metadata.mjs` 已移出仓库（本机留档 `.workbuddy/fetch-metadata.removed-from-repo.mjs`，gitignored），它的抓取/打分/缓存能力全部并入共享模块，**文件不复存在，勿按旧记录去找**。原「元数据自动匹配脚本，只读预览」小节随之作废，历史证据保留在 [test-results/2026-09-27-metadata-fetcher](test-results/2026-09-27-metadata-fetcher/README.md)。
- **新增共享模块 `scripts/lib/metadata-sources.mjs`**：三个源归一到同一候选形状与**同一套打分/阈值**——`qq`（默认，`search_for_qq_cp` 一次请求拿全标题/歌手/专辑/年份/时长/封面）、`netease`（`api/cloudsearch/pc`，主接口失败退旧接口，两条都不通把两个原因一起抛出）、`musicbrainz`（唯一能给出可读流派的源）。国内平台不返回数值相关度，故按**结果名次**推导（榜首满分、榜尾衰减），已用测试钉住「网易云榜首是翻唱时必须选中原唱」。每源独立限速队列（MB 1.1s、QQ/网易云 0.8s），出网只取搜索文本与封面地址，**不下载音频、不带登录 Cookie、不做批量爬站**。
- **管理器新增三条接口**：`GET /api/sources`（源清单，界面下拉由注册表驱动，加源只改 lib）、`POST /api/tracks/:id/sync`（`source`/`minScore`/`refresh`；未知源与非法阈值直接 400，出网失败按单首 502 返回以便批量继续；缓存键含源名，避免「QQ 无候选」被当成「网易云无候选」）、`POST /api/tracks/:id/apply`（勾选后落库；候选值先验类型——`year` 必须是 1800–2100 整数，杜绝 `applyEdit` 的空值即删语义把字段悄悄清掉；`onlyIfEmpty` 在写前按当前编目再挡一层覆盖）。
- **界面新增**：单曲「🌐 联网匹配元数据」（源选择 + 阈值 + 忽略缓存重查 + 候选对照表 + 逐字段勾选）与顶栏「批量匹配缺字段」（串行、带 ETA、`onlyIfEmpty` 只补空）。候选一律用 `textContent` 渲染（外部文本不可信），应用只读 `dataset` 值而非表格显示文字；**切换曲目会清掉上一首候选**，否则勾选框残留会把旧候选写进新歌。低于阈值不给封面地址。
- **门禁与验证**：新增离线单测 `scripts/lib/metadata-sources.test.mjs` **29 项**（注入 `request`/`sleep`/`now`，全程不碰公网；同日 ID3 读取两项并入同一文件后现口径 **31/31**），`scripts/check.ps1` 新增 `-Scope scripts` 档（Windows 下必须用 `--test scripts/**/*.test.mjs` glob 形式）。夹具端到端由一次性脚本升级为**留存在证据目录、可复跑的离线驱动** `docs/test-results/2026-09-27-metadata-sources/manager-offline-check.mjs`（起真管理器进程 + 临时曲库 + `--cache` 挪开真实缓存，全程不出网），**起步 6 组 / 37 项断言，当日累加至 8 组 / 77 项（本轮删除轮复跑 77/77）**：三源缓存互不污染、达标候选只补缺失字段、低于阈值不给 `changes` 也不给封面、apply 的脏值/越界/空串全部 400 且曲库一字节未变、`onlyIfEmpty` 只补真空缺、整库校验失败回 422 并逐字节回滚且管理器继续服务、出网失败（第 [7] 组（原 [6]，UX 轮插入歌词组后顺延）用 `--import` 预加载把该实例的 `globalThis.fetch` 换成必抛，仍零公网）回 502 而非 500 且不写缓存、批量其余各首照常。**驱动当场抓出一个真实缺陷**：「低于阈值不给封面地址」原先只在源层按当时的阈值执行，缓存里的旧 `coverUrl` 会绕过界面后来调高的阈值继续可点——已在 `syncTrack` 返回处按本次阈值再闸一次（教训：缓存存的是判定结果、判定参数却随请求变化）。真实 23 首曲库三源实测：QQ《有何不可》→自定义/2009、《单车》→Shall We Dance? Shall We Talk!/2001、《痴心绝对》→李圣杰/痴心绝对/2002，网易云《句号》→摩天动物园/2019，MusicBrainz→自定义/2009；夹具曲库上浏览器实跑「匹配→勾选→应用」，落盘后逐字段对账 `catalog.json`（`he-bu-ke` 得到 `album: 自定义` / `year: 2009`），并确认切到其他曲目时候选表清空、应用按钮转灰。**只改本机脚本与文档**：未改服务端、协议、安卓，未部署云端，`media/catalog.json` 入库模板当时已还原为 `[]`（**现已不成立**：同日 media 分区重构轮把它写成了本机 23 首真实编目，见本节开头「工作区状态提醒」）。证据：[元数据源整合](test-results/2026-09-27-metadata-sources/README.md)。陷阱回填第 7 节五条：`node --test` 在 Windows 必须用 glob 形式、国内平台接口现状（Referer 必需 / 失效端点 / 秒与毫秒 / 网易云榜首常是翻唱）、"空值即删"语义遇到外部候选会静默丢字段、缓存里存判定结果而判定参数随请求变化、`spawn(node,…)` 里 Node 开关（`--import`）必须排在脚本路径之前否则静默失效。

- **未覆盖（如实标注）**：浏览器里只实跑了单曲「匹配→勾选→应用」与换曲清空，**批量匹配区只做到接口级**（逐首 `/sync` + `onlyIfEmpty` 应用有夹具断言，未在界面上跑完一整轮并看 ETA 进度）；三源在真实 23 首全库的**逐首命中率没有统计**（只做了 5 组抽查）；未做真机（本轮不涉及安卓）。重跑本机真机前要先 `node scripts/build-local-catalog.mjs` 重新装配曲库——入库模板当时已还原 `[]`；**该状态现已不成立**——同日 media 分区重构轮把本机 `media/catalog.json` 写成了 23 首真实编目，本轮复跑时已是那份真实编目（详见本节开头的「工作区状态提醒」）。
- **边界**：`album`/`genre`/`year` 目前是工具保留字段，服务端 `loadCatalog` 忽略未知键、catalog 下发不含它们，补齐后**不改变线上行为**（第三轮才消费）。

## 本轮新增（独立封面管理，2026-09-27）

- **本地管理器已支持封面上传**：`scripts/metadata-manager.html` 增加上传/替换/移除控件；浏览器把大图缩放到最长边 1024px 并压到 1MB 内，服务端按 JPG/PNG/WebP 文件头再次校验。
- **曲库格式**：`catalog.json` 可选 `cover` 相对路径，文件落在 `media/covers/`；服务端独立图片优先，没有独立图片时回退 MP3 内嵌 ID3。`coverVer` 使用图片内容哈希加文件时间，替换后 Android 的现有缓存键自动变化。
- **安全与回滚**：封面路径与歌词一样做 realpath 根目录校验；上传写入新文件、更新 catalog 并通过同一套 `loadCatalog` 校验，失败删除新文件并恢复旧清单；移除后仍可回退到 ID3 封面。
- **验证**：服务端 `npm run build` 通过；服务端 **30/30** 测试通过（新增独立封面加载/版本与路径/格式边界测试）；临时曲库对管理器上传→列表→字节读取→移除全流程 smoke 通过。安卓未改源码，无需重装现有 APK。详见 [封面管理记录](test-results/2026-09-27-cover-manager/README.md)。
- **边界**：本轮只完成本机管理闭环，未把封面文件发布到云端，也未做真机真实封面目视；云端发布需要把 `media/covers/` 与 catalog 一并上传并在无人使用时重启（会清空内存房间）。

## 本轮新增（云端真机补验 + 歌词跟随修复，2026-09-27 下午）

- **真机发现并修复**：旧包 `85484698…` 的《有何不可》暂停在 0:50，手动翻歌词后等待仍停在后续段落。根因是恢复只改 `manualPaused`，滚动却只监听当前行变化；暂停/长句不换行时永远不归位。新增 `LyricsFollow.kt` 目标流，同时观察当前行与手动暂停状态；恢复同一行也定位，暂停取消旧动画。切歌通过 `key(id, hasLyrics)` 重建取值与列表状态。
- **用户确认的最终交互**：删除「回到当前歌词」提示/按钮；手势与惯性滚动停止 **3 秒**后自动回到当前句，继续翻看重新计时。最终真机截图确认无按钮；提前采样与继续翻看都未回位，稳定后歌词区域与初始当前句逐像素一致（平均差 0.0）。中间包的 500ms/按钮验证不作为最终交互结论。
- **云端歌词设备门槛关闭**：手机连接公网 `20260927-1240`，备份并清除单首旧缓存后重新下载，2,147 字节与云端 HTTP 响应 SHA256 一致；渲染、播放跟随（0:50→1:26）、滚动后切歌、无时间轴占位通过。媒体会话 PLAYING/1.0x；设备媒体音量为 0，本轮不宣称听感验收。
- **相机新入口回归关闭**：右上角扫码→来源弹窗→相机 Activity，用户实际对准电脑二维码并确认识别；恢复 USB 后取证已入同一云端房间（2 人、23 首）。首次相机权限分支未重测。
- **门禁与交付**：新增 `LyricsFollowTest` 4 项，安卓 **127/127**，失败/错误/跳过均 0；Lint **0**（发现并清理相册解码器 `UseKtx` 警告，最终报告重新生成）；Debug + R8 benchmark 构建成功。最终 debug **`A586F93C7E7487A8ACB67A4A82170D4AE4F2AF5EBA020DEA42AD9AA826D2E13F`**（20,489,954 字节，**已装机并回拉字节数/哈希一致**）；benchmark **`E7053FE570CDB67C248ED0EF89029601ED4D0B5862F4839EB836B5C7C9D4FDB1`**（未装机）。本轮只改安卓与文档，未改协议/后端、未部署，后端单测未重跑。
- **收尾与边界**：仅创建一个测试房间，手机与脚本房主均已退出，空房按既有机制 5 分钟回收；未关闭热点、未开飞行模式。2 倍字号、小屏、双真机、听感/触感等仍挂起。「回到当前歌词」按钮点击项随用户删除按钮而作废。陷阱回填 4.9。证据：[云端真机补验与歌词修复](test-results/2026-09-27-cloud-device-followup/README.md)。

## 本轮新增（修补上云：配额文案澄清 + 建房来源 IP 进日志，release 20260927-1240，2026-09-27 白天）

用户反馈「为什么显示同一来源最多创建三个房间？难道之前创建的都没有清掉吗？」。排查结论：**配额机制正常，是我的部署验收把额度占满**；但反馈暴露两个真实问题，本轮修掉并上云。

- **排查证据**：云端日志时间线显示——用户房间在我部署 restart 时已清空；随后我的三个验收空房（12:27:47 / 12:28:02 / 12:28:15）占满配额；12:29:48 建房成功证明第 1 个已回收；12:32:47→12:34:49 四条 `room.deleted reason=empty-timeout` 证明**空房 5 分钟回收机制正常工作**。机制：空房保留 5 分钟供掉线重连（`EMPTY_ROOM_MS`），配额按「同来源 IP 同时活跃房间 ≤3」计，不按历史累计，restart 清空全部房间。
- **修复 ①（文案）**：429 文案由「同一来源最多同时创建 3 个房间，请先使用已有房间」改为「…；**空的房间保留 5 分钟后自动回收**，请稍后重试或使用已有房间」——原文案没提自动回收，用户合理误以为配额只增不减。「5 分钟」由 `EMPTY_ROOM_MS / 60_000` 推导，避免常量与文案不同步。
- **修复 ②（诊断）**：`room.created` 事件增加 `creatorIp`。排查时日志里没有来源 IP、只能靠时间线反推；现可直接看出额度被谁占。`src/events.ts` 的红线注释显式登记该例外（仅排障用、不下发客户端、不参与身份判定）。
- **回归测试**：`rooms.test.ts` 增加「文案必须含『5 分钟后自动回收』」（store 层 + HTTP 层各一处）与「`room.created` 必须带 `creatorIp`」断言；事件红线测试（禁令牌/昵称）保持通过。
- **门禁与验收**：服务端 `tsc` 0 错误 + **28/28**；release `20260927-1240`（prev `20260927-1226` 可回滚；tarball SHA256 `d9f0e2f8…` 服务器侧一致）；构建产物含新文案与 `creatorIp`；公网实测第 4 次建房返回新文案，日志出现 `"creatorIp":"182.102.17.83"`；部署基线 `m4-deploy-verify.sh` **14/14**（配额回收后复跑）。**只改服务端，无需重装 APK**（429 文案由服务端下发）。证据：[修补上云记录](test-results/2026-09-27-cloud-patch-quota-message/README.md)。

## 本轮新增（后端上云：release 20260927-1226 歌词管线 + 7 字段曲库，2026-09-27 白天）

用户指示「上云」。把元数据第一二轮的后端改动与 23 份歌词部署到试用实例，替换 `20260926-1822`。**restart 清空内存房间**（部署前云端 1 个活动房间，用户已授权）。

- **部署内容**：①后端打包为 `listen-together-20260927-1226-server-only.tar.gz`（61,953 字节，SHA256 `2020ef25…`），服务器侧 `npm ci` → `tsc` → `prune --omit=dev`；②`media/lyrics/` 23 个 `.lrc` 解到持久层；③云端 catalog 由 3 字段升为 4 字段（**只追加 `lyrics` 引用**，保留中文 `file` 名、不补 artist），由新增 `scripts/build-cloud-catalog.mjs` 在本地生成。
- **为什么不走 `package-deploy.ps1`**：该脚本会把本地 `media/` 整体打进包，而本地 catalog 是 `<id>.mp3` 的 ASCII 布局，直接部署会**覆盖云端中文名曲库**。本轮手动只打 `server/`，歌词与 catalog 单独安装；脚本未改（其设计面向"曲库随包发布"的首次部署）。
- **验收证据**：①部署基线脚本 `m4-deploy-verify.sh` 云端执行 **pass=14 fail=0**（建房/令牌、catalog、401、音频全量与 Range 三态与 416、WS 握手与 401 拒绝、收尾）；②公网歌词专项：catalog 7 字段 23 首、`hasLyrics` **23/23**、无路径泄漏、`lyrics/he-bu-ke` 200 `text/plain; charset=utf-8` + `private, no-store` + 中文原样、`lyrics/chi-xin-jue-dui` 1777 字节公网复核、占位歌词 200、不存在 404、无令牌 401、音频 200 `audio/mpeg`；③服务器侧逐条 stat 校验 `lyrics refs ok=23 bad=0`，`dist/routes/` 含 audio/cover/lyrics 三个 js；④符号链接与 `current-version.txt` 一致（`id=20260927-1226 / prev=20260926-1822`，prev 目录真实存在可回滚），旧 catalog 已备份至 `media-originals/catalog-<时间戳>/`。
- **部署中解决的问题**：`npm ci` 报 `EACCES` 的**根因是 `/opt/listen-together/.npm` 缓存归属 root**（连带一堆指向 node_modules 的 `TAR_ENTRY_ERROR ENOENT` 噪声，极易误判为包损坏）——已 `chown` 修复并改用项目外缓存；另：带中文的脚本经 PowerShell→ssh 管道会被串码（连引号都被吃掉），改为 scp 上传后云端执行。陷阱回填 **10.1**。
- **未做（如实标注）**：**设备端对云端新后端的歌词冒烟未做**——验收时用户正在使用手机（前台为其他应用），未强制重启其 APP 打断使用。设备 `baseUrl` 已是云端地址，退出重入房间即可看到歌词。云端 catalog 仍无 `artist` 字段（最小改动；字段缺失时安卓显示为空、不占行高，行为安全），如需补齐用 `build-cloud-catalog.mjs` 去掉 `--no-artist` 重新生成 + 重传 + restart。
- **回滚**：`ln -sfn /opt/listen-together/releases/20260926-1822/server /opt/listen-together/server` + `systemctl restart listen-together`，并把 `current-version.txt` 的 `id=` 改回实际在产版本（见部署手册第 5 节）。证据：[2026-09-27 后端上云](test-results/2026-09-27-cloud-deploy-lyrics/README.md)。

## 本轮新增（首页与扫码交互调整 + 相册扫码，2026-09-27 白天）

用户连续四批反馈，一次交付。**只动 `android/app`**：未改 `server/`、未改协议、未部署云端。

- **扫码入口移到右上角**：首页「加入房间」分支的整行按钮删除，改为顶栏右上角图标（`Icons.Outlined.QrCodeScanner`，content-desc「扫描邀请二维码」）；只在未入房且处于加入分支时出现，入房后同一位置由「显示邀请二维码」接管——同一位置承载"我去扫别人"与"别人扫我"两面。
- **新增相册选图扫码**（用户点名的"不能扫本地文件"）：新增 `ui/LocalQrDecoder.kt`——用 **ZXing core** 直接解码（zxing-android-embedded 只提供相机取景框，没有扫本地图能力）；两段式读取（先 `inJustDecodeBounds` 算 `inSampleSize` 再解码，避免 4000px 原图整读 OOM）+ 三档缩放兜底（原尺寸 / 0.5 / 0.25，小于 16px 丢弃）。入口改为底部弹窗 `ScanSourceSheet`：「用相机扫描」（保留实时扫）与「从相册选择图片」（`GetContent("image/*")`，**不申请存储权限**，解码在 `Dispatchers.IO`）。
- **首页标语删除**：「此刻，一起听」+「和朋友分享同一段旋律」整块移除，进入即见表单。
- **邀请二维码弹窗改匀称**：删除二维码下方的解释文字；标题由 AlertDialog 默认 `headlineSmall` 收为 `titleMedium`；二维码横向留 12dp。
- **验证**：**用户真机实测相册选图扫码成功入房**；自动化侧用 `jsQR`（与生成端 `qrcode` 不同实现）对设备截屏独立反解，读出完整口令，证明弹窗内二维码可扫性未受排版改动影响。相册扫码路径另有一次 App 侧日志实证（`bounds=720x720` → 解出 65 字符 → 房间码与地址正确填入表单）。
- **门禁（实跑）**：`cleanTestDebugUnitTest → testDebugUnitTest → lintDebug → assembleDebug → assembleBenchmark` **BUILD SUCCESSFUL**；单测 **123/123、0 失败/错误/跳过**（19 个测试类；新增 `LocalQrDecoderTest` 5 项——采样率与缩放档位是纯函数，直接决定"二维码截图能不能被解出"，真实解码路径依赖 Android 图形栈、由真机覆盖并在单测注释里写明）；Lint 报告先删再生、`<issue ` 计数 **0**。
- **交付锚**：debug `854846985C5420A68CF05E677267FC9185CA0B6317432197181D8B46538BB77E`（20,489,954 字节，**已装机且回拉一致**）；benchmark `AE3DFF35B16FE3570ACFB7AF2C36063F1DA8447DFAD0AF0437BB604D2C28A6B8`（未装机）。证据：[2026-09-27 首页与扫码交互](test-results/2026-09-27-home-scan-ux/README.md)。
- **验收过程教训（已回填陷阱 3.10）**：自动化"从相册选图"时自己的 `screencap` 会把相册首屏占满且网格持续平移，反复点错图（日志 `bounds=1080x2412` 即铁证），一度误判为解码器缺陷。清理后一次通过。
- **未覆盖**：**相机实时扫**在新入口下的回归（需真人对准屏幕，本轮未自动化）；云端部署（用户明确「先别动云端」，故试用环境仍无歌词——非缺陷）。

## 本轮新增（元数据第二轮真机验收 + 歌词状态缺陷修复，2026-09-27 凌晨）

用户指示「请你装机验收一下，现在我连接 USB」。本轮完成元数据第二轮的真机门槛（歌词页 + 占位封面），**并在验收中发现并修复一个真实缺陷**。设备 PHQ110 `fbddbe8`（USB 一次识别成功，全程未抖动）。为不动公网，按用户选择把云端 23 首曲库拉到本地、起本机后端，设备经 `adb reverse` 以**成员**身份跟听（新增 `scripts/host-remote.mjs` 由电脑侧当房主控制）。

- **曲库落地（不碰云端）**：云端打包时用 `tar --transform` 把中文名换成曲目 id（Windows 自带 tar 按 ANSI 解析 tar 头会把中文名解成乱码甚至解包失败，**陷阱 1.8**），scp 下载 138,987,520 字节逐位一致，本机解包 23/23 成功；新增 `scripts/build-local-catalog.mjs` 把 catalog 的 `file` 映射为 `<id>.mp3` 并挂 `lyrics` 引用（23/23），缺文件即失败不产半成品。
- **服务端（本机真实曲库）**：tsc 0 错误、**28/28 通过**；catalog 7 字段 23 首、`hasLyrics` 23/23、artist 由 ID3 兜底解析（李圣杰/陈奕迅/G.E.M. 邓紫棋）；`/lyrics` 200/404/401 三档与 `text/plain; charset=utf-8`+`private, no-store` 实测符合协议；响应无路径泄漏。
- **占位封面**：歌单行 44dp、MiniPlayer 44dp、展开页 180dp 三处统一 `CoverPlaceholder` 真机目视通过。
- **歌词页真机通过**：真实歌词渲染、**逐行跟随**（5 次采样进度 0:55→1:37 高亮行与时间轴逐一对齐）、**手动翻看暂停跟随**（歌词停在列表末尾不跟）、**松手后自动恢复**（4 秒后对齐回当前行）、**「回到当前歌词」按钮出现**（滑动后 300ms 抢拍证实）、切歌重载歌词、无时间轴占位（单车）、无歌词占位、文件恢复后正常渲染。附带：播放跟听链路 `dumpsys media_session` PLAYING/1.04x、自动切下一首、播放动效条连拍 3 帧像素各异。**未覆盖**：「回到当前歌词」未在 sheet 内完成一次干净点击（首次点击落在按钮下方致 sheet 收起，跳回效果已发生）。
- **发现并修复缺陷（本轮主要代码产出）**：catalog 有 `lyrics` 引用但磁盘 `.lrc` 缺失（服务端正确 404）时，歌词区**卡在「歌词加载中」超过两分钟**。定位靠两处埋点：producer 60ms 内返回 null 并已赋值，渲染分支读到 `lyricText=null hasLyrics=true`——**问题在判断而非取值**。根因：`produceState` 用 `""`/`null` 兼职"加载中/没内容"两种语义，渲染却在 `null` 分支里又按 `track.hasLyrics` 二分，导致「这首歌还没有歌词」**实际不可达**。修复：新增 `ui/LyricsState.kt` 纯函数（`lyricsUiState`/`lyricsPlaceholderText`）显式区分 `Loading`（仅 `""`）/`NoLyrics`（`null` 一律归此）/`NoTimeline`/`Ready`，`LyricsSection` 改为按枚举渲染；新增 `LyricsStateTest` **7 项**（含"加载文案 ≠ 失败文案"断言，该断言当场抓出修复第一版的同类错误）。陷阱回填 **4.8**。
- **门禁（实跑）**：安卓 `cleanTestDebugUnitTest → testDebugUnitTest → lintDebug → assembleDebug → assembleBenchmark` **BUILD SUCCESSFUL**（5m48s）；单测 **118/118、0 失败/错误/跳过**（18 个测试类，基线 111 + 7）；Lint 报告**先删再生**、`<issue ` 计数 **0**；debug/benchmark 均构建成功。
- **交付锚**：debug `7C503FDD5853BD252705EA527B6B5D5FE4B7F3EA10E72EE8E5241E2C1046BF9A`（20,484,498 字节，**已装机**，`pm path` 回拉字节+SHA256 逐位一致）；benchmark `3945E4C83E21597B1D5D6910764F7FA35077D2094B0002138B6E3B4F6AE576E0`（未装机）。上一轮 `b1e80573…` 因本轮修复**已被取代**。证据：[2026-09-27 真机验收](test-results/2026-09-27-metadata-r2-device/README.md)。
- **未覆盖（如实标注）**：**云端仍未部署**（新后端 `/lyrics`、21 个真实 `.lrc`、云端 catalog 的 `lyrics` 引用均未上云；`add-media.ps1` 歌词通道未补），需 restart 清房间、等用户开窗；真实封面渲染（服务端提取临时停用）、歌词长列表快滑、2 倍系统字号、小屏布局、双人真机同屏均未覆盖。

## 本轮新增（歌曲元数据第二轮：歌词管线 + 封面统一静态占位，2026-09-26 深夜）

按用户指令「先生成已存在歌曲的歌词文件，封面现在统一占位。再开始第二轮」落地。封面按 AskUserQuestion 确认口径为**暂时停用提取、回退为静态占位**（数据流零影响，骨架保留一行即恢复）；歌词来源经用户授权改用公开 lrclib.net 批量抓取（覆盖设计稿"仅人工维护来源"约束）。WS 协议与 state Schema 仍然不动。

- **歌词文件生成**（`scripts/fetch-lrc.mjs`）：按 `id<TAB>标题<TAB>时长[<TAB>歌手]` 从 lrclib.net 搜带时间戳歌词，**21/23 命中**；「单车」「红日」经查确无 synced 条目（非临时故障），写入说明性占位 `.lrc`（`; 未在 lrclib.net 匹配到…`），产物在 `media/lyrics/`。503/繁忙响应单帧重试，无时长回退搜索。
- **封面临时停用**（`server/src/library/catalog.ts`）：`cover`/`coverVer` 强制置 null（注释标注删掉即恢复），`hasCover` 恒 false → 安卓跳过网络路径，`/cover` 路由在位但一律 404；UI 统一 `CoverPlaceholder`（渐变圆角 + 列表图标，`ui/CoverView.kt` 新增），歌单行 44dp、MiniPlayer 44dp、PlayerSheet 180dp 三处使用。
- **服务端歌词管线**：Track 加内部字段 `lyricsPath`；catalog.json 可选 `lyrics` 相对路径，启动校验（realpath 仍在曲库根内、`.lrc`、≤256KB，违规启动失败）；新增 `GET /api/rooms/:code/lyrics/:id`（`server/src/routes/lyrics.ts`，Bearer 鉴权，404 语义：歌曲不存在 / 该歌曲没有歌词 / 歌词文件缺失，`text/plain; charset=utf-8` + private no-store）；catalog 下发扩至 7 字段（追加 `hasLyrics`，路径不出服务端）。
- **上架脚本**（`scripts/media-manage.sh`）：新 `lyrics` 子命令——id 必须在 catalog、≤256KB、必须含时间戳行、BOM 剥离、写 `catalog.json` 引用；`verify` 输出补 歌手/封面/歌词 三列。dry-run 验证通过。
- **安卓歌词**：`network/LrcCache.kt`（cacheDir/lyrics 按 id 缓存）+ `RoomClient.fetchLyrics`（hasLyrics 才拉、Bearer、失败 null）；`ui/LrcParser.kt` 纯函数 `parseLrc`（BOM/多时间标签/元数据行拒绝/排序）与 `indexAt`（二分游标）；PlayerSheet 内 `LyricsSection`——produceState 加载态、`animateScrollToItem` + contentPadding 近似居中跟随、手动翻看暂停跟随 + 500ms 恢复 + 「回到当前歌词」按钮（`ui/RoomPlayer.kt`）。
- **门禁（实跑）**：服务端 tsc 0 错误 + **28/28**（新增 lyrics.test.ts 5 项、catalog 歌词校验 6 分支）；安卓 `cleanTest` 后 **111/111 实跑、0 失败/错误/跳过**（新增 LrcTest 11 项 + ModelsTest hasLyrics 断言）、Lint 0、Debug APK 构建成功。
- **当前交付锚（未装机）**：debug `b1e805735979558b4456abeb552141a7f821c50f1228a33ff2f80f133777d1ea`；已装机基线 **517A776B…** 不变。第三轮（专辑字段、通知歌手、lyricsVer 缓存失效）未开工。**未覆盖（如实标注）**：真机目视（占位封面观感、歌词页渲染/跟随/回到当前）；云端部署（新后端未上云、21 个 `.lrc` 未 scp、云端 catalog.json 未加 lyrics 引用、restart 清房间需用户开窗）；`add-media.ps1` 歌词通道未补。证据：[本轮记录](test-results/2026-09-26-track-metadata-r2/README.md)。

## 本轮新增（歌曲元数据第一轮：服务端 ID3 + 封面接口 + 安卓解析/封面/歌手，2026-09-26 深夜）

按 [track-metadata-design.md](track-metadata-design.md) 第一轮方案落地，不做专辑字段、不做通知歌手。第二轮（歌词）按方案留到下轮。

- **服务端 Track 模型扩展**（`server/src/library/catalog.ts`）：新增 `artist: string|null`、`cover: {mime,data}|null`、`coverVer: number|null`（音频文件 mtimeMs）。`artist` 按"catalog.json 可选 artist > music-metadata.common.artist > null"取值；提取 MP3 内嵌封面（`common.picture[0]`），>1MB 跳过保护内存（设计稿 23 首全库封面常驻约 1–2MB）。catalog.json 支持可选 `artist` 字段（手填优先级最高，覆盖乱码 ID3）。
- **catalog 下发扩展**（`server/src/app.ts`）：从 3 字段扩到 6 字段——`{id,title,durationMs,artist,hasCover,coverVer}`，`hasCover=false` 时 `coverVer` 仍下发为 null。WS 协议与 state JSON Schema 不动（详见 docs/protocol.md）。
- **新增封面路由**（`server/src/routes/cover.ts`）：`GET /api/rooms/:code/cover/:id`——成员令牌鉴权、404 + 业务错误体、无封面/歌曲不存在都按既有错误约定（`{"message":"该歌曲没有封面"}`）、`Cache-Control: private, max-age=86400`、mime 按 ID3 原始值。
- **服务端测试**（`server/test/catalog.test.ts`、`server/test/cover.test.ts`）：手填 artist 优先 / 无 ID3 时 null 语义 / 越界路径校验不受影响 / cover 鉴权、404 错误体、缓存头、字节一致；与现有协议与目录防护测试共 **26/26 通过**（含 catalog 防护、路由集成、协议 schema 等）。
- **安卓解析**（`network/Models.kt`）：`Track` 加 `artist: String? = null`、`hasCover: Boolean = false`、`coverVer: Long? = null`（默认值保证旧测试/调用方零改动）；`Track.parse` 读三个新字段、`isNull` 判空、空串归 null。`RoomClient.kt` 改用 `Track.parse`。新增 `ModelsTest` 4 项（已知字段、null 字段、缺省回退、空 artist 归 null）。
- **封面字节缓存**（`network/CoverCache.kt` + `RoomClient.fetchCover`）：cacheDir/covers/`<id>-<coverVer>` 文件 IO；`fetchCover(track)` 会话内用 OkHttp + Bearer 拉取并解码 Bitmap；缓存命中同步返回、未命中走网络、失败统一 null（UI 静默回退）。`CoverCache(dir: File)` 无 Android 依赖便于单测。
- **UI 改造**：①`ui/CoverView.kt::rememberCoverBitmap`——`produceState` 按 `(id,coverVer)` 重启；先等 `credentials != null` 再拉取，避免未入房空跑。②`MainActivity.kt PlaylistRow` 左侧 44dp 封面缩略图（无封面回退序号/动效条），歌名下方加歌手副行（`bodySmall`/`onSurfaceVariant`，artist 空不占行高）；行高 56dp 不变，双行靠 padding 内缩。③`ui/RoomPlayer.kt MiniPlayer` 左侧 44dp 封面；`PlayerSheet` 顶部 180dp 圆角封面 + 歌名 + 歌手副行。两处都接入 `rememberCoverBitmap`。
- **门禁（实跑）**：服务端 `npm run build`（tsc 0 错误）+ `npm test`（26/26 通过，5 项新增）；安卓 `:app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug` 全绿——单测 **100/100 实跑、0 失败/错误/跳过**（基线 96 + ModelsTest 4）；Lint 0；Debug APK 构建成功；`check-doc-links.mjs` 全量通过。
- **当前交付锚（未装机）**：debug `43A29FB6749280d309c4b38b6d9a2a4a24a1e6648d6bbf2c41c8a9502cb90c29`（上一轮 517A776B 仍属 UI 收尾，未装机留基线）。本轮缺真机验证：封面与歌手副行在 PHQ110 上的目视、扫码/手势/大字号仍挂起。证据：[本轮记录](test-results/2026-09-26-track-metadata-r1/README.md)。

## 本轮新增（工作区二次清理 + 清理标准定型，2026-09-26 深夜，无代码改动、无新 hash）

接上一节清理轮之后，用户要求全面复查目录并执行安全、克制的二次清理，同时把本次流程固化为今后清理的更新标准（已写入 [development-standards.md](development-standards.md)「仓库清理标准」）。APK 锚 **517A776B…** 不变。

- **审查结论（git 跟踪的 366 文件零删除）**：源码（Kotlin/TS）扫描无死代码与成块废弃注释；此前按反馈删除的 UI 文件（RoomActivity/TrackArtwork/PlaylistImage 等）确认无残留；12 篇顶层文档 + 11 篇模块文档互有引用、无孤儿文档；22 个脚本逐一核对均被 README/模块文档/证据链引用（含绑定已闭环场景的 `m3-auth-recheck*.sh`，删除会断证据链，保留）。冗余全部集中在 gitignore 覆盖的本地产物。
- **删除项（均 gitignore、可再生/已归档，经用户逐项确认后执行，共回收约 343MB）**：①`demo-backend.log`（本机后端已停的残留日志，重启自动重建）；②`deploy-artifacts/` 内的在产 release 20260926-1822 制品 + SHA256SUMS 本地副本（12MB——云端 `releases/20260926-1822` 保留完整解包副本，`package-deploy.ps1` 可随时重建；目录保留为空备用）；③`.workbuddy/` 356 项 → 11 项（57MB → 296K）——删除 tmp-* 探针（含两个 24MB 装机核对 APK 副本）、09-22~09-24 三轮测试的 UI dump XML/截图/诊断 JSONL/旧 build/pkg 日志（场景均已闭环、关键证据已归档 docs/test-results/ 并入 git），**保留**可复跑驱动（w1/b1/fb_driver.py、lt_drive.py、lt_finalize.sh、lt_unlock.sh）、分析脚本（analyze-diag/analyze-stall/find-ui）、agent-prompts-w1-w4.md 与 memory/；④`android/app/build/`（274MB）全清后全量重建。
- **保留项（保守原则）**：`demo-media/有何不可.mp3`（未被 catalog 引用的个人音频，本地唯一副本）继续保留；`media/` 空 catalog 模板、`server/dist`、`node_modules`、`.gradle/`、`deploy/` 基线不动。
- **门禁（实跑）**：全量重建后 `cleanTestDebugUnitTest → testDebugUnitTest → assembleDebug → lintDebug` BUILD SUCCESSFUL（2m53s），单测 **96/96 实跑、0 失败/错误/跳过**（XML 报告逐个统计），Lint 通过，`app-debug.apk` 再生；`git status` 0 变更（删除项全部为非跟踪内容）。项目体积（不含 .git）约 472MB → 129MB。

## 本轮新增（工作区与文档清理，2026-09-26 晚，纯文档/工作区、无代码改动、无新 hash）

按用户指示清理过期、无用文件并收敛文档结构；未改任何产品代码与协议，APK 锚 **517A776B…** 不变。

- **工作区清理（均为 gitignore 覆盖、可由源码重建的产物，git 跟踪文件零删除）**：①删除根目录 21 个过期构建/门禁/注入日志（check-*、fix-1345-*、ui-*、load15-*、fault-proxy*、adb-wireless、demo-backend.err）与 `android/gradle.{exit.txt,stderr.log,stdout.log}`（活跃运行日志 `demo-backend.log` 保留）；②`deploy-artifacts/` 由 220MB 收敛至约 117MB——删除 09-22~09-24 四个旧 release tar.gz 及清单（云端 releases/ 仍在、可随时 `package-deploy.ps1` 重建）、两个过期 APK 副本、一次性取证脚本（check-playing/transfer-check/defense-check）与未引用的 diag-110118.jsonl/long-test-samples v1/package-seg1*/script-check 日志；保留在产 release **20260926-1822** 制品 + SHA256SUMS。③长时多人测试的 4 份被引用证据（diag-final jsonl + 3 份 log）从 deploy-artifacts 迁入 `docs/test-results/2026-09-24-long-multiplayer/evidence/` 并更新记录内路径。④经用户确认后删除 `transcoded-20260924/`（105MB 曲库转码产物——云端 `/opt/listen-together/media` 23 首在产、`media-originals/` 有备份，本机属纯冗余副本），`deploy-artifacts/` 最终收敛至 12MB（仅在产制品 + SHA256SUMS）；`demo-media/有何不可.mp3` 是本地唯一副本的个人音频（未被 catalog 引用，gitignore 明确不入库），保留不删。
- **文档收敛**：①[模块 01](modules/01-android-ui.md) 重写为「当前状态 + 变更记录」结构（177→约 60 行），房间动态流/伪封面/搜索/长图等已删除功能的多轮"覆盖式"叙述合并进现状节并标注已删除，历史详述指向本文与 test-results；②AGENTS.md「当前进度快照」中 09-23~09-26 凌晨的 13 条历史轮次 bullet 压缩为 1 条摘要（保留"已删文件不复存在""帧耗时只认 R8 口径"等防坑锚点）；③模块 10 安卓单测口径 91→**96**；模块 05 房主清扫修复标注**已上云**（20260926-1822）；④「尚待验收」三条过期挂账就地关闭（EC5FCF0A 代码基已随 517A776B 装机复测、房主清扫修复已部署、BCF3DE16 文案精简已随装机目视）。
- **门禁**：`check-doc-links.mjs` 全量通过；本轮无代码/测试/构建变更。新增未跟踪设计稿 `docs/track-metadata-design.md`（09-26 歌曲元数据扩展方案，未实施）与迁移后的 evidence/ 目录待随下次提交入库。

## 本轮新增（设备复测：517A776B 装机 + 云端真实曲库回归 + 过期重入闭环，2026-09-26 傍晚）

用户恢复提供真机（USB），指示「使用真实曲库进行测试。测完了后上云再同步到github」。本轮把上一节两处修复的回归面在真机测完，并按用户约束（**不得关闭热点、不得再开飞行模式**）调整了断网手段。

- **装机与一致性**：debug `517A776B…` 装机 PHQ110；`pm path` 回拉**首次不匹配**——`adb pull` 静默截断（4,587,520/23,049,926 字节，USB 抖动，只看末行掩盖报错），重连重拉后逐位一致。教训：装机核对必须同时看字节数与哈希。
- **真机通过项（云端旧后端 release 20260924-0937，23 首真实曲库）**：①冷启 `lastRoom` 预填不静默入房；②建房/播放全链路（`dumpsys media_session` PLAYING、位置 1.0x 前进）；③seek 回归——拖回开头/拖中间/快速连拖**全部确认、无假「进度跳转未确认」横幅**（单调时钟重构行为无回归，修复①闭环）；④展开页控制/下一首环形切歌/暂停恢复位置连续；⑤邀请二维码 zxing 独立反解（剥 `:3000`、无令牌）+ 用户相机扫码入房成功、播放状态保留；⑥`member-sim` 成员进出即时反映（2 人→1 人、在线点亮→灰点）；⑦过期横幅与「重新加入房间」**房主侧闭环**——断网 >60s 被清扫 → 横幅 → 重入成功、24 字符昵称原样（修复②闭环）；⑧24 码元昵称边界——表单输入即截断（`takeCodePoints(it,24)`），恰 24 字符建房与重入均被服务端接受，>24 无法从 UI 构造（纵深防御由单测覆盖）；⑨附带验证服务端清扫：房主被清扫后空房回收，旧码加入报「房间不存在或已过期」且表单内容保留。
- **断网手段修正（用户约束）**：飞行模式会连带关热点，本轮已停用；后续复现「断网 60s+ 清扫」改用 `svc data disable`（仅断蜂窝数据、热点保持开启）。按 HOME 保活/杀进程均无法触发该场景（音频前台服务保活、冷启无横幅），如实记录。
- **后端已上云（同日晚，release 20260926-1822）**：09-26 后端修复（清扫清空房主 + 首个上线成员立即接任）随打包上云，prev=20260924-0937 可回滚。打包 tsc 0 错误、42/42 解包校验、listen 构建干净；旧版基线与新版 `m4-deploy-verify.sh` 均 **14/14**；重启清空内存房间（用户已授权）。**专项验证**：HostA 掉线 75s 被清扫 → MemberB 加入即 `hostId=MemberB`（hostIsB: true，旧版悬空 hostId 行为已消除）。设备端对新后端的入房冒烟未做（第三次 USB 掉线，如实标注）。证据：[2026-09-26 云端部署](test-results/2026-09-26-cloud-deploy/README.md)。
- **未覆盖（如实标注）**：双人真机同屏（缺第二台，成员交互由 `member-sim` 覆盖）；触感人工手感、大字号、小屏、弱网注入、真实令牌作废、升级失败注入照旧挂起。证据与逐项步骤：[2026-09-26 设备复测](test-results/2026-09-26-device-retest/README.md)。

## 本轮新增（本地审计收尾：seek 确认单调时钟 + 重新加入昵称合成，2026-09-26 下午）

用户指示先修不用真机测试的问题、后统一测试。本轮为 09-26 遗留修复轮的同日补充：全链路代码审计后仅两处本地缺陷，无协议/行为约定改动，无设备、无云端操作。

- **seek 确认窗口改用单调时钟**（`ui/RoomPlayer.kt`）：确认窗口（发起以来流逝 + 1500ms）此前用 `System.currentTimeMillis()` 差值度量，系统对时跳变会让窗口失真；改 `SystemClock.elapsedRealtime`（`nowMs` 注入保持可测）。确认判定抽成纯函数 `seekConfirmed`（快照版本新于发起时刻 + 相对贴合，沿用 E-07 相对推进量口径），拖回开头等低目标不受绝对比较恒真缺陷影响。主源码已无 `System.currentTimeMillis()` 做流逝度量的残留。陷阱回填 **9.7**。
- **过期横幅「重新加入房间」补昵称合成**（`MainActivity.kt`）：`onRejoin` 此前透传原始输入昵称，绕过 `composeNickname`（≤24 码元，与服务端一致）；重新加入长昵称会被 400 拒绝。已改为 `composeNickname(null, input.name)`。
- **门禁（实跑）**：后端 tsc + **23/23**；Android `cleanTest` 后 **96 项实跑、0 失败/错误/跳过**、Lint **0**（报告先删再生）、Debug + R8 benchmark 构建通过（退出码 0，4m 3s）。新增 `SeekConfirmTest` 4 项。**计数口径更正**：上一轮登记的"91"按测试文件归类少计 1（`DisplayNameTest.kt` 文件内含两个测试类），真实基线 92，本轮 96 = 92 + 4。
- **当前交付锚（未装机）**：debug `517A776B05C30EEBF2E7A0E2B68FE315F959748F0C3C8057FC20B975B69D98A3`；benchmark `764D0FE19B27DEC71EA629115297CE1D74911DF1E782F775A2282F149239F1B8`（性能测试专用，不分发）。seek 真机听感与全部设备项留待统一测试。证据：[逐项清单与证据](test-results/2026-09-26-legacy-fixes/README.md)「补充小轮」节。

## 本轮新增（遗留问题逐项修复，2026-09-26）

- **邀请入口**：修正 `InviteCode.HINT`，明确扫码/手动输入房间码；补齐 8 位码尾部字母数字边界，错误长码不再被截短后误加入。旧邀请仍兼容。
- **房主生命周期**：全员超时清扫时清空旧 `hostId`；无现存房主时 connect 在首份在线快照前补位，避免到下一 tick 才有控制权限。60 秒宽限、最早在线成员与五分钟回收规则不变。**仅本地修复，未部署云端**（后已于同晚随 release 20260926-1822 上云，见「设备复测」节）。
- **倍速复位**：修复 load/大漂移 seek 只清缓存、不写回播放器的问题；删除重复缓存，暂停/换曲/seek 以实际 PlaybackParameters 复位。同步阈值未改。
- **证据修复**：旧 `label-lag.py` 忽略 dump 失败并可能重读旧 XML，三张原截图均显示「播放中」，撤回对 `PlaybackView` 的确定性归因；修复脚本并补离线回归。保持既有界面精简，无新真机结论。
- **文档修复**：纠正 M3-LONG 已完成却仍挂起、偏好持久化与同步滞回区描述；未来歌词/reaction 属新功能，设备/TLS 项仍按外部条件挂起。
- **门禁**：后端 tsc + **23/23**；Android cleanTest 后 **91/91**（失败/错误/跳过均 0）；采样脚本 **3/3**；Lint **0**（报告先删再生）；Debug + R8 benchmark 构建通过，Gradle 退出码 0；文档链接与 diff 检查通过。
- **当前交付锚**：debug `EC5FCF0A987D10087CE88CEC228CF4509CDCC5B4E6D06E0CC79662005A4C4870`；benchmark `F943E3CA4942B84E23169CF0927A07BE11D607329F27DA86B27225F894E2438B`（性能测试专用，不分发）。**均未装机**，不沿用旧包真机结论。详见 [逐项清单与证据](test-results/2026-09-26-legacy-fixes/README.md)。

## 本轮新增（夜轮装机验收 + 界面提示精简，2026-09-25 深夜 → 09-26 凌晨）

> 夜轮（入房恢复 / 二维码邀请 / `benchmark` 性能变体）代码此前只有构建记录、无门禁无装机。本轮补齐门禁与真机部分场景，并按用户指示删除低价值状态文案后收尾。**终稿未装机**（用户告知此后无法提供真机）。

- **门禁补跑与首轮失败**：`:app:lintDebug` 报 `PermissionImpliesUnsupportedChromeOsHardware`——夜轮为扫码加了 `CAMERA` 权限却没有 `<uses-feature android:name="android.hardware.camera" android:required="false"/>`，ChromeOS 上等于"权限允许但硬件不支持"。补该声明并清掉 2 条 `UseKtx`（二维码位图改 `androidx-core` 的 `createBitmap`/`set`）后重跑：**86 项单测 cleanTest 实跑 0 失败/0 错误/0 跳过、Lint issues=0（报告先删再生）**。另一次教训：后台包装器只 `tail` 日志会把 `BUILD FAILED` 误读成通过，采集 Gradle 结论必须把退出码写进日志（陷阱 1.7 补充）。
- **装机与一致性**：debug `9C480583…`、benchmark(R8) `08607981…`（2.4 MB vs debug 23 MB，`> Task :app:minifyBenchmarkWithR8` 已执行）均 `pm path` 拉回 base.apk，SHA256 与锚逐位一致；夜轮全部真机场景在这两包上完成。
- **真机通过项**（PHQ110 / Android 14 / 云端 `http://8.166.126.136:3000`）：①冷启不静默入房 + `lastRoom` 预填昵称与房间码；②`rememberSaveable`/`JoinInputSaver` 在强制重建（`cmd uimode night yes`）后表单不丢；③Expired 横幅「重新加入房间」用当前房间码换发新令牌并恢复入房；④房间被服务端回收后再入房 → 表单内联「房间不存在或已过期」且内容保留；⑤邀请二维码生成——对设备截图独立反解得四行文本，与 `InviteCode.encode` 行/字符逐位对应，`:3000` 已剥、无 32 位十六进制令牌；⑥benchmark 变体接受 HTTP、建房选歌播放全链路正常（`dumpsys media_session` PLAYING 且位置前进）。
- **滚动帧耗时同条件 A/B（本轮关键结论）**：播放中同一脚本同一曲目，R8 包快滑 777 帧掉 6 帧 **0.77%**、带 1s 停顿 616 帧掉 1 帧 **0.16%**（P50/P90/P95 = 10/13/14 与 11/15/16 ms）；同源码 debug 包为 **7.66% / 2.08%**（P95 34 / 25 ms）。**上一轮记在 debug 包上的 27.27% / 13.38% 不能外推到用户实际拿到的 R8 构建**——给用户的构建里歌单滑动掉帧已在 1% 量级、P95 在 60Hz 预算内；跨轮次的 debug 对比（27.27%→7.66%）因帧总数与滑动节奏不同，只算倾向性证据，不作"优化了 X%"宣称。
- **真机未覆盖（如实标注）**：相机扫码入房（需人工把手机对准屏幕）、双人同屏与成员展开 180dp 滚动（ColorOS 后台断网使同机两客户端无法同时在线，且 PC 侧访问公网被策略拦截、本机演示后端曲库为空）、空歌单、2 倍系统字号、小屏布局、emoji/代理对昵称真机目视（`adb input text` 打不进非 ASCII，仅单测覆盖）。证据、脚本与限制清单见 [night-acceptance](test-results/2026-09-25-night-acceptance/README.md)。
- **播放态文字显示疑点（09-26 复核已撤回过强归因）**：旧脚本未检查 dump 成功且可能重读旧 XML，13 次采样不能证明界面持续错误；17/18/19 三张留存截图均显示「播放中」。已修取证脚本，缺真机不能逐样本重验。删除状态文案的产品决定保持；不再断定 `PlaybackView` 通路有缺陷。详见 [遗留修复证据](test-results/2026-09-26-legacy-fixes/README.md)。
- **界面提示精简（用户指示）**：删除 `playbackLabel` 纯函数与 MiniPlayer 副标题、展开页「当前歌曲 + 状态」行、「播放与暂停同步给所有人 / 暂停只影响自己 · 进度由房主控制 / 连接就绪后即可播放」说明行；`PlaybackView` 随之只留 `mediaId`/`failed` 两个仍被消费的观测字段，`MiniPlayer`/`PlayerSheet` 去掉 `playback` 参数。保留的可见反馈：状态横幅（含重试/重新加入/退出入口）、歌单当前曲高亮 + `PlayingIndicator` 动效条、播放键图标。单测 86 → **84**（净删 2 项状态文案回归，`showStatusNotice` 的旧曲目/失败/本机暂停判定仍保留）。
- **终稿锚（未装机）**：debug `BCF3DE1630969684B05BB6552E26925F76E34C0039C78B212F950CA250027AFE`、benchmark `9E17F2916D1E4B3A3F3C21A51CEC476E6EDEF51886179081E5FC5E34A72C7302`；84 项单测实跑、Lint issues=0。夜轮此前登记的候选锚 `E984FF40…`/`A201AE4A…`（未跑门禁、未装机）被上面两代取代。
- **坑回填**：陷阱 **2.13**（同机两包测不了双人：ColorOS 后台断网 + 60 秒清扫必然触发；改走"单机 + `member-sim` + 本机后端"，同时这条链路是失效路径的免费复现器）、**2.14**（`isDebuggable=false` 的性能包 `run-as` 直接拒绝，取证只能 `dumpsys media_session`/截图/`gfxinfo`；`applicationIdSuffix` 使 `am start -n <id>/.MainActivity` 报不存在）、**3.7**（`input text` 打不进非 ASCII、URL 的 `://` 被两层引号吞掉；多行框清空要 `MOVE_HOME`+`FORWARD_DEL`，`MOVE_END` 只到行尾）、**2.9 补充**（`settings put system user_rotation` 同样被拒，验证 `rememberSaveable` 改用 `cmd uimode night yes|no` 强制重建 Activity）、**5.6**（`CAMERA` 权限缺 `<uses-feature required=false>` 被 Lint 阻断，加权限与跑 Lint 必须同轮）、**5.7**（`grep -c "<issue"` 把根标签 `<issues>` 数成 1 条）、**1.7 补充**（后台包装器必须回写 Gradle 退出码，否则 `BUILD FAILED` 被 `tail` 的 0 掩盖）。

## 本轮新增（歌单滚动与界面精简，2026-09-25 晚）

用户反馈已明确：「滑动延迟」仅指上下滑动歌单，进度条 Bug 已修复。本轮不修改进度条与播放同步逻辑。

- 删除首页头像选择及偏好读取/保存，取消自动拼入旧头像；删除房间动态摘要、时间线与派生订阅；删除 MiniPlayer/展开页的歌曲首字封面。保留当前成员、连接异常提示与播放控制。
- 歌单改为圆角面板：固定歌单标题/数量、中间曲目独立滚动、底部播放器常驻；序号替代重复音符，当前曲目高亮。成员展开有高度上限并可独立滚动。
- 已查出的滚动负担：当前曲动效每帧改变 Box 高度，触发组合/测量；改为固定尺寸 Canvas 内绘制。切歌跟随在用户滚动时让路，曲目索引不再依赖横幅/成员/标题数量；房间页去掉无用的收键盘手势。
- 验证：`:app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug` 构建通过，**86 项单测实跑，0 失败/错误/跳过**（删除动态 13 项、伪封面 1 项专属测试）；Lint 分析完成后删除旧报告并单独执行 `:app:lintReportDebug`，**新生成 XML issues=0**；文档链接检查通过。APK SHA256 **80CF7629C3BB7416CC82F4728F5A9F6CA240269948D4D6D26CE1D13E2B92625E**。证据见 [本轮记录](test-results/2026-09-25-playlist-feedback/README.md)。
- 真机补验（21:54–21:59）：用户开启无线调试后已覆盖安装 PHQ110，回拉 base.apk SHA256 与 **80CF7629…** 一致；首页无头像选择、固定歌单标题/底部播放器、独立滚动、无歌曲首字封面、成员展开无动态时间线均已截图确认。播放中连续 8 次滑动 janky **27.27%（66/242）**，带 1s 停顿的 4 次滑动 **13.38%（19/142）**；**仍有掉帧，性能项待优化，不宣称已彻底修复**。没有旧版同条件 A/B；小屏/大字号、滚动中切歌、人工手感尚未覆盖。测试结束已暂停播放。
- 历史说明：下方批次 A 记录保留作为证据；其中房间动态淡出、伪封面、头像选择的未覆盖项随功能删除作废。

## 本轮新增（入房可靠性、二维码邀请与滚动性能诊断，2026-09-25 夜）

- 修复项 1：上一轮快滑数据来自 debug 包（连续 27.27% janky、带停顿 13.38%），不能外推给用户构建。增加 R8 优化的 `benchmark` 变体，独立包名、debug 签名、仅该变体允许 HTTP 连接试用服务器；`isDebuggable=false`，R8 shrink/minify 已执行。APK SHA256 `A201AE4A07AB700590651DDCB331B18E0CCFBB6D72069FD1F8158D2523C68B8B`，安装命令使用 `adb install --no-streaming` 成功。**本轮未取得新版帧耗时**：设备前台当时是无关应用，停止了后续点击，避免干扰；本轮前的 debug 数据仅作问题基线，尚不能宣称滑动卡顿已彻底解决。正式 release 仍拒绝 HTTP。（帧耗时已由 09-25 深夜轮在同一条件下补测：R8 0.77%/0.16% vs debug 7.66%/2.08%，见上节与 [night-acceptance](test-results/2026-09-25-night-acceptance/README.md)。）
- 修复项 3：昵称输入用 `takeCodePoints`（24 UTF-16 码元上限，不截半个代理对）；`JoinInputSaver` 通过 `rememberSaveable` 保存表单与公开邀请字段，旋转/进程恢复不丢表单内容，令牌不保存。
- 修复项 4：最近成功加入的公开房间码与昵称存本机；不自动登录、不存成员令牌。进程重启时手动表单预填；会话 expired 增加「重新加入房间」，用当前房间码重新向服务器申请新凭证。按用户指示，加入入口暂停剪贴板粘贴，改用相机扫描邀请 QR；房间页顶栏生成相同口令 QR，手动输入码保留备用。
- 修复项 5：公网 TLS/令牌链路改造挂起到购买香港实例迁移时。当前阿里云大陆三个月试用实例沿用此前已确认的仅小范围 HTTP 试用决定；**APK release 继续拒绝 HTTP**，benchmark 变体是本机测试专用，不分发。
- 方向 6：第一版歌词建议为曲库 ID 绑定的 LRC 文件、本机播放器位置驱动逐行高亮、手动翻看时暂停自动跟随并提供「回到当前歌词」；先人工维护少量有授权来源歌词，不做第三方搜索/聊天室混入。详细方案见 [路线图的歌词一节](next-development-plan.md#歌词功能建议方案排在稳定性收尾之后)。歌词时间轴仍需独立验证真实位置、缓冲与 seek；旧播放态采样证据已被复核质疑，不能据此预判歌词必然失败。
- 双机同步（2）遵照用户要求继续挂起。
- `:app:assembleBenchmark` 构建成功（R8 已运行）；未执行单元测试，也未完成设备帧耗时采集。旧 `proguard-rules.pro` 文件缺失的构建警告已补空规则文件。

## 当前状态一览（2026-09-27）

| 阶段 | 状态 | 说明 |
|---|---|---|
| M0 诊断与可观测性 | ✅ 完成 | 客户端诊断 JSONL（无令牌、20MB/60 分钟上限）+ 诊断分析脚本 |
| M1 会话与断线稳定 | ✅ 完成 | SessionContext/状态机/代次隔离；真机复测 + 延迟/断线/过期故障注入 |
| M2 双机同步 | ⏸ 挂起 | 缺第二台手机（外部条件触发，不能用观察客户端代替） |
| M3 稳定性 | ✅ 完成 | 通知栏实际点击/短时息屏/蓝牙断开/音频焦点/401 全过；**M3-LONG 已完成（2026-09-24：真实音乐 70 分钟 + 息屏 30 分钟 + 多人进出，见本轮新增）** |
| M4 云端部署 | ✅ 完成 | 四项部署门槛全部关闭（见下） |
| 0.2.0 收尾 | 进行中 | 转入试用反馈驱动的修复循环；2026-09-24 后端防线 E-05/E-09/Q-3 **已上云**（release 20260924-0937） |
| 首页与扫码交互（试用反馈） | ✅ 真机通过 | 首页精简、右上角扫码、相册扫码已通过；**09-27 下午相机实扫也已由用户确认，并取证成功入房**。首次相机权限分支本轮未重测 |
| 元数据第二轮（歌词 + 封面） | ✅ 歌词真机通过 / ✅ 云端歌词已部署 / 🟡 封面本地闭环 | 后端 `20260927-1240`；**09-27 下午云端冷缓存歌词冒烟通过，修复暂停翻页后不归位**。最终交互为无返回按钮、停止滚动 3 秒自动回位；本轮新增本地封面上传/替换/移除与服务端图片恢复，云端封面发布和真机真实图片目视待补 |
| 本机曲库管理工具（唯一入口） | ✅ 本机闭环 | `node scripts/metadata-manager.mjs`：手工编辑、音频/封面上传、三源联网匹配、批量补空、**删除（单曲 + 批量，文件进回收目录可放回）**。门禁：离线单测 **31/31** + 可复跑离线驱动 **77/77（8 组）** + 浏览器实跑。**只作用于本机 `media/`**，云端曲库仍走 `add-media.ps1` + 服务器 `media-manage.sh`；无截图证据（自动化侧视口不可用） |
| 09-25 夜轮（入房恢复 + QR + 性能变体） | ✅ 门禁 + 6 项真机场景 / ⏸ 扫码与双人待补 | 86→84 项单测实跑、Lint 0；`9C480583` 与 R8 包 `08607981` 装机并回拉一致；预填/配置恢复/重新加入/回收失败/二维码反解/HTTP 放行全过；**R8 歌单滑动掉帧 0.16%–0.77%（debug 7.66%–2.08%）**；扫码入房、双人同屏、空歌单/大字号未覆盖；删状态文案后的终稿 `BCF3DE16` 未装机 |
| 09-25 晚试用反馈首轮 | ✅ 装机与基础布局 / ✅ 性能基准已补 | 歌单固定标题与独立滚动、播放动效仅重绘；移除头像选择/房间动态/歌曲首字封面；86 项单测与 Lint 0；PHQ110 已装机，布局通过；当时 debug 包 27.27%/13.38% 掉帧已由夜轮 A/B 澄清为 debug 口径，R8 实测 1% 量级 |
| 0.3.0 一起听体验（批次 A，历史） | ✅ 真机验收通过 | 房间动态流 + 伪封面 + 歌单跟随 + 触感/无障碍 + 头像 emoji；100 项单测实跑、Lint issues=0；**2026-09-25 下午 PHQ110 真机 6 项场景通过**（真机抓到并修复 1 处展开页半屏回归；触感标人工手感、10 分钟淡出未覆盖），见 [批次 A 真机记录](test-results/2026-09-25-device-batch-a/README.md) |

M4 四项部署门槛（2026-09-23 晚全部关闭）：

1. 首次部署 + 13 项服务端验证 + SSH 隧道联调 9/9（2026-09-22）。
2. 真机公网 E2E 建房→播放全链路（W2，APK 36BD3A5B…，公网校时 RTT 中位 65ms）。
3. 升级/回滚演练双向通过（W3，两次 health 第 2 秒 200、13 项抽查三次各 13/0）。
4. LOAD-15 云端公网重测（W4，15 路×600s 全 206 零失败、2.847Mbps=本地基线 99.1%）。

关键锚点：

- 当前交付锚 **A586F93C7E7487A8ACB67A4A82170D4AE4F2AF5EBA020DEA42AD9AA826D2E13F**（09-27 下午：歌词恢复修复、无按钮三秒回位；127 单测、Lint 0；**已装机 PHQ110 并回拉一致、最终交互真机通过**）；benchmark **E7053FE570CDB67C248ED0EF89029601ED4D0B5862F4839EB836B5C7C9D4FDB1**（未装机）。本轮中间包 `54A52F8A…` 含 500ms/返回按钮，已被最终包取代。
- 上一交付锚 **854846985C5420A68CF05E677267FC9185CA0B6317432197181D8B46538BB77E**（09-27 白天：首页与扫码交互调整 + 相册选图扫码；123 单测、Lint 0；已装机）；benchmark **AE3DFF35B16FE3570ACFB7AF2C36063F1DA8447DFAD0AF0437BB604D2C28A6B8**（未装机）。
- 上一交付锚 **7C503FDD5853BD252705EA527B6B5D5FE4B7F3EA10E72EE8E5241E2C1046BF9A**（09-27 凌晨：元数据第二轮 + 歌词状态缺陷修复；118 项单测、Lint 0；已装机并真机验收通过，已被 85484698 取代）；同源码 benchmark **3945E4C8…**（未装机）。
- 更早交付锚 **517A776B05C30EEBF2E7A0E2B68FE315F959748F0C3C8057FC20B975B69D98A3**（09-26 补充小轮：seek 确认单调时钟 + 重新加入昵称合成；96 项单测、Lint 0；已装机并真机复测通过）；同源码 benchmark **764D0FE1…**（未装机）。
- 元数据第二轮初版锚 **b1e80573…**（歌词管线 + 封面静态占位；111 项单测）**已被 7C503FDD 取代**——该含歌词状态缺陷（catalog 有 lyrics 引用但 `.lrc` 缺失时歌词区卡在「加载中」），09-27 凌晨真机验收发现并修复。
- 上一轮交付锚 **EC5FCF0A987D10087CE88CEC228CF4509CDCC5B4E6D06E0CC79662005A4C4870**（遗留逐项修复轮；91→更正为 92 项单测口径、Lint 0；**未装机**）；benchmark **F943E3CA4942B84E23169CF0927A07BE11D607329F27DA86B27225F894E2438B**。
- 上上轮交付锚 **BCF3DE1630969684B05BB6552E26925F76E34C0039C78B212F950CA250027AFE**（夜轮改动 + 删除状态文案后的终稿；84 项单测实跑、Lint issues=0；未装机，已被 517A776B 覆盖）。**在机版本现为 `517A776B…`**（09-26 补充小轮，本轮真机复测通过，`pm path` 回拉一致）；性能对照包 benchmark(R8) 在机 `08607981…`，`764D0FE1…` 未装机。夜轮登记过的候选锚 `E984FF40…`/`A201AE4A…` 未跑门禁、未装机，已被取代。上一真机验收锚 **80CF7629C3BB7416CC82F4728F5A9F6CA240269948D4D6D26CE1D13E2B92625E**（歌单精简版）基础布局通过、滚动掉帧待优化——本轮 A/B 已证明该数据是 debug 口径，R8 构建实测 0.16%–0.77%。
- 上一装机 APK 锚 **D882D18632E04E28887DD8D87181410CE1115098838E6C8729B5B9A77D2E4767**（0.3.0 批次 A 终稿 + 真机修复：批次 A 全部内容 + `PlayerSheet` 改 `skipPartiallyExpanded`；100 项单测、Lint issues=0；**已装机 PHQ110 并完成 6 项真机验收**，装机后 `pm path` 拉回 base.apk 复核 SHA256 逐位一致）。
- 上一稿 **F5827821…**（批次 A 复核稿，未装机）：真机验收暴露出展开页半屏回归，被 D882D186 覆盖。
- 上一在机版本 **C685CE0ADE0B7E3288BB13465B74D0A5D65D421A42A79D8415D2E4C9ED67B30E**（反馈二小轮：顶栏去房间码 + 删保存长图；当时未跑门禁，本轮开工补跑门禁得到同一 hash，欠账已关闭，见下）。
- 上一交付锚 **011DD835CF111A9DB8B352E206B00A341962EC5D5722D3D8830AC54BFEF1910E**（试用反馈轮：通知栏/展开页上一首下一首 + 顶栏收拢 + 口令隐端口 + 去搜索；74 项单测、Lint 0；真机部分实测通过，详见下）。
- 云端：release **20260927-1240** 在产（歌词管线 + 7 字段曲库 + 配额文案澄清与 `creatorIp`；prev=`20260927-1226` 可回滚，其前 `20260926-1822` 等亦在 `releases/`）；云端 `media/lyrics/` 23 个 `.lrc`、catalog 已挂 `lyrics` 引用。入口 `http://8.166.126.136:3000`。TLS 路线 A 已决策：**维持 IP 明文**（试用 ECS 无法备案、备案拦截按域名跨任意端口生效、Let's Encrypt 不签裸 IP），正式化留待转包年包月备案或迁香港。
- 云端曲库 23 首真实音乐（96.5 分钟，192k；2026-09-24 按试用反馈移除 demo-load 负载测试音，备份在 media-originals/20260924-221628/，云端负载重测需先恢复——见 [陷阱 8.10](development-pitfalls.md)）。云端 catalog 目前**无 `artist` 字段**（最小改动，不影响安卓显示）。
- 后端防线 E-05（WS 握手限连）/E-09（同 IP 建房配额 ≤3）/Q-3（事件日志 + health 计数）**已于 2026-09-24 上午上云并通过 14 项验证与新防线专项验证**；升级失败注入仍未做。
- 剩余待办与恢复条件：M2 双机（缺设备）/ M3-LONG（≥70 分钟窗口）/ TLS 正式化（用户决策）/ 补测项（蜂窝公网、弱网注入、真实令牌作废、升级失败注入），详见 [路线图与验收标准](next-development-plan.md)。

## 本轮新增（0.3.0 批次 A 一起听体验轮：房间动态流 + 伪封面 + 跟随滚动 + 头像 emoji，2026-09-25）

> **Android 客户端轮**：只改 `android/app` 与文档，未动 `server/`、未改协议与行为约定、未部署、未做 git 提交、**未做真机验收**（用户明确说明本轮无法进行真机测试）。验收证据只有 Gradle 门禁与 JVM 单测，真机项全部显式挂起。详细说明见 [模块 01 Android UI](modules/01-android-ui.md)。

- **房间动态流（A1，零协议改动）**：服务端只推全量快照、没有事件通道，新增 `ui/RoomActivity.kt` 以纯函数 `RoomActivity.derive(previous, current, tracks)` 对连续快照做差分，得出"加入/离开/上下线/房主转移/换曲/播放暂停"事件。三条约定：①首帧（刚入房、断线重连后的第一份快照）不产生事件，避免整屏"XX 加入了房间"；②服务端在成员离线 60 秒后才移除（store 的 tick），"离开"只在上一帧仍在线时产生，否则会在"掉线了"之后补一条重复的"离开了"；③同帧换曲 + 开播只报换曲。第④条由核对 `server/src/rooms/store.ts` 得出：`add()` 先广播（新成员 online=false），WS 连上后 `connect()` 才置 online=true，所以"在线"事件必须要求该成员此前被见过在线（调用方跨快照维护 `everOnline`，`updateEverOnline` 只保留当前房间内成员），否则每个新人都会刷出"加入了房间"+"回来了"这条假动态——这正是本来自查发现并修掉的缺陷。
- **动态展示**：成员区折叠行第二行改为"连接状态 · 最近一条动态"（不额外占行），且**摘要只保留 10 分钟内的动态**（更早的会淡出，避免旧动态读起来像刚发生；完整历史仍在展开的时间线里）；展开后成员列表下方为「房间动态」时间线（最近 8 条、最新在上、右侧相对时间）。事件保留 20 条；相对时间与淡出判定每 30 秒刷新（`rememberNowMs`）。订阅来源是 `RoomClient.state` 的原始快照，而不是界面的 `screenStates()`——后者为播放进度做了 500ms 去重，会丢成员与播放状态的中间帧。
- **伪封面（A2）**：曲库没有封面字段（`Track` 只有 id/title/durationMs），新增 `ui/TrackArtwork.kt` 用"稳定取色 + 首字素"绘制：复用头像的 `avatarPaletteIndex`（同一首歌颜色恒定）、配色取主题色对（container 与对应 on 色）、渐变终点只向内容色靠拢 22% 以保住文字对比度、空标题回落 ♪。MiniPlayer 左侧加 44dp 缩略图；PlayerSheet 改为「180dp 封面居中 + 标题居中 + 主控居中 + 进度与时间左右对齐」，并整体可滚动（小屏/大字体不裁切，大屏观感不变）。
- **歌单跟随（A3）**：`rememberLazyListState` + 切歌后 `animateScrollToItem`；目标行已在屏幕上时不滚动，不打断用户当前浏览位置；横幅出现/消失导致布局晚一帧、目标越界时放弃本次跟随而非交给 LazyList 处理。
- **触感与无障碍（A3）**：播放/暂停、上一首/下一首、拖动结束各给一次 `HapticFeedbackType.LongPress`；MiniPlayer 的整条点击由 `pointerInput + detectTapGestures` 改为 `clickable`——手势写法不产生语义点击动作，读屏点不开播放页；成员区（展开/折叠）补 `stateDescription`，头像圆片补 `contentDescription`（读屏中文名；选中状态由 `selectable(role=RadioButton)` 语义承载，不写进描述以免重复播报）。
- **头像 emoji（B2，零协议改动）**：协议 `members[]` 只有 `name` 字段，新增 `ui/DisplayName.kt` 约定"昵称首个字素是 emoji 即当作头像"：`firstGrapheme`（码点/字素簇级，整体取回 ZWJ 组合、肤色修饰符、成对地区指示符）、`isEmojiGrapheme`（emoji 区块判定，不含 CJK 与拉丁字母）、`splitAvatarPrefix`、`composeNickname`（`头像 + 空格 + 昵称`，总长 ≤ 24 码元，与服务端 1–24 字校验一致；用户自己敲的 emoji 优先，不重复叠加）。入房表单昵称下方新增头像圆片选择器（「无」+ 6 个 emoji，横向可滑，`selectable(role=RadioButton)`，读屏用中文名）；选择经 `ConnectionStore.loadAvatar/saveAvatar` 持久化（接口默认实现返回空，既有测试替身无需改动）。成员行文字改用 `memberDisplayName`，头像 emoji 不在文字里重复出现；`MemberAvatar` 不再 `take(1)`。
- **新增 26 项 JVM 单测**：`RoomActivityTest` 13 项（首帧无事件、同快照无事件、加入与离开、离线后移除不重复、掉线回来、新成员首次连上不报"回来了"、`everOnline` 只保留在房成员、房主转移与无主回退、换曲标题与曲库缺失兜底、同帧换曲不报播放态、相对时间分档与时钟回拨、折叠摘要 10 分钟淡出、缺名与"播放已暂停"兜底文案）、`DisplayNameTest` 10 项（含反例断言 `"🐱 小王".take(1).length == 1`、`takeCodePoints` 不切代理对、头像前缀放不下整个 emoji 时宁可少一字）、`AvatarGlyphTest` 3 项（头像/成员文字/封面三处取字符一致）。
- **独立复核（第二轮质量关，替代缺失的真机测试）**：因本轮无设备，另起一个独立复核会话对全部改动做对抗性审查（读 server 源码核对差分时序、逐项检查 Compose 状态/布局/无障碍/API 26 可用性）。结论**无阻断项**，确认无问题的项包括：差分规则与服务端一致、同内容快照不产生假事件、`everOnline` 修复正确、订阅线程与生命周期无冲突、ModalBottomSheet 可滚动后拖拽未被破坏、`animateScrollToItem` 无越界崩溃、MiniPlayer 改 `clickable` 后内层播放键仍独立。查出并已修的问题：
  - **重要①（既有缺陷，本轮顺手修）**：`rememberRoomPlayer` 原以 `client` 为唯一 key，`pendingSeek` 记着上一间房的快照 version；新房 version 从 0 起会让确认分支永不成立——滑条停在上一个房间的目标值，5 秒后新房凭空弹"进度跳转未确认，请重试"。改为 `remember(client, ui.credentials?.token)`。
  - **重要②（本轮新代码）**：动态时间线用纯 `remember`，而 Manifest 未锁方向、无 `configChanges`，旋转/切深色/改字号会重建 Activity → 时间线归零而展开状态被 `rememberSaveable` 保留，出现"展开着却一条动态都没有"。改为 `rememberSaveable(stateSaver = listSaver(...))`，并返回 `State` 让读取发生在成员区条目内（避免每条动态重组整页）。
  - **次要③**：成员区整行的读屏文本被箭头图标的 `contentDescription` 盖掉（TalkBack 只念"查看成员"），本轮新增的"最近动态"完全不可达；`selectable(selected=false)` 还与"已展开/已折叠"矛盾。改为 `clickable(role=Button, onClickLabel=…)` + 图标 `contentDescription = null`。
  - **次要④**：末曲自然播完时服务端同样置 `playing=false`（store.ts 的 tick），原文案"暂停了播放"读起来像有人按了暂停 → 改为被动的"播放已暂停"。
  - **次要⑤**：昵称按 UTF-16 码元 `take` 截断会切出半个代理对（服务端存成 `?`、界面方框）→ 新增 `takeCodePoints` 按码点截断，放不下整个 emoji 时少一个字。
  - **次要⑥⑦⑧⑨**：点击类动作用轻触感（`TextHandleMove`）、只在拖动结束后保留长按级触感；头像圆片 44→48dp 并给选择器加 `selectableGroup()`；修正 `TrackArtwork` 关于"与头像同色"的失真注释；修正"避免 emoji 重复"的注释（纯 emoji 昵称的文字行仍是它本身）。
  - 复核另记录一条**服务端遗留观察**（非本轮代码、客户端无需改）：全员离线时 tick 会移除房主却不更新 `hostId`，留下指向已移除成员的 hostId（已由 09-26 本地修复，未部署）；只要还有在线成员，旧实现下一 tick（250ms）即转移，客户端届时正常播报"X 成为了房主"。该轮未做的 `JoinInput` 配置恢复已由 09-25 夜轮 `JoinInputSaver` 修复并真机验证。
- **自查发现并修掉的一个真实缺陷**：核对 `server/src/rooms/store.ts` 时发现 `add()` 先广播（新成员 online=false）、WS 连上后 `connect()` 才置 online=true，原差分规则会把每个新人播成"加入了房间"+"回来了"两条——后者是假的。改为要求"该成员此前被见过在线"（`everOnline` 跨快照集合 + `updateEverOnline` 只保留在房成员，集合有界），并补 3 项单测钉住（这是真机测试一定会看到、而单测原先覆盖不到的路径）。
- **构建验收**：`gradlew :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug` → **BUILD SUCCESSFUL**；单测**实跑 100 项（74 基线 + 26 新增），0 失败 0 错误 0 跳过**（`build/test-results/testDebugUnitTest/*.xml` 合计 `tests=100`，日志中 `> Task :app:testDebugUnitTest` 不带 UP-TO-DATE）；Lint **`lint-results-debug.xml` issues=0**（先删报告再跑，日志中 `> Task :app:lintReportDebug` 不带 UP-TO-DATE——上一轮的 txt 是 09-24 的旧文件，照抄等于引用旧结论，见陷阱 5.5 补充）；`check.ps1 -Scope docs` Markdown 本地链接检查通过。**APK SHA256 F5827821…**（该稿未装机；同一源码两次构建 hash 一致；真机验收后已被 D882D186 覆盖，见下）。
- **开轮先还门禁欠账**：本轮开工先对改动前代码跑了一次完整门禁（cleanTest + test + assembleDebug + lintDebug）——**74 项实跑全过、Lint 0**，且该次产出的 APK SHA256 = **C685CE0A…**，与 09-25 装机锚逐位一致（顺带证明工作区源码就是装机版本），反馈二小轮"未跑门禁"的欠账就此关闭。
- **真机验收（2026-09-25 下午完成，PHQ110 / Android 14 / 云端后端 `http://8.166.126.136:3000`）**：设备就位后按原挂起清单逐项实测——①房间动态流：脚本成员加入/掉线/回来/离开四条动态文案与人数正确，**掉线超 60 秒被服务端移除后不补报"离开了房间"**（抑制规则实测），时间线 6 条按时间倒序且相对时间分档正确（刚刚/1/2/3 分钟前）；②伪封面与展开页布局（含修复后复验）、返回键收起；③歌单跟随：当前曲滚出视野时切歌自动滚到新当前曲、当前曲已在屏内时不跳动；④头像 emoji：成员区头像为 🐼 且文字行 `AliceLongName12345678` 不重复、重装+重启后选择保留（`checked=true`）、24 字昵称 + emoji 前缀入房未触发 400（服务端快照名字为 `🐼 AliceLongName12345678`，即前缀 3 码元 + 昵称 21 = 24）；⑤触感**无客观证据**（`dumpsys vibrator_manager` 的 TOUCH 历史不记录 `performHapticFeedback`），标人工手感项；⑥暗色与动态取色下封面文字、进度与说明可读。**装机一致性复核**：`pm path` 拉回 base.apk 的 SHA256 与交付锚逐位一致。
- **真机发现并修复的 1 处回归（展开页半屏）**：`ModalBottomSheet` 默认 `skipPartiallyExpanded = false`，内容高于半屏时先停半屏锚点——真机上进度滑条、时间与同步说明都落在屏幕外，主控制项要再滚一次才够得着（独立复核曾预判"基本等同全展开"，真机证明该预判不成立）。改为 `rememberModalBottomSheetState(skipPartiallyExpanded = true)`，小屏/大字体仍由内容列 `verticalScroll` 兜底。修复后重跑门禁（100 项单测、Lint issues=0），装机复验 ①②③⑥ 全过，APK 由 F5827821 → **D882D186…**。
- **真机验收的可复用物料**：新增 `scripts/member-sim.mjs`（`create/join/resume/leave`，成员必持 WS、`--hold` 到期即"掉线"、逐行 JSON 输出），把"缺第二台手机"从**阻塞项**降级为**脚本可覆盖**；文档见 [模块 09](modules/09-build-deployment.md)。证据与截图见 [2026-09-25 批次 A 真机记录](test-results/2026-09-25-device-batch-a/README.md)。
- **坑回填**：陷阱 **4.6**（`take(1)`/`take` 截断 emoji 代理对；昵称 24 字上限在客户端与服务端两处校验，拼头像前缀后必须再按码点截断）、**4.7**（`remember` 的 key 漏了会话/配置维度：跨房间复用与重建清零，含"状态属于哪一层"的判定口诀）、**1.7**（`*>&1 | Out-File` 采集 Gradle 输出会把 Kotlin 报错拆行加装饰导致搜不到，改用 `1>out 2>err` 文本重定向）、**5.5 补充**（`lintReportDebug UP-TO-DATE` 时磁盘报告可能是上一轮的），以及第 7 节新增"看起来没变的替换会吃掉行尾换行并把两个 import 并成一行"（本轮真实踩到两次）。

## 本轮新增（反馈二小轮：顶栏去房间码 + 删除保存长图，2026-09-25）

> 用户指示："去掉房间号显示，去掉保存长图功能。其它部分放弃验证，实现功能就行不需要测试。" 本轮按指示未跑单测/Lint/真机验收，仅做 `:app:compileDebugKotlin` 编译确认通过；APK 已于 2026-09-25 应要求重建并装机（仅 assembleDebug，未跑门禁）：SHA256 **C685CE0ADE0B7E3288BB13465B74D0A5D65D421A42A79D8415D2E4C9ED67B30E**（含本轮与试用反馈轮全部 Android 改动；上一交付锚仍为 011DD835…）。

- **顶栏去房间码**：`MainActivity.kt` TopBar 房间页不再显示房间码胶囊，与入房页统一显示「一起听歌」；操作区仍为分享与退出。房间码只出现在邀请口令文本与加入前的邀请确认卡（`InviteCode` 与分享逻辑不变）。
- **删除保存长图**：`ui/PlaylistImage.kt` 整文件删除（exporter/按钮/PNG 绘制编码），MainActivity 移除 import、`rememberPlaylistImageExporter` 与 `imageExporter` 参数透传和歌单标题行按钮；无关联单测，无残留引用。此前记录的 ColorOS 系统长截屏兜底随功能一并移除。
- **试用反馈轮真机验收终止**：上轮（011DD835）真机 8 项场景在设备可用时段已实测通过 5 项（通知栏下一首/上一首/末首回绕切歌、Sheet 切歌钮、顶栏/无搜索+云端 23 首、分享口令无 :3000），其余项（粘贴口令重入同房、成员 Snackbar、保存长图）按用户决定不再补验，其中「保存长图」场景随功能删除而作废。结果修订见 [feedback-round](test-results/2026-09-24-feedback-round/README.md)。

## 本轮新增（试用反馈轮：通知栏切歌修复 + 顶栏收拢 + 口令隐端口 + 去搜索，2026-09-24 夜）

> 用户试用反馈 4 项：建议可采纳（上一首/下一首图标、去搜索、去云端测试音），Bug 必修（后台通知栏无下一首、上一首变回开头）。代码与云端已完成，真机验收待 USB 重连（设备验收时离线）。完整证据见 [feedback-round](test-results/2026-09-24-feedback-round/README.md)。

- **①顶栏收拢（MainActivity.kt TopBar）**：删除胶囊内复制图标与「房主」标注，房间码胶囊只读化（不再可点按）；操作区保留分享与退出。口令 encode 单一来源不变。
- **②上一首/下一首（修复 Bug④ + 建议②）**：`PlayerSheet` 标题行新增 48dp 上一首/下一首圆钮（房主可用，成员点按弹「只有房主可以切歌」，与歌单行为一致）；通知栏/蓝牙切歌由 `ForwardingSimpleBasePlayer` 覆写 `getState()` 追加 COMMAND_SEEK_TO_NEXT/PREVIOUS、`handleSeek` 按命令路由到 `sync/TrackQueue.skip(±1)`（环形回绕纯函数，未知当前曲目下一首取首/上一首取末，空歌单返回 null）→ 房主 `command("select")`。根因：转发器透传单条目 ExoPlayer 可用命令——无 NEXT、PREVIOUS 被 ExoPlayer 实现为 rewind，根本到不了 handleSeek（[陷阱 9.4](development-pitfalls.md)）。
- **③去搜索（MainActivity.kt + 删 PlaylistFilter.kt/PlaylistFilterTest）**：搜索框、`PlaylistFilter` 纯函数、9 项单测与长图导出的筛选词依赖整体移除，歌单恢复完整列表；「保存长图」导出全量歌单。
- **④口令隐端口（InviteCode.kt + RoomClient.kt）**：encode 剥掉约定端口 `:3000`（正则 `^(https?://[^/?#]+):3000$`），分享口令不再暴露端口号；`RoomClient.join` 在地址唯一入口对无端口 URL（okhttp 回填成 80/443）补回 3000，**显式非默认端口（如 :8080）两向原样保留**——口令省略与入房补回互为 round-trip。新增 InviteCodeTest 2 项（隐端口/保非默认端口）+ RoomClientSessionTest 1 项（explicitNonDefaultPortPreserved），既有 3 处断言改以 `:3000` 基址为准（兼作回归）。
- **⑤云端曲库去 demo-load（用户试用服务器）**：media-originals/20260924-221628/ 备份（mp3 + catalog.json.bak）→ catalog.json 24→23 → 音频移出 media/ → restart → catalog API 23 首实证 → `m4-deploy-verify.sh` **14/14**（[陷阱 8.10](development-pitfalls.md)：曲库启动时加载、改后必须重启）。
- **构建验收**：`gradlew :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug` → BUILD SUCCESSFUL；单测实跑 **74 项**（`tests=74 failures=0 errors=0`，xml 合计），Lint 0。APK SHA256 **011DD835CF111A9DB8B352E206B00A341962EC5D5722D3D8830AC54BFEF1910E**。
- **真机验收（待 USB 重连）**：通知栏上一首/下一首实际切歌、Sheet 切歌钮与成员 Snackbar、口令隐端口粘贴入房、无搜索框、云端 23 首——安装时设备离线（adb 无设备、无 mDNS 服务），装包脚本未执行成功；设备重连后按 [feedback-round](test-results/2026-09-24-feedback-round/README.md) 场景补验。

## 本轮新增（UI 重构：入口收拢 + 常驻播放器，2026-09-24 晚）

> Android 布局与组件重构轮，未改 server/、网络层与行为约定；seek 确认模型原样迁移。完整真机证据见 [ui-refresh](test-results/2026-09-24-ui-refresh/README.md)。

- **入口页（A）**：删除 primaryContainer 欢迎大卡，收拢为「文字标题区 + 单卡片表单」——分段切换/昵称/粘贴邀请/邀请码/高级设置/错误横幅/主按钮同处一张 surfaceContainer 卡；连接进度条移到卡下。
- **播放器（B1）**：`NowPlayingCard` 列表卡拆为 `ui/RoomPlayer.kt`——Scaffold bottomBar `MiniPlayer`（3dp 细进度 + 歌名/状态 + 44dp 播放键，点击展开）与 `ModalBottomSheet` 的 `PlayerSheet`（完整滑条/时间/同步说明）；`RoomPlayerState`（positionMs/dragged/pendingSeek）挂房间会话作用域，Sheet 关闭不中断快照确认与 5 秒兜底；`dragged` 从 JoinInput 迁出。
- **成员区（B2）**：默认压缩为一行 `AvatarStack`（≤5 个重叠头像 + +N 圆片，首个头像状态点不被遮挡）+「N 人一起听 · 状态」+ 箭头，整行点击展开原成员列表。
- **顶栏（B3）**：房间码 + 复制图标合并为 secondaryContainer 胶囊，点按即复制邀请口令（Snackbar 反馈），删除独立复制按钮；口令 encode 单一来源不变。
- **歌单（B4）**：当前曲目播放中行首替换为 `PlayingIndicator`（3 根错相跳动竖条）。
- **回归**：无新增纯函数逻辑（seek 确认/编解码/过滤均原样迁移），73 项单测 cleanTest 实跑全过、Lint `No issues found`；APK SHA256 **6C231394C9BD14D50CFE61D08F1513403AB32184C7E1C4CBDB836BFC192A76AC**。真机 10 项场景（两标签/校验/建房/胶囊复制/播放动效/展开页/两次 seek 确认/成员展开/退出回流）全部通过；多人堆叠、Sheet 关闭后 seek 未确认兜底、暗色对比度抽查如实标注未覆盖。

## 本轮新增（UI 试用反馈：布局、滚动与歌单长图，2026-09-24）

> Android 实现 + PHQ110 真机轮；公网歌单、滚动帧率和 PNG 导出已有实测，长截屏 OEM 入口、旧版对照与播放中听感仍待验。完整记录见 [ui-scroll](test-results/2026-09-24-ui-scroll/README.md)。

- **UI**：首页主题欢迎卡 + 创建/加入分段切换；顶栏左对齐；播放按钮移至曲名右侧、播放卡去阴影并缩小内边距；歌单间距 8dp，显示命中数量；edge-to-edge 与 560dp 限宽修正。
- **滚动开销**：隔离每 500ms 的本机进度刷新，播放器单独订阅；列表过滤按曲库/查询缓存；独立歌单行、时长文本缓存、稳定 key/contentType；保留全部 room 快照与 seek 确认信息。此为已实现的代码优化，未宣称真机卡顿已消除。
- **长图**：新增「保存长图」导出完整命中歌单为 PNG（包含屏幕外歌曲）；系统保存器选位置，后台线程绘制/编码，无存储权限；当前标记/长标题/取消和失败路径已实现。系统 Compose ScrollCapture 本就存在；ColorOS 原生长截屏入口尚未确认修复。
- **回归**：新增 ScreenStateTest 3 项（进度去重、业务状态透传、seek 快照完整性）。最终 `cleanTestDebugUnitTest + testDebugUnitTest + assembleDebug + lintDebug` 成功；**73 项实跑，0 失败/错误/跳过，Lint 0 错误 0 警告**；文档链接检查通过。APK SHA256：**B4833B95AAA278E8AFA946AB2D78786572A95A35A3622C8E704102B8FFB59431**。

## 本轮新增（UI 批次真机验收：批次 1 + 批次 2，2026-09-24 下午）

> **通过，零产品缺陷**。PHQ110（USB，serial fbddbe8）+ 本地演示后端（demo-media）+ 验收驱动 `.workbuddy/b1_driver.py`（单进程连接→装包→reverse→场景序列→导出诊断）。APK 2CBA5913…（批次 2 构建，批次 1 场景同轮重验）。完整场景矩阵与证据见 [test-results/2026-09-24-ui-batch-acceptance](test-results/2026-09-24-ui-batch-acceptance/README.md)。

- **批次 1 邀请口令闭环全过**：复制口令→Snackbar「邀请已复制，发给朋友即可」；「粘贴邀请」→确认卡（房间码+服务器地址，快照断言）；确认卡→「加入，一起听」→重入同房（room=3C67DD61 与口令一致，页面以顶栏「退出房间」图标为房间页标志、排除确认卡同码假阳性）；口令地址≠已记住地址→Info 提示且以口令地址入房；join 失败（手填不存在房间码）→错误横幅**「房间不存在或已过期」**、横幅优先于确认卡、已填昵称保留。
- **批次 2 全过**：展开成员显示头像首字符'B'+'B1'+'房主 · 在线'（文字行并存不单靠颜色）；搜索'192'→列表仅剩 192kbps 行（'45 秒'行消失）、无命中显示「没有匹配的歌曲」、清除恢复全列表；选歌切换当前歌曲为「合成长测试音 · 40 分钟」。
- **播放与 E-07 回归（批次 2 动了 MainActivity 后必做）**：40 分钟曲 PLAYING；拖回开头 20794ms→6125ms；诊断 playback=196、correction **seek=1**（恰为主动拖动一次）、速率中位 **995ms/s=1.0x**；手填 join 对照组同步通过。
- **自动化边界（如实标注，三项待人工）**：智能识别（整段口令粘进邀请码框）——adb 无法向 Compose 字段注入中文剪贴板（keyevent 279 / Ctrl+V 均未生效）；busy 禁用——本地 reverse 下 join 时序过短无法稳定断言；系统分享面板实际弹出——需拉起外部 chooser。口令文本本身已由 encode 单测 + 复制路径旁证。
- **验收过程发现并修复的驱动侧问题（非产品缺陷，已回填[陷阱 2.11](development-pitfalls.md)）**：ColorOS 输入法对 uiautomator 不可见且 keyevent 111 不收起，底部区域 tap 全被拦截（keyevent 4 解法）；LazyColumn 未组合行不在 dump（滚动查找）；服务端房间回收后的僵尸会话（先看 /health 再操作）；播放动画期 dump 失败须重试。期间 0 处产品代码改动。

## 本轮新增（批次 2：成员可视化 + 歌单搜索，2026-09-24）

> Android 客户端轮：只改 `android/app` 与文档，未动 server/、未引入新依赖、未部署、未做 git 提交、未执行 adb/真机操作（设备正被并行验收占用）。**真机目视验收已于同日通过**（成员头像/搜索过滤/占位/清除/选歌，见 [test-results/2026-09-24-ui-batch-acceptance](test-results/2026-09-24-ui-batch-acceptance/README.md)）。

- **成员状态可视化（新增 `app/src/main/java/com/listentogether/app/ui/MemberAvatar.kt` + MainActivity.kt MembersSection 改造）**：成员行新增圆形头像——昵称首字符（空白兜底「友」），背景从主题派生的 6 色固定色板（primary/secondary/tertiary 及各自 container，配对对应 on 色）按 memberId 稳定散列（`avatarPaletteIndex(memberId, paletteSize)` 纯函数，`hash * 31 + code` 折叠 + `mod`）取索引，同一成员颜色恒定，无硬编码色值，亮暗方案自动跟随。头像右下角 10dp 在线状态点：在线 colorScheme.primary、离线 colorScheme.outline，surface 色 1.5dp 描边保证任意底色上可见。「房主 · 在线/离线」文字行保留，不单靠颜色传达状态；折叠/展开结构与「N 人一起听」摘要不变。实现收敛在独立小文件，避免 MainActivity 继续膨胀。
- **歌单搜索（新增 `app/src/main/java/com/listentogether/app/ui/PlaylistFilter.kt` + MainActivity.kt PlaylistSection 改造）**：歌单区顶部新增 OutlinedTextField——单行、FieldShape、leading 图标 Icons.Outlined.Search、非空时 trailing 清除按钮 Icons.Outlined.Close（contentDescription「清除搜索」）、placeholder「搜索歌曲」。过滤逻辑抽为纯函数 `PlaylistFilter.filter(titles, query): List<Int>`（返回命中原索引，保持原顺序）：查询串首尾 trim、空查询返回全部、大小写不敏感、子串包含匹配（中文直接匹配）。过滤后为空显示「没有匹配的歌曲」；当前播放项按原索引对齐，高亮在过滤结果中依然生效；搜索词存于 `PlaylistSearch`（按房间会话 remember，退出重进自动重置），只影响本地显示，不触碰播放与服务器状态；清空或退出恢复完整列表。曲库为空时仍显示原提示，不显示搜索框。
- **新增 9 项 JVM 单测**：PlaylistFilterTest 6 项（空查询全返回、大小写不敏感、trim、无命中返回空、中部子串命中、中文曲名匹配）+ AvatarPaletteIndexTest 3 项（同 id 恒定同色、任意 id/色板大小索引在界内、不同 id 允许分布）。
- **构建验收**：`.\gradlew.bat :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug --console=plain` → **BUILD SUCCESSFUL in 1m 54s**；单测实跑 **70 项（61 基线 + 9 新增），0 失败 0 错误 0 跳过**（`build/test-results/testDebugUnitTest/*.xml` 合计 `tests=70 failures=0 errors=0 skipped=0`；`> Task :app:testDebugUnitTest` 实跑，不带 UP-TO-DATE）；Lint **0 错误 0 警告**。
- **APK SHA256**：**2CBA59132F8103C9AB450CA627A61A1A2AC95F6708E7C55422E73111AB427E73**（app-debug.apk，本轮 15:22 重建）。
- **边界与自查修正**：首轮构建暴露 PlaylistFilterTest 一处断言错误（「loving you」不含子串「love」，测试预期自身写错，非实现缺陷），修正预期后全绿；初次全量重跑 BUILD FAILED 后修正，最终结果以上述最终一轮实跑为准。未改 server/、未部署、未执行 adb、未做 git 提交。

## 本轮新增（批次 1：邀请口令闭环，2026-09-24）

> Android 客户端轮：只改 `android/app` 与文档，未动 server/、未部署、未做 git 提交。**真机验收已于同日通过**（复制→粘贴闭环/失败路径/地址不一致提示，见 [test-results/2026-09-24-ui-batch-acceptance](test-results/2026-09-24-ui-batch-acceptance/README.md)）；智能识别、busy 禁用、分享面板弹出三项自动化未能模拟，标注人工验证。

- **InviteCode 编解码（新增 `app/src/main/java/com/listentogether/app/InviteCode.kt`）**：encode 产出四行纯文本口令（来一起听歌 / 房间码 X / 服务器 URL / 复制整段，打开 App 即可加入），地址为空时省略服务器行；decode 用锚点正则（`(?:房间码|邀请码)[^0-9A-Za-z]*([0-9A-Fa-f]{8})` 与 `(https?://…)`）容错解析，容忍微信/QQ 加引号、前后闲聊行、全角冒号、hex 大小写混用，两行均在全文任意位置匹配、不做宽松匹配；房间码必得（大写归一），服务器可空=缺地址降级沿用已存地址；失败返回 null 不抛异常。口令只含房间码与服务器地址（公开信息），**绝不包含成员令牌**。
- **顶栏复制/分享改造（MainActivity.kt）**：复制改为完整口令，Snackbar「邀请已复制，发给朋友即可」；分享 EXTRA_TEXT 与复制共用同一 encode 来源（`inviteText` 单点生成，无两处硬编码）；chooser 标题「分享邀请」。
- **加入 Tab（MainActivity.kt）**：邀请码输入框上方新增「粘贴邀请」FilledTonalButton（ContentPaste 20dp + 文字、高 40dp、PillShape、fillMaxWidth、与输入框间距 8dp）；onClick 只读一次剪贴板并 decode（Android 13+ 系统自带"已粘贴"提示，App 不重复告知）；解析成功 → 表单被口令接管（房间码替换为 8 位码、地址字段填入口令值）并显示邀请确认卡——Surface surfaceVariant + BannerShape、padding 14dp，房间码 titleMedium 等宽、地址 bodySmall 次级色、「重新输入」TextButton 拆卡回手填；口令地址≠已记住地址时 Info 图标 20dp + 「将使用邀请中的服务器地址」（不阻断，入房以口令地址为准）；确认卡容器 liveRegion=Polite。解析失败 → Snackbar「未识别到有效邀请，请复制完整邀请后重试」，表单不动。智能识别兜底：邀请码框文本 >8 字符且含「房间码」锚点时尝试 decode，成功接管表单、失败保留用户输入。确认卡与 join 错误横幅互斥展示（失败优先横幅，确认卡数据与已填昵称保留）；busy 时粘贴/重新输入禁用。
- **InviteCodeTest（新增，8 项 JVM 单测）**：encode 四行格式、无地址省略服务器行、encode/decode 往返、引号+闲聊行容错、全角冒号+大小写混用、仅房间码 server=null、无锚点失败（含裸 8 位码不认）、不足 8 位失败。
- **构建验收**：`.\gradlew.bat :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug --console=plain` → **BUILD SUCCESSFUL in 3m 49s**；单测实跑 **61 项（53+8），0 失败 0 错误 0 跳过**（`build/test-results/testDebugUnitTest/*.xml` mtime 为本轮 14:51，合计 `tests=61 skipped=0 failures=0 errors=0`，其中 InviteCodeTest 8/8；`> Task :app:testDebugUnitTest` 不带 UP-TO-DATE）；Lint **0 错误 0 警告**（仅既有的 Information 级 AutoboxingStateCreation 提示，非本轮引入）。
- **APK SHA256**：**BF393FB4801BF907E390A6694E3FE56D9BE54A326E7E0E9176F9141738D5A967**（app-debug.apk，本轮 14:51 重建）。
- **边界与自查修正**：定稿方案写的 TonalButton 在项目锁定的 material3 1.3.x 稳定版不存在（该 API 1.4-alpha 才引入，首轮编译即失败并暴露），改用同语义稳定版 **FilledTonalButton**，无新依赖；「确认卡与错误横幅互斥」落地为错误横幅优先、确认卡在其存在期间回退为手填输入框（数据保留、手动编辑即拆卡）。emoji 扫描 `grep -rP '[\x{1F300}-\x{1F9FF}…]'` 零匹配；未改 server/、未部署、设备离线未做真机操作、未做 git 提交。

## 本轮新增（长时 + 多人组合真机测试：M3-LONG 复活，2026-09-24）

> **通过**。真实音乐（非测试音）顺播 70 分钟 + 息屏 30 分钟 + 多人动态进出（最高 5 人在线）+ 房主转移，全部达成。完整方案、判定与数据见 [test-results/2026-09-24-long-multiplayer](test-results/2026-09-24-long-multiplayer/README.md)。

- **长时**：真实歌单顺播 70 分钟（T0=11:03→12:13）零中断；诊断 4988 条（**seek=1**（仅 E-07 主动拖动）/ speed=82（省电变速追赶，设计内）/ buffering=46）；自动顺切 20 首（诊断窗口内 14 首全成功）；主测 WS 70 分钟单次连接（蜂窝）。
- **息屏**：11:19→11:49 整 30 分钟 Dozing，全程 PLAYING、息屏中切歌 3 次、位置速率 ≈1.0x；定时解锁后播放无缝。
- **多人**：最高 5 人在线、加入/退出全程服务器事件记录（joined×11 / left×7 / removed×4）、error=0；E-05/E-09 防线对真实用户零误伤。
- **房主转移**：主测退出瞬间转移给在线成员、新房主切歌立即生效；主测重入 5 秒内追上；**无主房间边界**——hostId 清空后 tick 自动授予下一个在线成员房主（修正"永久无主"初判）。
- **交互对账**：E-07 拖回开头生效（全场唯一 seek）、暂停/恢复服务器快照逐位一致。
- **边界**：非房主切歌被拒 / 成员本地暂停互不影响未覆盖（参与者中途全部离场）；诊断仅前 60 分钟（窗口上限，如期兑现）；听感为主观确认；结论只对参与设备与本网络条件。曲库同步扩充至 24 首真实音乐（96.5 分钟，192k，demo-load 挪至末尾）。

## 本轮新增（后端防线上云：release 20260924-0937，2026-09-24 上午）

> C1 时间片 09:35 声明 → 收尾释放。完整操作序列、实测数据与边界见 [test-results/2026-09-24-backend-deploy](test-results/2026-09-24-backend-deploy/README.md)。

- **升级成功**：`package-deploy.ps1` 打包（tsc 0 错误、11.4MB、LF 清单）→ scp 上传 → `releases/20260924-0937` 解包 → **sha256sum 42/42 OK** → listen 账号 npm ci / npm run build（BUILD-EXIT=0）/ prune 三关全过 → **`current-version.txt` 成对写入 id=20260924-0937 / prev=20260922-2159** → `ln -sfn` → restart。health 第 2 秒返回 **`{"ok":true,"rooms":0,"onlineMembers":0,"wsConnections":0}`**（新计数字段生效即新代码在跑的直接证据）；MainPID 16099→20210、NRestarts=0、WorkingDirectory 不变。
- **基线 → 升级对比**：旧版本 14 项脚本 pass=13 fail=0（第 1 项 health 计数按设计 SKIP）；新版本 **pass=14 fail=0**（health 字段解析与配额预检均实 PASS）。仪表先在已知良好版本上验证，升级后的失败才可归因。
- **新防线公网验证**：**E-05** 同令牌握手 `open×5 → http429`（10 秒窗口 5 次额度，第 6 次拒绝）；**E-09** 建房序列 `200,200,429,429`、终态 rooms=3——即"起始 1 间（14 项脚本残留）再建 2 间到顶、第 3 次起 429"的精确行为（验证脚本打印 FAIL 系自身 expectBase 参数漏算残留房间，非防线缺陷，行为数据完整）；**Q-3** 事件通道 journal 实证 `room.created×3 / member.joined×3 / member.online×6 / host.transferred / member.removed×2 / ws.handshake_rejected×1`，无令牌字段；6 分钟窗口 error/unhandled 计数 **0**。
- **回滚预案**：prev=20260922-2159 真实存在未动用。本次升级与在产版本存在**实质代码差异**，覆盖了 W3 演练"同代码新 ID"未能证明的"新代码上线"路径；升级失败注入仍未做（同 W3 边界）。
- **边界**：APK E814F90E 真机验收仍待设备在线（本轮验证覆盖服务端与公网 HTTP/WS 层）；测试房间占用同 IP 配额约 5 分钟后自动回收（终态复核见下）；出网流量仅几 KB。

## 本轮新增（工具与文档轮：门禁强制实跑 Q-2 / 明文边界 E-06 / 协议契约 A-02 轻量版，2026-09-24）

> **纯工具与文档轮**：只改 `scripts/check.ps1`、文档与一个测试文件，**未改任何产品代码、未部署、未重建 APK，无新 hash**（锚仍为 E814F90E…）。

- **[Q-2] 门禁强制实跑**：`scripts/check.ps1` 安卓段由 `:app:testDebugUnitTest` 改为 `:app:cleanTestDebugUnitTest :app:testDebugUnitTest`。此前 Gradle 增量构建会把输入未变的测试任务判为 `UP-TO-DATE` **并跳过实跑**，门禁报"通过"其实只是上一轮的结论（历史记录里已出现过"45 项 UP-TO-DATE"这种写法）。清理该变体测试任务的输出后再执行，测试必然本轮重跑；只删 `build/test-results`、`build/reports` 对应目录，**不触发重新编译与重新打包**（APK 不变）。已在 AGENTS.md 的常用命令同步。顺带按[陷阱 1.5/1.6](development-pitfalls.md) 改造 `Invoke-CheckedCommand`：调用原生命令期间把 `$ErrorActionPreference` 收窄为 Continue 并在 `finally` 恢复，成败只认 `$LASTEXITCODE`（旧写法在 EAP=Stop 下会把 gradle/npm 的任意一行 stderr 变成终止错误）。
- **[E-06] 明文边界写进 README「行为约定」**：新增一条——试用期内入口是 `http://8.166.126.136:3000` 明文 HTTP，Bearer 令牌在链路上可被窃听，服务端**没有令牌撤销机制**（令牌只在内存里，重新入房换新令牌，旧令牌随成员离线 60 秒清理 / 房间空置 5 分钟删除而失效），正式使用必须先换 TLS + 域名。措辞与既有路线 A 决策一致，未新增任何承诺。
- **[A-02 轻量版] 协议单一出处可执行化**：`docs/protocol.md` 追加「JSON Schema（v1 消息契约）」小节，覆盖 `state` 快照与 `sync`/`command`/`clock`/`error` 五类消息；新增 `server/test/protocol.test.ts`（2 项）**直接从该文档提取 schema**，校验 `buildApp` 产出的真实消息（WS 收到的 state/clock/error、直接取样的快照、出站 sync/command）与 `members[]` 形态。`additionalProperties:false` 保证实现新增/改名字段而文档漏改也会失败；另有一项用构造性漂移（多字段/缺字段/类型错/未知 action/越界 status）证明校验器有牙，避免"schema 被掏空后测试恒绿"。校验器为 `server/test/mini-schema.ts` 的最小实现（约 80 行，支持 `$ref/type/const/enum/required/properties/additionalProperties/items/minLength/maxLength/minimum/maximum/maxItems/pattern/oneOf`）——**无 codegen、无运行时依赖**。
- **本地验证结果**：后端 `npm run build`（tsc 0 错误）+ `npm test` **20/20 通过**（18 + 2）；反向确认——给 `snapshot()` 临时塞一个文档未定义字段，protocol.test.ts 立刻失败，撤回后恢复全绿；`scripts/check.ps1 -Scope all` 全过（后端 20/20；安卓 `:app:cleanTestDebugUnitTest :app:testDebugUnitTest` **本轮实跑 53 项**，`build/test-results/testDebugUnitTest/*.xml` 的 mtime 为本次、`tests=53 skipped=0 failures=0 errors=0`，日志中 test 任务不再是 UP-TO-DATE；assembleDebug/packageDebug 仍 UP-TO-DATE，**APK SHA256 与上轮一致 E814F90E…**；lintDebug 通过；Markdown 链接检查通过）。**实跑可重复**：紧接着单独复跑一次 `-Scope android`，两次都是 `3 executed, 51 up-to-date`（cleanTest / test / lint），结果 XML 时间戳随每次刷新——不是一次性的假象。外部日志用 `*>&1 | Out-File` 采集也不再触发[陷阱 1.5](development-pitfalls.md) 的空消息异常（EAP 已在脚本内收窄）；只有 node.exe 的中文输出在 PS 5.1 日志里仍会乱码（陷阱 1.3），判成败一律看退出码。
- **边界**：本轮**未部署云端、未跑真机**；E-06 只是把既有的明文约束写进行为约定，不代表入口或 TLS 方案有任何变化。

## 本轮新增（后端防线 E-05/E-09 + 排障通道 Q-3 + 防线回归 Q-4/Q-5，2026-09-24）

> 本轮只动后端（server/src、server/test）、验收入口脚本与文档：**未改 Android 代码、未重建 APK**，APK 锚仍为 E814F90E…。

- **[E-05] WS 握手限连**：`/ws/:code` 在鉴权通过后按"成员令牌 + 来源 IP"做固定窗口计数，10 秒内最多 5 次升级请求，超出返回 HTTP 429「连接过于频繁，请稍后重试」拒绝升级；无效令牌仍是 401 且不占额度。阈值 5 高于客户端 1/2/4/8/16 秒退避重连节奏（任一 10 秒窗口最多 4 次），正常断线重连不受影响；并已核对客户端侧行为——`RoomClient.onFailure` 只把 401/404 判为终态，**429 走非终态 → Reconnecting 退避重试**，不会误判成 Expired。实现为单进程内存 Map（`realtime/limits.ts`，无新依赖；键数上限 4096，超限淘汰最旧键，内存有界）。**消息级 20 条/秒限频未改动**。
- **[E-09] 建房存量配额**：Room 新增 `creatorIp`（取 `req.ip`，trustProxy 仅信任回环、直连不可伪造），**同 IP 活跃房间 ≤3**，第 4 间返回 429「同一来源最多同时创建 3 个房间，请先使用已有房间」；空房 5 分钟回收的语义不变，回收即释放配额（不按历史累计）。与路由既有的每 IP 30 次/分钟限速是两道独立防线（限速不限量 → 现在也限量）。
- **[Q-3] 排障通道**：结构化事件日志覆盖 `room.created`/`room.deleted`、`host.transferred`、`member.joined`/`online`/`offline`/`left`/`removed`、`ws.handshake_rejected`，字段只含房间码、成员 ID、来源 IP，**不含 Authorization、成员令牌与昵称**（有单测红线）；`/health` 追加 `rooms`/`onlineMembers`/`wsConnections` 只读计数，保留 `{ok:true}` 兼容现有探活。生产日志（logger=true）实测形如 `{"level":30,...,"event":"member.online","code":"39294E55","memberId":"...","msg":"member.online"}`。
- **[Q-4/Q-5] 防线回归**：后端测试 **7 → 18 项**。新增：曲库拒绝 `../` 逃逸与指向库外的目录链接（含"库内链接仍可加载"对照）、WS 同连接第 21 条消息/秒收 429 error 帧、bufferedAmount 超 128KiB 时 `close(1013)`、15 秒无 pong 才 terminate（假 timer 注入）、握手限连 3 例（超限 429 / 换源 IP 不受影响 / 无效令牌仍 401）、建房配额 2 例（回收释放、按 IP 隔离）、事件红线与 health 计数。**既有 7 项全部未回归**。为可测性把发送与心跳抽成 `createSender`/`startHeartbeat`（socket 面与 timer 可注入），生产行为不变。
- **本地验证结果**：`npm run build`（tsc 0 错误）+ `npm test` **18/18 通过**；`scripts/check.ps1 -Scope server` 全过；另起真实后端冒烟：同令牌连续握手 `open,open,open,open,429`、同 IP 第 4 次建房 429、`wsConnections` 随连接 0→1→0、事件日志中无令牌。限流用例做过反向确认（把限流阈值放大后该用例立刻失败），证明它真的钉住防线而不是恒真。
- **⚠️ 本地通过 ≠ 云端生效**：以上三处修复要真正生效，必须把新版本部署到 8.166.126.136。**本轮未部署**——部署需要独占云端时间片，且 `systemctl restart` 会清空全部内存房间，执行前必须确认无活跃房间（[deployment.md 第 5 节](deployment.md)；现在可直接读 `/health` 的 `rooms/onlineMembers/wsConnections` 三个计数）。未做的还有：云端复跑 14 项服务端验证、升级/回滚演练、真机回归。
- **验收入口同步**：`m4-deploy-verify.sh` 由 13 项增至 **14 项**——health 改为按字段解析（旧版本无计数时 SKIP、不计失败），并在建房前用 `rooms` 计数做存量配额预检，避免连续重跑第 4 次被 429 误判为新版本缺陷（见[陷阱 8.9](development-pitfalls.md)）。该脚本**未在云端执行**。

## 本轮新增（客户端缺陷修复 A-01/E-07 + 诊断测试 Q-1，2026-09-24）


- **[A-01] PlaybackService 会话代次守卫**：applyState 入口、onPlayerError、500ms 位置上报循环、onPlayWhenReadyChanged（焦点/耳机）四处加 `client.sessionGeneration != boundGeneration` 守卫。旧服务实例退出/换房间后不再向新会话上报位置、load/seek 播放器（双播放器竞态消除）、误标 locallyPaused。applyState 入口守卫触发时 pause + stopSelf，循环守卫触发时 stopSelf + break，不让服务僵住。行为约定不变。
- **[E-07] seek 乐观预览确认条件过松**：播放中分支 `positionMs >= target - 1500` 在 `target ≤ 1500ms` 时对任意非负位置恒真（seek 指令丢失也显示成功）。改用相对推进量确认——记录发起 seek 时刻 `pendingSeekTimeMs`，容忍窗口 = 确认以来经过的时长 + 固定余量（1500ms 含 RTT 补偿），即 `abs(snapshot.positionMs - target) <= elapsed + 1500`。拖回开头等低 target 场景下，确认需快照位置确实接近 0。5 秒未确认提示兜底不变。
- **[Q-1] DiagnosticsLogTest（8 项 JVM 单测）**：覆盖 20MB 轮转停止、60 分钟窗口停止、JSONL 行格式（type/wallClockMs/monotonicMs/deviceLabel 必有字段）、令牌不出现在输出（红线约束：无 Bearer/Authorization/token 文本与 JSON 键）、禁用时不创建文件。DiagnosticsLog 重构为内部构造器注入时钟/目录/执行器，生产入口不变。
- **构建验收**：`gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug` 全过——53 项单测（+8 新增）、BUILD SUCCESSFUL、Lint 0 错误 0 警告。APK SHA256 **E814F90E…**。`check-doc-links.mjs` 通过。
- **真机验收显式标注待设备在线**：分级纠正回归（A-01 代次守卫后旧实例 stopSelf，新实例由系统重建）+ "拖回开头" seek 确认场景（E-07 修复后 target=0 不再恒确认），不得记为通过。

## 本轮新增（文档结构优化，2026-09-24）

- **verification.md 重建**：33 个按时间平铺的历史小节压缩为「交付历史索引」与「APK 版本历史」两张表；每轮完整证据仍在 docs/test-results/ 与归档文档中，索引行给出链接。修正过时表述（如「本轮尚未部署到云端」）。
- **计划文档收敛**：execution-plan.md 删除——M3-LONG 执行要点并入 [路线图](next-development-plan.md)，验收报告字段规范并入 [开发规范](development-standards.md)；learning.md（关键代码阅读顺序）并入 [模块索引](modules/README.md)。
- **一次性文档归档**：handover-2026-09-23.md（W1/W2 交接单，使命完结）与 playback-test-2026-09-21.md（早期播放测试）移入 [docs/archive/](archive/)，内容未删改。
- **parallel-development-plan.md 压缩**：W1–W4 已完成工作流的任务定义删除，保留完成摘要与证据链接；W5–W7、C1–C8 协调规则保留。
- 本轮为纯文档重构：未改产品代码、未重建 APK（锚 36BD3A5B… 不变）；`scripts/check-doc-links.mjs` 全量通过。

## 本轮新增（收尾汇总：全量回归 + 文档一致性 + 入口快照，2026-09-24）

> 收尾会话：不改产品代码、不动服务器；对 W1–W4 并行交付做统一回归、一致性核对与入口同步。

- **全量回归通过**（scripts/check.ps1 -Scope all）：后端 tsc 0 错误 + **7/7 测试**；安卓 testDebugUnitTest（输入未变 UP-TO-DATE，**45 项**）+ assembleDebug + lintDebug 通过（BUILD SUCCESSFUL 52s，**Lint 0 错误 0 警告**）；Markdown 本地链接检查通过。
- **APK hash 不变声明**：本轮未改产品代码、未重建 APK，锚定 36BD3A5B…；全量检索核对无并行会话引入新 hash。
- **文档一致性核对与最小合并**：「尚待验收」清单勾选与正文逐条核对一致；唯一矛盾——LOAD-15 条目（2026-09-22 行）尾巴"云端 TLS/公网重测仍属 M4 门槛"已被云端通过推翻，已就地更正。
- **入口快照同步**：AGENTS.md 快照更新为"2026-09-24 收尾确认"；parallel-development-plan.md W1/W2 标注完成（W3/W4 此前已标），T1/T2 清零；同文两处过时口径一并更正（LOAD-15 云端流量 2.2GB 估算→实测 ≈235MB/轮；"36BD3A5B 未真机验收"→已验收）。
- **工作区清理**：交接单第七节临时产物已删除（tmp-diag-*.jsonl ×4、services-dump.txt、flinger-a.txt、storm-window.txt、sync-offsets.txt，共 8 个）。
- 本轮边界：纯收尾交付——未执行真机/云端测试，未改任何产品代码、脚本与服务器状态。

## 交付历史索引（0.2.0 开发以来，新→旧）

| 日期 | 交付 | 结果 / 关键数据 | 详细记录 |
|---|---|---|---|
| 09-25 深夜 → 09-26 凌晨 | 夜轮装机验收 + 界面提示精简 | 补跑门禁（首轮 Lint 报 `CAMERA` 缺 `uses-feature`）→ 86 项实跑、Lint 0；`9C480583` + R8 `08607981` 装机回拉一致；6 项真机场景通过（预填/跨重建/重新加入/回收失败/二维码反解/HTTP 放行）；**歌单滑动 A/B：R8 0.77%/0.16% vs debug 7.66%/2.08%**，debug 口径的 27.27% 不代表用户构建；按用户指示删除播放状态文案与同步说明 → 终稿 `BCF3DE16`/`9E17F291`（84 项、Lint 0、**未装机**）；扫码/双人/大字号等未覆盖项如实标注 | [night-acceptance](test-results/2026-09-25-night-acceptance/README.md)、本轮（见上节） |
| 09-25 下午 | 0.3.0 批次 A 真机验收 | PHQ110/Android 14/云端：6 项场景通过（动态流含 60 秒移除抑制、伪封面与展开页、跟随滚动、头像 emoji 持久化、暗色可读；触感标人工）；真机抓到并修复展开页半屏回归；新增 `scripts/member-sim.mjs`；装机 hash 复核一致；APK **D882D186** | [device-batch-a](test-results/2026-09-25-device-batch-a/README.md) |
| 09-25 | 0.3.0 批次 A 一起听体验轮 | 房间动态流（快照差分 + everOnline 修正）+ 伪封面 + 歌单跟随 + 触感/无障碍 + 头像 emoji（全部客户端、零协议改动）；**独立复核 9 项修正**（含既有 RoomPlayerState 跨房间复用缺陷）；单测 74→**100** cleanTest 实跑全过、Lint issues=0；APK F5827821（复核稿）→ 当天下午真机验收并修复展开页半屏回归 → **D882D186**（见上一行） | 本轮（见上节）、[模块 01](modules/01-android-ui.md) |
| 09-24 夜 | 试用反馈轮 | 通知栏/展开页上一首下一首（TrackQueue 环形回绕）+ 顶栏只读胶囊 + 口令隐 :3000 round-trip + 去搜索；云端 23 首（demo-load 移除、14/14）；74 项单测、Lint 0；APK 011DD835 | [feedback-round](test-results/2026-09-24-feedback-round/README.md)、本轮（见上节） |
| 09-24 晚 | UI 重构轮（入口收拢+常驻播放器） | 单卡片表单/MiniPlayer+PlayerSheet/头像堆叠/码胶囊复制/当前曲动效；73 项单测实跑、Lint 0；APK 6C231394；真机 10 项场景通过 | [ui-refresh](test-results/2026-09-24-ui-refresh/README.md)、本轮（见上节） |
| 09-24 | 工具与文档轮 | Q-2 门禁强制实跑（cleanTest，可重复）+ E-06 明文边界入 README + A-02 协议 schema 契约；后端测试 20/20；纯工具/文档轮、**无新 hash** | 本轮（见上节） |
| 09-24 | 后端防线本地交付 | E-05 握手限连 + E-09 同 IP 建房配额 + Q-3 事件日志/health 计数；测试 7→18 全过；**未部署上云** | 本轮（见上节） |
| 09-24 | 文档结构优化 | 本轮（见上节） | — |
| 09-24 | 收尾汇总 | check.ps1 全过（后端 7/7+安卓 45+Lint 0+链接）；W1–W4 标注完成；清理临时产物 | commit 0a8724a |
| 09-23 晚 | W4 · LOAD-15 云端重测 | 15 路×600s 公网直连全 206 零失败、2.847Mbps=基线 99.1%；出网约 235MB/轮（旧估算 2.2GB 高一个数量级）；demo-load 上云保留 | [load15-cloud](test-results/2026-09-23-load15-cloud/README.md) |
| 09-23 晚 | W3 · 升级/回滚演练 | 升级到 20260923-2157 → 真实回滚到 20260922-2159 双向通过；PID 4191→14935→15175；13 项抽查三次各 13/0；restart 清空内存房间已实证；CRLF 清单与硬编码曲目两坑回填 | [m4-rollback-drill](test-results/2026-09-23-m4-rollback-drill/README.md) |
| 09-23 晚 | W1+W2 真机轨道 | W1：先纠正装机偏差（设备实为 169018AE→重装 36BD3A5B 回拉锚定）；关省电 180s 位置 1.001x 且 `seek=0`、开省电 `speed` 追赶 9 条、自动切歌零 seek、端点 14dp 圆点/5dp 轨道、暗色冷启动无白闪、听感用户确认。W2：同一 APK 公网七步全链路（version 2→9）、RTT 中位 65ms、第二房间复测通过 | [w1-recheck](test-results/2026-09-23-w1-recheck/README.md)、[m4-public-e2e](test-results/2026-09-23-m4-public-e2e/README.md) |
| 09-23 晚 | 并行开发推进方案 | 待办组织为 W1–W7 + C1–C8 冲突协调；真机轨道∥云端轨道 | [parallel-development-plan.md](parallel-development-plan.md) |
| 09-23 傍晚 | TLS/域名检查→路线 A | 备案拦截按域名（Host/SNI）跨任意端口生效（8443 对照实验推翻"非标端口可用"）；试用 ECS 无法备案；LE 不签裸 IP；用户决策维持 `http://8.166.126.136:3000` 明文 | [陷阱 8.6](development-pitfalls.md) |
| 09-23 傍晚 | 卡顿修复+进度条端点 | 根因=省电降频致渲染 underrun→每 5 秒 seek 风暴（0.86x 漂移）；分级纠正（500ms–2.5s 变速追赶、>2.5s 才 seek）+SmoothRenderers 0.7s 缓冲+每秒自检；进度条 14dp 圆点手柄；单测 45；APK 36BD3A5B | [交接单（归档）](archive/handover-2026-09-23.md)、[同步模块](modules/04-synchronization.md)、陷阱 9.1 |
| 09-23 中午 | 曲库工具链+全量转码 | add-media.ps1+media-manage.sh；云端 5 首 320k→192k（47.2→31.6MiB，-33%）；EAP=Stop 吞 stderr 警告坑回填 | [deployment.md 第 6 节](deployment.md) |
| 09-23 上午 | UI 优化真机验证 | 地址折叠/退出确认/返回 Toast 等目视通过（APK 169018AE）；Toast 不进 dump 等坑回填 | [ui-optimize](test-results/2026-09-23-ui-optimize/README.md) |
| 09-23 凌晨 | UI 系统评审+优化批次 | 2 致命/8 重要/7 建议分级清单，落地 12 项；APK 169018AE；单测 42 | [ui-refresh](test-results/2026-09-23-ui-refresh/README.md) |
| 09-23 凌晨 | 公网超时定位 | VS Code Remote 常驻会话三次触发全局 OOM→整机冻结（全端口超时的真面目）；服务本身 NRestarts=0；严禁服务器跑重负载 | [陷阱 8.5](development-pitfalls.md) |
| 09-23 | 简洁 UI 重构 | 首页 Tab/单主按钮/轻量歌单；APK 59773A08；本地 reverse 真机通过（公网因 OOM 超时未测） | [ui-refresh](test-results/2026-09-23-ui-refresh/README.md) |
| 09-22 深夜 | 图标+公网链路 | 图标 BE545EEF 装机；真机 curl 公网 200 首个数据点；E2E 自动化 6 连败暂停（陷阱 3.4） | [m4-public-test](test-results/2026-09-22-m4-public-test/README.md) |
| 09-22 深夜 | 公网开启+真实曲库 | HOST 0.0.0.0（安全组放行后真机可达）；云端曲库换 5 首真实 MP3 | — |
| 09-22 深夜 | M4 首次部署 | Node 24/listen 账号/releases+符号链接；服务端 13/13+SSH 隧道 9/9；个人音频误打包纠偏 | [m4-first-deploy](test-results/2026-09-22-m4-first-deploy/README.md) |
| 09-22 晚 | M3-AUTH 横幅复验通过 | 832FB65E 回拉一致；401 文案 5/5、"已同步"0/5（校时不覆盖暂停修复成立）；挂起项关闭 | [m3-auth-recheck](test-results/2026-09-22-m3-auth-recheck/README.md) |
| 09-22 晚 | M4 盘点+部署准备 | SSH 打通（authorized_keys 未写入所致）；服务器 1.7Gi 无 swap、Node 未装；package-deploy.ps1 实跑 | [m4-inventory](test-results/2026-09-22-m4-inventory/README.md) |
| 09-22 | 无线调试通道打通 | connect-wireless.ps1 一体化 connect+reverse+自检；无线 reverse 完全可用实锤 | 陷阱 2.7 |
| 09-22 | 架构文档+UI 交互修补 | [architecture.md](architecture.md)（分层/依赖/数据流/不变式）；imePadding/Snackbar/退出快捷键/滑块禁用说明；APK 5DA5082A | — |
| 09-22 | M3-LONG 物料+检查入口 | check.ps1/check-doc-links.mjs；demo-hour 70 分钟测试音+m3long-sample.ps1（真机执行仍挂起）；单测 32 | — |
| 09-22 | M3-FOCUS 音频焦点 | 抢占/来电本机暂停 ≤300ms、无自动恢复、明确点击续播；localPause 边沿诊断修复 | [m3-focus](test-results/2026-09-22-m3-focus/README.md) |
| 09-22 | M3-AUTH+LOAD-15 本地 | audio401 注入自测 10 项；真机 401 四次即停（8CF98CE1）；15 路本地 600s 2.873Mbps；负载成员必须持 WS 坑回填 | [m3-auth](test-results/2026-09-22-m3-auth/README.md)、[load15](test-results/2026-09-22-load15/README.md) |
| 09-22 | M3 稳定性批次 | 通知栏实际点击走服务端 pause；息屏 75s；蓝牙断开本机暂停；404→暂停→恢复续播 | [m3-notification-device](test-results/2026-09-22-m3-notification-device/README.md)、[m3-bluetooth-audio-error](test-results/2026-09-22-m3-bluetooth-audio-error/README.md) |
| 09-21 | 界面重构+拖动修复 | M3 Google 蓝 UI；乐观预览修复拖动回跳；开发陷阱清单建档 | [播放测试（归档）](archive/playback-test-2026-09-21.md) |
| 09-21 | M1 真机复测+故障注入 | 重连→404→Expired 全链路；300ms 延迟保持 Ready；12s 断线自动恢复；超宽限真实 Expired | [m1-session-device](test-results/2026-09-21-m1-session-device/README.md)、[m1-fault-proxy](test-results/2026-09-21-m1-fault-proxy/README.md) |
| 09-21 | M1 会话加固 | SessionContext/状态机/ClockEstimator/诊断 JSONL/可注入传输层；单测 21 | 同上 |
| 09-21 前 | 0.2.0 基线 | SDK35/JDK17 构建打通；音频焦点误恢复修复；应用图标；demo-media；build/start/install/smoke 脚本 | git 历史 |

## APK 版本历史（新→旧）

| SHA256 | 日期 | 内容 | 单测 | 真机状态 |
|---|---|---|---|---|
| F79DFE09211D8EE55B4F24B88BC18CA49CE022CD2C97D12DF628A7FA7DA3BA41 | 09-28 深夜 | **当前交付锚（已装机）**：结构拆分（MainActivity 868→284，ui/HomeScreen+RoomScreen+CommonUi）+ 封面双层缓存（LruCache + inSampleSize 降采样，rememberCoverBitmap 加 size 参数） | 128 | **USB 装机 PHQ110 且回拉逐位一致**；装机冒烟通过（歌单/展开页封面、歌词缓存键命中、debug 掉帧 14.3%→11.0%） |
| F762D90579C91B6600B3C1F53B20FD69208C2A9377E13D1C55DDDC4FFC951671 | 09-28 深夜 | **当前交付锚（已装机）**：lyricsVer 缓存失效——catalog 第 8 字段 `lyricsVer`，`LrcCache` 键 = id + lyricsVer（换词免清缓存），`ModelsTest` 补解析/键命名用例 | 128 | **USB 装机 PHQ110 且回拉逐位一致**；装机冒烟通过（歌词净本渲染 + 新缓存键实证，见 09-28 深夜节） |
| A586F93C7E7487A8ACB67A4A82170D4AE4F2AF5EBA020DEA42AD9AA826D2E13F | 09-27 下午 | 歌词跟随修复 + 无按钮三秒回位（09-28 真机验收回拉与此锚逐位一致；与同源码重建可复现） | 127 | **已装机 PHQ110 且回拉逐位一致**（09-28 元数据真机验收轮复核） |
| 854846985C5420A68CF05E677267FC9185CA0B6317432197181D8B46538BB77E | 09-27 白天 | 首页与扫码交互调整——扫码入口移到右上角、新增相册选图扫码（`LocalQrDecoder`）、删首页标语、邀请二维码弹窗改匀称 | 123 | 已装机（当晚被 A586F93C 取代）；用户实测相册选图扫码成功入房；截屏经 `jsQR` 独立反解确认码可扫 |
| AE3DFF35B16FE3570ACFB7AF2C36063F1DA8447DFAD0AF0437BB604D2C28A6B8 | 09-27 白天 | 同源码 R8 benchmark，性能测试专用、不分发 | 123（debug 侧计） | 构建通过，未装机 |
| 7C503FDD5853BD252705EA527B6B5D5FE4B7F3EA10E72EE8E5241E2C1046BF9A | 09-27 凌晨 | 元数据第二轮（歌词管线 + 占位封面）+ 歌词状态缺陷修复（`LyricsState` 纯函数：区分加载中/无歌词/无时间轴） | 118 | **已装机 PHQ110 并真机验收通过**（`pm path` 回拉字节+SHA256 一致；歌词渲染/逐行跟随/手动翻看暂停/自动恢复/三种占位/占位封面全部实测，见 [本轮记录](test-results/2026-09-27-metadata-r2-device/README.md)）；已被 85484698 取代 |
| 3945E4C83E21597B1D5D6910764F7FA35077D2094B0002138B6E3B4F6AE576E0 | 09-27 凌晨 | 同源码 R8 benchmark，性能测试专用、不分发 | 118（debug 侧计） | 构建通过，未装机 |
| b1e805735979558b4456abeb552141a7f821c50f1228a33ff2f80f133777d1ea | 09-26 深夜 | 元数据第二轮（歌词管线 + 封面静态占位），**未装机** | 111 | **已被 7C503FDD 取代**：该包含歌词状态缺陷（404 的曲目卡在「加载中」）。字节副本留在 `.workbuddy\deliverable-b1e80573.apk`（本机留档，不入库） |
| 517A776B05C30EEBF2E7A0E2B68FE315F959748F0C3C8057FC20B975B69D98A3 | 09-26 下午 | 上一交付锚：EC5FCF0A 基 + seek 确认单调时钟（`seekConfirmed` 纯函数）+ 重新加入昵称合成 | 96 | **已装机 PHQ110 并真机复测通过**（`pm path` 回拉一致；seek 三场景/过期重入闭环/扫码入房，见 [设备复测](test-results/2026-09-26-device-retest/README.md)） |
| 764D0FE19B27DEC71EA629115297CE1D74911DF1E782F775A2282F149239F1B8 | 09-26 下午 | 同源码 R8 benchmark，性能测试专用、不分发 | 96（debug 侧计） | 构建通过，未装机 |
| EC5FCF0A987D10087CE88CEC228CF4509CDCC5B4E6D06E0CC79662005A4C4870 | 09-26 | 遗留修复：邀请提示/解析边界、实际播放倍速复位 | 91（口径后更正为 92） | 未装机；代码基随 517A776B 装机复测覆盖；Lint 0，见 legacy-fixes |
| F943E3CA4942B84E23169CF0927A07BE11D607329F27DA86B27225F894E2438B | 09-26 | 同源码 R8 benchmark，性能测试专用、不分发 | 91（debug 侧计） | 构建通过，未装机 |
| BCF3DE1630969684B05BB6552E26925F76E34C0039C78B212F950CA250027AFE | 09-26 凌晨 | 终稿：夜轮全部改动 + 删除播放状态文案（`playbackLabel`/MiniPlayer 副标题/「当前歌曲」行/同步说明），`CAMERA` 补 `uses-feature`，二维码位图改用 androidx-core Ktx | 84 | **未装机**（用户此后无法提供真机）；门禁全过 |
| 9E17F2916D1E4B3A3F3C21A51CEC476E6EDEF51886179081E5FC5E34A72C7302 | 09-26 凌晨 | 与 BCF3DE16 同源码的 R8 benchmark 包 | 84（debug 侧计） | 未装机；构建含 `minifyBenchmarkWithR8`；不可分发 |
| 9C48058311d96f2a958c6f6f9ec083b6f726aab88973d96ceef29df69a7f40eb | 09-25 深夜 | 夜轮改动 + Lint 修复（`uses-feature` camera / UseKtx），状态文案尚未删除 | 86 | **已装机 PHQ110**，`pm path` 回拉一致；6 项真机场景通过（见 [night-acceptance](test-results/2026-09-25-night-acceptance/README.md)）；扫码/双人未覆盖 |
| 086079819f422c4eccaf2d9ea9a9940e3b2e86e2b617e3e5ebb9261c7bfd1ccc | 09-25 深夜 | 同源码 R8 benchmark 包（2.4 MB vs debug 23 MB） | 86（debug 侧计） | **已装机**，回拉一致；歌单滑动帧耗时在此包采集（0.77%/0.16%）；`run-as` 不可用故无客户端诊断；不可分发 |
| E984FF400894D50CADFFB1BD1665E54A479D88639F71CACC45C817DB8816CD6D | 09-25 晚续修 | 入房表单恢复 + 重新入房 + QR 扫描/展示 + 歌单测量支持 | —（未运行） | 构建成功；未装机；被 9C480583（补门禁与 Lint 修复）取代 |
| A201AE4A07AB700590651DDCB331B18E0CCFBB6D72069FD1F8158D2523C68B8B | 09-25 晚续修 | 专用 R8 优化 benchmark 包（debug 签名、仅 benchmark HTTP） | —（未运行） | 安装成功但当时未测帧耗时；被 08607981 取代；不可分发 |
| 80CF7629C3BB7416CC82F4728F5A9F6CA240269948D4D6D26CE1D13E2B92625E | 09-25 晚 | 歌单滚动优化 + 固定表头/独立列表 + 移除头像选择/动态/首字封面；进度条逻辑保持原样 | 86 | PHQ110 已装机、回拉 hash 一致；基础布局通过；连续滑动 janky 27.27%、带停顿 13.38%，性能待优化 |
| D882D18632E04E28887DD8D87181410CE1115098838E6C8729B5B9A77D2E4767 | 09-25 | 0.3.0 批次 A 终稿 + 真机修复：房间动态流 + 伪封面 + 歌单跟随 + 触感/无障碍 + 头像 emoji；`PlayerSheet` 改 `skipPartiallyExpanded`（真机发现半屏回归） | 100 | **真机验收通过**（PHQ110，6 项场景，见 [device-batch-a](test-results/2026-09-25-device-batch-a/README.md)；⑤触感标人工、10 分钟淡出未覆盖） |
| F58278214D11CE2EB9A4A5E47606FA104F4FE8D181916B333E150F81B1AE4009 | 09-25 | 0.3.0 批次 A 复核稿（含独立复核 9 项修正） | 100 | 未装机；真机验收暴露出展开页半屏回归，已被 D882D186 覆盖 |
| 466C7B729A5334D669447A475826404A473A698DC0A74B779C9CF433A5920E0D | 09-25 | 0.3.0 批次 A（中间稿，已被 F5827821 覆盖）：同上，差独立复核后的 9 项修正 | 97 | 未装机（中间产物，无验收） |
| C685CE0ADE0B7E3288BB13465B74D0A5D65D421A42A79D8415D2E4C9ED67B30E | 09-25 | 反馈二小轮：顶栏去房间码胶囊（统一显示「一起听歌」）+ 删除保存长图；仅 assembleDebug，门禁未跑（累计改动同 011DD835 的 74 项基线） | —（未实跑） | 装机 Success（用户指示免验，未做场景目视） |
| 011DD835CF111A9DB8B352E206B00A341962EC5D5722D3D8830AC54BFEF1910E | 09-24 | 试用反馈轮：通知栏/展开页上一首下一首 + 顶栏只读胶囊（去复制图标/房主）+ 口令隐 :3000 + 移除歌单搜索 | 74 | 部分实测通过、其余按指示关闭（见 [feedback-round](test-results/2026-09-24-feedback-round/README.md)） |
| 6C231394C9BD14D50CFE61D08F1513403AB32184C7E1C4CBDB836BFC192A76AC | 09-24 | UI 重构轮：入口单卡片表单 + mini 播放器常驻/ModalBottomSheet 展开 + 成员头像堆叠 + 房间码胶囊复制 + 当前曲动效条 | 73 | 真机验收通过（10 项场景，见 [ui-refresh](test-results/2026-09-24-ui-refresh/README.md)；多人堆叠/跨生命周期 seek 兜底/暗色抽查标注未覆盖） |
| B4833B95AAA278E8AFA946AB2D78786572A95A35A3622C8E704102B8FFB59431 | 09-24 | 紧凑 UI + 进度隔离/歌单缓存 + PNG 长图导出 | 73 | 已被 6C231394 覆盖（同批能力真机通过） |
| 2CBA59132F8103C9AB450CA627A61A1A2AC95F6708E7C55422E73111AB427E73 | 09-24 | 批次 2 成员可视化（主题色板头像+状态点）+ 歌单搜索（PlaylistFilter） | 70 | 真机验收通过（批次 1+2 全场景，2026-09-24 下午） |
| BF393FB4801BF907E390A6694E3FE56D9BE54A326E7E0E9176F9141738D5A967 | 09-24 | 批次 1 邀请口令闭环（InviteCode + 粘贴邀请/确认卡/智能识别 + 顶栏口令化） | 61 | 已被上锚覆盖（场景经 2CBA5913 重验通过） |
| E814F90E1982936947218EA8917745B889A1430287F490A8E0FF5CB55B425FA7 | 09-24 | A-01 代次守卫 + E-07 seek 确认 + Q-1 诊断测试 | 53 | A-01/E-07 经 M3-LONG 与 2CBA5913 两轮真机验证通过 |
| 36BD3A5B3ACA74EE45CCEE952F6EB8C042BB0A18D40123601398ADF626DD0CCE | 09-23 | 分级纠正+SmoothRenderers+进度条圆点 | 45 | W1 验收+W2 公网 E2E 通过 |
| 169018AE746164D274E9C843AC8985A1DD27B647D6BF28DFA05110B705FB6845 | 09-23 | UI 评审优化 12 项 | 42 | UI 优化真机验证通过（后被覆盖） |
| 59773A08ACB9A4FBFF815C8FEDF3680B55FC7FA4EDA992FC6DC664EFB7119EED | 09-23 | 简洁 UI 重构 | 42 | 无线本地 reverse 目视通过 |
| BE545EEFE1C3260A8F4E00C88D8C4C14A62F1A442E7D717978107E79B4E60924 | 09-22 | 图标去紫→Google 蓝 | 36 | 装机 Success（桌面目视未做） |
| 5DA5082AA630A10AE324172FFA4B46F9D073A2AB4BDD07F6082EEA4C67D9119F | 09-22 | UI 交互修补 4 项 | 36 | 未真机目视（并入后续批次） |
| 832FB65EA4B606EB1C3EBFCE0EEAA887C585097D30219C1B11ED3884F907D09B | 09-22 | 校时不覆盖暂停提示 | 26 | 401 横幅复验通过（5/5） |
| 8CF98CE13507090BC45746B8E1F766CB87839B8B1EE57728E91096F15795BACA | 09-22 | M3 焦点+localPause 边沿诊断 | 25 | M3-AUTH 真机 401 首验通过 |
| 74BB193C670A9DB0F73FE8F2B5E7BCCFD62ECFD77DB07F7833E02FF541F5BBAF | 09-22 | 播放失败分类 | 25 | 蓝牙/404 恢复真机 |
| D30EE0EE455C6F16102592896EF11236F74907416A8E6A4546A9AE0D877940FB | 09-22 | 通知栏/息屏 | — | 通知栏点击+息屏真机 |
| 9AD0BD1DBEF839D6966AF5F0DF5DD47F3CF0EC16A454D772ED7C75E039DB2B22 | 09-21 | 界面重构 | — | 播放/暂停回归 |
| 139EC36C38A729351833DE01526B9904A2D5483E7E93F44826CE8628D059D839 | 09-21 | M1 会话加固 | 21 | M1 真机复测 |
| 228BB0B0A1CA2B169523D51FA14A477625F3E938A60E9FA99929B5004BB62939 | 09-21 | 上一轮基线 | — | — |

> 0.3.0 批次 A 的 hash 演进：**2D73A208**（95 项，自查中间稿）→ **466C7B72**（97 项，自查中间稿）→ **F5827821**（100 项，独立复核稿）→ **D882D186**（100 项 + 真机修复，**唯一装机并通过真机验收的交付锚**）。中间稿均未装机、无验收记录，保留在此仅用于回溯"哪一版引入的问题"。
>
> 09-25 夜轮的 hash 演进：**E984FF40 / A201AE4A**（夜轮实现会话登记，未跑门禁）→ **9C480583 / 08607981**（补门禁与 Lint 修复，**已装机并做真机验收**）→ **BCF3DE16 / 9E17F291**（删除播放状态文案后的终稿，未装机）。

## 尚待真机与云端验收
- [x] **相机实时扫新入口回归：已关闭（09-27 下午）**：用户实际对准屏幕并确认识别，设备随后进入同一云端房间；已有相机权限，首次授权分支未重测。见 [本轮记录](test-results/2026-09-27-cloud-device-followup/README.md)。
- [x] **首页与扫码交互调整：已关闭**（09-27 白天）：删首页标语、扫码入口移右上角、邀请二维码弹窗改匀称均真机目视通过；**相册选图扫码经用户实测成功入房**。见 [本轮记录](test-results/2026-09-27-home-scan-ux/README.md)。
- [x] **元数据第二轮设备门槛：已关闭**（09-27 凌晨，debug `7C503FDD…` 装机 PHQ110，本地后端 + 本地真实曲库）：歌词渲染/逐行跟随（5 次采样对齐）/手动翻看暂停跟随/松手自动恢复/「回到当前歌词」按钮出现/切歌重载/无时间轴占位/无歌词占位/文件恢复后正常渲染、占位封面三处目视、播放跟听链路与自动切歌——全部实测通过；**期间发现并修复歌词状态缺陷**（404 卡「加载中」）。未覆盖：「回到当前歌词」未在 sheet 内完成干净点击、歌词快滑、2 倍字号、小屏。见 [本轮记录](test-results/2026-09-27-metadata-r2-device/README.md)。
- [x] **设备端云端歌词冒烟：已关闭（09-27 下午）**：冷缓存重新下载与云端哈希一致，渲染、跟随、切歌、无时间轴占位通过；期间修复暂停歌曲翻页后不归位。最终交互为无按钮、停止滚动三秒自动回位，见 [本轮记录](test-results/2026-09-27-cloud-device-followup/README.md)。
- [x] **元数据第二轮云端门槛：已关闭**（09-27 白天）：新后端 + 23 个 `.lrc` + catalog `lyrics` 引用已部署（release 20260927-1226），基线 14/14、歌词专项全过（catalog 7 字段、`hasLyrics` 23/23、歌词 200/404/401 三档、无路径泄漏）。见 [后端上云记录](test-results/2026-09-27-cloud-deploy-lyrics/README.md)。
- [ ] **封面云端发布与真机图片目视**：本地管理器上传/替换/移除已完成并通过临时曲库 smoke；待选择云端窗口后把 `media/covers/` 与带 `cover` 字段的 catalog 发布、重启并在手机歌单/MiniPlayer/展开页确认真实图片。
- [ ] **曲库删除的两项补验**：①本机删除的**截图证据**缺失（自动化视口不可用，只有可访问性快照 + 盘上文件核对），"删到空库后的界面观感"未目视；②**云端下架一首歌没有工具也没有实测流程**（见部署手册 6.3），真要下架前先实测一遍再登记。
- [ ] **元数据第二轮云端门槛（已关闭，见上）** 遗留可选项：云端 catalog 补 `artist`（当前无该字段，安卓显示为空不占行高）——需要时用 `scripts/build-cloud-catalog.mjs` 去掉 `--no-artist` 重新生成、重传并 restart。- [ ] 元数据第三轮未开工（专辑字段、通知栏歌手、`lyricsVer` 缓存失效——`.lrc` 被替换后本机按 id 缓存不感知）。
- [x] EC5FCF0A/517A776B 代码基真机回归：**已关闭**——同一代码基随 debug `517A776B…` 装机（09-26 傍晚复测通过：邀请入口/扫码、seek 三场景无假横幅、播放 1.0x 前进），见 [设备复测记录](test-results/2026-09-26-device-retest/README.md)；唯**倍速追赶后实际复位**未做专项注入测量（省电场景难复现，保持挂起项，随弱网注入补测）。
- [x] 09-26 房主清扫与 connect 补位修复：**已上云**（release 20260926-1822，专项验证 HostA 掉线被清扫 → MemberB 加入即接任；设备端对新后端入房冒烟未做，见 [云端部署记录](test-results/2026-09-26-cloud-deploy/README.md)）。
- [x] 09-26 界面提示精简（BCF3DE16 代码基）：**已装机并目视**——同一精简界面随 `517A776B…` 于 09-26 傍晚装机，复测含展开页与房间页截图（MiniPlayer 只剩歌名、状态仅由横幅/图标承载）；BCF3DE16 单包不再单独目视。
- [x] **`InviteCode.HINT` 文案失真**：09-26 按本轮遗留修复请求改为「打开 App 扫描邀请二维码，或手动输入房间码加入」，旧口令仍兼容；新包未装机。
- [x] 09-25 夜轮真机验收（在机 `9C480583…` + benchmark `08607981…`，PHQ110 / Android 14 / 云端）：预填不静默入房、`rememberSaveable` 跨重建存活、Expired 横幅「重新加入房间」换发新令牌、房间回收后的表单内联错误、邀请二维码反解（四行、无 `:3000`、无令牌）、benchmark 放行 HTTP 并播放成功；**歌单滑动帧耗时同条件 A/B：R8 0.77%/0.16% vs debug 7.66%/2.08%**——上一轮 27.27%/13.38% 属 debug 口径，不代表用户构建。见 [night-acceptance](test-results/2026-09-25-night-acceptance/README.md)。
- [ ] 剩余设备补测：**双人同屏与成员展开 180dp 滚动**（不能用同机两包替代双机）、空歌单、2 倍系统字号、小屏布局、emoji/代理对昵称真机目视、歌单滚动中切歌不抢滚动、人工手感。相机扫码已于 09-27 下午关闭；歌词快滑/滑动后切歌已自动化覆盖，人工手感仍待确认；歌词返回按钮点击项随按钮删除作废。
- [ ] 09-25 晚歌单精简版（80CF7629…）：已装机并确认固定标题、独立滚动和成员展开；当时记的滚动掉帧（连续 27.27%、带停顿 13.38%）已由夜轮 A/B 澄清为 debug 口径，R8 实测 1% 量级；剩余待补项并入上一条。
- [x] 手机实际创建房间、选歌、播放、暂停、拖动进度；用户确认有声音。
- [x] 断线重连状态机：服务器死亡→退避重连→404 过期→退出重新入房（2026-09-21 真机故障注入）。
- [x] 受控断线恢复与延迟注入：12 秒断线自动恢复、300ms 延迟校时稳定（2026-09-21）。
- [ ] 两台安卓手机同时听歌并测量同步误差，不能把 WebSocket 测试当作实际音频同步验证（M2，缺第二台手机挂起）。
- [x] 后台与短暂息屏继续播放，系统媒体会话暂停控制。
- [x] 通知栏按钮实际点击（2026-09-22 真机）。
- [x] 耳机拔出等价路径：蓝牙断开触发本机暂停、重连不自动恢复（2026-09-22）。
- [x] 音频错误重试：404→暂停→恢复文件后手动重试续播（2026-09-22）。
- [x] M3-FOCUS：其他媒体持久抢占与真实来电中断（2026-09-22）；去电、拒接、VoIP 抢占未测。
- [x] M3-LONG：60 分钟连续播放 + 至少 30 分钟息屏——**已完成**（2026-09-24，真实音乐顺播 70 分钟 + 息屏 30 分钟整 + 多人动态进出同时进行，见 [test-results/2026-09-24-long-multiplayer](test-results/2026-09-24-long-multiplayer/README.md)；"非房主切歌被拒/成员本地暂停互不影响"两项未覆盖，见该记录边界节）。
- [x] M3-AUTH：注入 401 真机路径 + 横幅持久性复验均通过；真实令牌作废场景无入口，保持标注。
- [x] LOAD-15：本地 600s 通过（2.873Mbps）；云端公网重测通过（2.847Mbps=99.1%，2026-09-23 晚）；throughput 模型未在云端执行（流量预算取舍，如实标注）。
- [ ] 成员端本地暂停不影响其他人、房主转移、中途加入——**大部分达成**（2026-09-24 长时+多人轮：房主转移 ✅、中途加入 ✅、成员本地暂停互不影响未覆盖——参与者中途全部离场，见 [test-results/2026-09-24-long-multiplayer](test-results/2026-09-24-long-multiplayer/README.md)；M2 精度验收仍需可接 adb 的第二台手机）。
- [x] 云端首次部署 + 13 项服务端验证 + SSH 隧道联调（2026-09-22）。
- [x] 公网验证：真机经 `http://8.166.126.136:3000` 完成建房→播放全链路（2026-09-23 晚，APK 36BD3A5B…）。**部分覆盖**：仅 Wi-Fi 出口；蜂窝未测（无线调试依赖 Wi-Fi，切蜂窝断 adb，需 USB 或第二台手机补）。
- [x] W1 卡顿修复真机验收（2026-09-23 晚，关/开省电、自动切歌、端点像素、暗色冷启动、听感确认全过）。
- [ ] 公网弱网/丢包/抖动条件下的真机表现（未测；fault-proxy 注入此前只在本地用过）。
- [x] 版本回滚演练：升级 + 真实回滚双向通过（2026-09-23 晚，13 项抽查三次各 13/0）；两次 restart 各清空一次内存房间已实证。升级失败注入未做（如实标注）。
- [x] 15 路实际音频带宽云端重测（2026-09-23 晚）。**M4 四项部署门槛至此全部关闭**。
- [x] 后端防线 E-05/E-09/Q-3 上云：**已完成**（2026-09-24 上午，release 20260924-0937，14 项验证 + 新防线专项验证通过，见上文与本轮记录）；升级失败注入仍未做。
- [x] 批次 1 邀请口令真机闭环（2026-09-24 下午，BF393FB4→2CBA5913 重验）：复制口令→Snackbar、粘贴邀请→确认卡（房间码+地址）、确认卡加入重入同房、口令地址≠已记住地址提示、join 失败横幅「房间不存在或已过期」+ 横幅优先于确认卡且昵称保留——全过（见 [test-results/2026-09-24-ui-batch-acceptance](test-results/2026-09-24-ui-batch-acceptance/README.md)）；**智能识别、busy 禁用、系统分享面板弹出三项自动化未能模拟，标注人工验证**。
- [x] 批次 2 成员可视化 + 歌单搜索真机目视（2026-09-24 下午，2CBA5913…）：展开成员头像首字符'B'、'房主 · 在线'文字并存；搜索'192'→仅 192kbps 行、无命中占位「没有匹配的歌曲」、清除恢复全列表；选歌切换当前歌曲、播放健康（diag 速率 995ms/s=1.0x）、E-07 拖回开头回归（20794→6125ms、seek=1）——全过（见 [test-results/2026-09-24-ui-batch-acceptance](test-results/2026-09-24-ui-batch-acceptance/README.md)）；暗色主题下批次 2 头像可读性未自动验（暗色冷启动无白闪此前已验），标注人工。

- [x] 本轮紧凑 UI + 滚动 + 长图（2026-09-24）：公网 24 首曲库安装/页面/PNG 保存已通过；快滑 janky 23.79%、自然节奏 8.43%。**长图导出已于 2026-09-25 按用户指示整体删除**，播放中听感、ColorOS 原生长截屏等待验项随之作废。步骤见 [ui-scroll](test-results/2026-09-24-ui-scroll/README.md)。
- [ ] 试用反馈轮真机验收（APK 011DD835…）：**用户决定终止补验（2026-09-25）**。已实测通过：通知栏下一首/上一首/末首回绕实际切歌（Bug④ 修复成立，公网 23 首曲库）、Sheet 切歌钮、顶栏无复制图标/房主标注、无搜索框 + 云端 23 首、分享口令文本无 :3000 且系统分享面板含「复制」目标。未补验即关闭：粘贴口令→确认卡→重入同房、成员点切歌 Snackbar；「保存长图」「顶栏房间码胶囊」两场景随 2026-09-25 反馈二小轮功能删除而作废。注意：**当前工作区代码已含 011DD835 之后的新改动（未重建 APK）**。结果修订见 [feedback-round](test-results/2026-09-24-feedback-round/README.md)。（后半句已过时：09-25 已重建 C685CE0A…（装机）与 466C7B72…（本轮，未装机）。）
- [x] 0.3.0 批次 A「一起听体验轮」真机验收（APK **D882D186…**）：**2026-09-25 下午完成**（PHQ110 / Android 14 / 云端后端），6 项场景通过——①房间动态流（加入/掉线/回来/离开 + 离线 60 秒被移除不补报 + 时间线与相对时间分档，长期老化到 `14 分钟前` 仍正确）；②伪封面与展开页布局（修复半屏回归后复验）、返回键收起；③歌单跟随（屏外滚到当前曲、屏内不跳动，**曲终自动推进同样跟随**）；④头像 emoji 与偏好持久化、24 字昵称 + emoji 不触发 400；⑤触感**标人工手感**（`dumpsys vibrator_manager` 不记录 `performHapticFeedback`，见陷阱 2.12）；⑥暗色与动态取色可读。**未覆盖**：10 分钟摘要淡出（观察窗内持续播放、最新动态始终 <10 分钟，规则仅单测）、2 倍系统字号下的小屏展开页、成员数 ≥3 的 `+N` 堆叠收尾、弱网下动态到达时序。证据见 [device-batch-a](test-results/2026-09-25-device-batch-a/README.md)。

## 环境与联调速查

- 本地后端：`.\scripts\start-demo.ps1`（前台窗口）；健康检查 `http://127.0.0.1:3000/health`；后端重启清空内存房间。
- 真机 USB：`.\scripts\install-debug.ps1`（装 APK + reverse + 启动）；多设备加 `-Serial`。
- 真机无线：`.\scripts\connect-wireless.ps1 -DebugHost <IP:调试端口> -Port 3000,3001 -Install -Verify`；配对端口≠调试端口且每次轮换；连接/reverse 必须单命令块完成（陷阱 2.7/2.8）。
- 公网入口：手机直接填 `http://8.166.126.136:3000`，无需 adb。
- 云端运维：`ssh aliyun`；升级/回滚见 [deployment.md 第 5 节](deployment.md)，曲库管理见第 6 节（替换音频后必须重启，重启清房间）；**严禁在服务器跑 VS Code Remote/重负载**（陷阱 8.5）。
- 项目级检查：`.\scripts\check.ps1 -Scope all`（后端 tsc+测试、安卓单测+构建+Lint、文档链接）。安卓段自带 `cleanTestDebugUnitTest`，**单测必然本轮实跑**（不加清理任务时 Gradle 会 UP-TO-DATE 跳过，见[陷阱 5.5](development-pitfalls.md)）；判读日志看 `> Task :app:testDebugUnitTest` 不带 UP-TO-DATE。
- 动手前必读：[开发陷阱清单](development-pitfalls.md)。

## 测试记录入口（docs/test-results/）

- [2026-09-27 云端真机补验与歌词跟随修复](test-results/2026-09-27-cloud-device-followup/README.md)：相机实扫、冷缓存云端歌词、暂停歌曲翻页恢复、无按钮三秒回位；最终 `A586F93C…` 已装机，127 单测、Lint 0。

| 记录 | 内容 |
|---|---|
| [2026-09-21-m1-session-device](test-results/2026-09-21-m1-session-device/README.md) | M1 真机复测：状态机全链路、诊断 JSONL |
| [2026-09-21-m1-fault-proxy](test-results/2026-09-21-m1-fault-proxy/README.md) | M1 故障注入：延迟/断线/宽限过期 |
| [2026-09-22-m3-notification-device](test-results/2026-09-22-m3-notification-device/README.md) | 通知栏实际点击、息屏播放 |
| [2026-09-22-m3-bluetooth-audio-error](test-results/2026-09-22-m3-bluetooth-audio-error/README.md) | 蓝牙断开、音频 404 恢复 |
| [2026-09-22-m3-focus](test-results/2026-09-22-m3-focus/README.md) | 音频焦点抢占与来电中断 |
| [2026-09-22-m3-auth](test-results/2026-09-22-m3-auth/README.md) | 401 注入自测 + 真机首验 |
| [2026-09-22-m3-auth-recheck](test-results/2026-09-22-m3-auth-recheck/README.md) | 横幅持久性复验（832FB65E） |
| [2026-09-22-load15](test-results/2026-09-22-load15/README.md) | LOAD-15 本地基线 2.873Mbps |
| [2026-09-22-m4-inventory](test-results/2026-09-22-m4-inventory/README.md) | 云端只读盘点 |
| [2026-09-22-m4-first-deploy](test-results/2026-09-22-m4-first-deploy/README.md) | M4 首次部署 13/13 + 隧道 9/9 |
| [2026-09-22-m4-public-test](test-results/2026-09-22-m4-public-test/README.md) | 公网 E2E 自动化失败记录（陷阱 3.4） |
| [2026-09-23-ui-refresh](test-results/2026-09-23-ui-refresh/README.md) | 简洁 UI 交付记录 |
| [2026-09-23-ui-optimize](test-results/2026-09-23-ui-optimize/README.md) | UI 优化真机验证 |
| [2026-09-23-w1-recheck](test-results/2026-09-23-w1-recheck/README.md) | W1 卡顿修复真机验收 |
| [2026-09-23-m4-public-e2e](test-results/2026-09-23-m4-public-e2e/README.md) | W2 公网 E2E 通过 |
| [2026-09-23-m4-rollback-drill](test-results/2026-09-23-m4-rollback-drill/README.md) | W3 升级/回滚演练 |
| [2026-09-23-load15-cloud](test-results/2026-09-23-load15-cloud/README.md) | W4 云端 15 路重测 |
| [2026-09-24-ui-batch-acceptance](test-results/2026-09-24-ui-batch-acceptance/README.md) | UI 批次真机验收：批次 1 邀请口令 + 批次 2 成员可视化/歌单搜索 |
| [2026-09-24-feedback-round](test-results/2026-09-24-feedback-round/README.md) | 试用反馈轮：通知栏切歌修复 + 顶栏收拢 + 口令隐端口 + 去搜索/去云端测试音 |
| [2026-09-25-device-batch-a](test-results/2026-09-25-device-batch-a/README.md) | 0.3.0 批次 A 真机验收：房间动态流/伪封面/跟随滚动/头像 emoji/暗色（6 项通过，触感标人工，含真实缺陷修复与截图） |
| [2026-09-25-playlist-feedback](test-results/2026-09-25-playlist-feedback/README.md) | 09-25 晚歌单滚动与界面精简：固定标题/独立滚动/移除头像与动态；装机目视 + debug 包掉帧基线（27.27%/13.38%，口径限制见夜轮 A/B） |
| [2026-09-26-legacy-fixes](test-results/2026-09-26-legacy-fixes/README.md) | 遗留逐项修复：邀请提示/长码边界、房主清扫/接任、倍速复位、旧采样证据更正；23 后端 + 91 安卓 + 3 脚本测试，Lint 0；未装机/未部署 |
| [2026-09-25-night-acceptance](test-results/2026-09-25-night-acceptance/README.md) | 夜轮装机验收：门禁与 Lint 修复、两包装机回拉、6 项真机场景、二维码反解、**R8 vs debug 帧耗时同条件 A/B**、播放态显示疑点与未覆盖项清单（含 adb 环境限制） |
| [2026-09-26-device-retest](test-results/2026-09-26-device-retest/README.md) | 设备复测：`517A776B` 装机回拉（截断陷阱）、云端真实曲库 seek 三场景回归、过期重入闭环（成员+房主）、二维码反解 + 人工扫码、`member-sim` 进出、24 码元昵称边界、热点约束与断网手段修正 |
| [2026-09-26-cloud-deploy](test-results/2026-09-26-cloud-deploy/README.md) | 后端上云 release 20260926-1822：42/42 校验、旧/新版本 14/14 自检、房主清扫→首个上线成员接任专项验证、prev 回滚点保留 |
| [2026-09-27-metadata-sources](test-results/2026-09-27-metadata-sources/README.md) | 元数据三源并入可视化管理器 + **曲库删除**（闸门先行 / 回收目录 / 三类文件引用计数）；离线单测 31/31 + 可复跑离线驱动 77/77（8 组）+ 浏览器实跑 |

历史过程记录：[2026-09-21 播放测试](archive/playback-test-2026-09-21.md)（操作过程、状态采样与问题处理，已归档）；W1/W2 交接单 [handover-2026-09-23](archive/handover-2026-09-23.md)（卡顿根因完整分析，已归档）。
