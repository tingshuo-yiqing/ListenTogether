# 08 曲库与音频传输

## 职责与入口
library/catalog.ts启动时读取catalog.json，校验曲目，解析真实MP3时长与ID3歌手/内嵌封面，构建只读Track列表；catalog 的独立封面优先于 ID3。
routes/audio.ts根据曲目ID找到文件，验证房间成员令牌后提供HTTP音频流。
routes/cover.ts、routes/lyrics.ts分别下发封面字节与LRC文本，鉴权与错误语义与音频路由同一套模板。
media为手动曲库；demo-media为独立合成测试曲库。开发脚本通过MEDIA_DIR切换，不覆盖个人音乐。

## 数据与现有边界
清单条目为id/title/file，可选artist（手填歌手，优先于ID3）、cover（库内相对路径的JPG/PNG/WebP）与lyrics（库内相对路径的.lrc）；
服务器内部Track另含durationMs/path/size/artist/cover/coverVer/lyricsPath。
公开曲库只返回id/title/durationMs/artist/hasCover/coverVer/hasLyrics，绝不返回磁盘路径与二进制。
realpath解析后检查路径仍在曲库根目录，扩展名MP3，文件存在且可获得正时长；
歌词引用同样realpath+前缀校验，必须.lrc且≤256KB，坏引用启动即失败（延续"路径不来自HTTP"边界）。
更新曲库需重启，当前房间随服务重启丢失；不承诺热更新。
封面图片最多1MB，realpath后必须仍在曲库根目录内；独立封面优先，未配置时回退到MP3内嵌ID3封面，格式统一识别为JPG/PNG/WebP。
coverVer由图片内容哈希和文件时间生成；替换图片后客户端缓存键变化。没有封面时hasCover=false、coverVer=null，客户端显示统一占位。

## 音频传输流程
鉴权 → 查track → stat文件 → 解析Range → 设置audio/mpeg及长度 → createReadStream。
无Range返回200；单范围返回206，非法或不可满足范围416并附bytes */size。
支持bytes=start-end、bytes=start-、bytes=-length；end为包含端点，长度=end-start+1。
响应private/no-store；请求URL不放令牌，鉴权由请求头完成。
歌词响应text/plain; charset=utf-8、private/no-store，整读返回（≤256KB不做Range）；无歌词404「该歌曲没有歌词」，
引用文件已被删除404「歌词文件缺失，请联系管理员」而非500。

## 本地管理工具（已落地，只监听 127.0.0.1:3100）
`scripts/metadata-manager.mjs` + `metadata-manager.html` 是曲库元数据的唯一管理入口：手工编辑（title/artist/album/genre/year/lyrics）、音频上传、封面上传/替换/移除、联网匹配候选后勾选落库、**删除曲目（单曲 + 批量）**。服务端仍只读下发，不提供公网管理写接口。
图片由管理页面在浏览器中缩放到最长边1024px并压到1MB以内；服务端再按文件头校验格式。每次写编目都调用 `dist/library/catalog.js` 的 `loadCatalog` 整库校验，失败回滚（干净克隆后需先 `cd server && npm run build`，缺失时工具直接给出该指引）。
匹配候选的默认勾选口径分两层：单曲「匹配这首」不带 `onlyIfEmpty`，LRCLIB 命中即把 `lyrics` 报为默认勾选（**本曲已有歌词也照报，点应用即替换**）；批量「一键补缺」在 `/sync` 与 `/apply` 都带 `onlyIfEmpty`，已有值一律不进候选，故不会整库换歌词。封面已有值时两种口径都不自动勾（换图必须人工确认）。替换是**换指针**：新文本另起 `lyrics/<id>-<uuid>.lrc`，catalog 改指它，旧 `.lrc` 原地保留（可能被别的曲目共用，也便于手工改回）。
删除的顺序是硬约束：**先整库自检（坏库直接 409，一个文件都不许动）→ 移除条目并过同一套写校验（失败 422 逐字节回滚）→ 才把文件移进回收目录**（`--trash`，默认 `.workbuddy/media-trash/<批次>/<库内相对路径>`，每批一份 `manifest.jsonl` 记录条目原文与每个文件的来去，可手工放回，绝不 `unlink`）。音频/独立封面/歌词**三类都按引用计数**决定归属：只有独占文件随曲目进回收目录，被别的曲目共用的留在原地并点名"谁还在引用"；`covers/` 之外的封面路径只删条目不动文件（工具只回收自己放进去的）。
容量优化先测带宽和实际文件码率，再考虑对象存储。

## 下一阶段
明确校验id和title必须为字符串，去除隐式类型转换；拒绝空文件名、重复ID和损坏MP3。
补充路径穿越、符号链接、文件变更/删除、客户端中断下载、并发Range的测试。
明确管理规则：播放期间不覆盖文件；检测到文件与启动元数据不一致时返回可解释错误并要求管理员重载。
连接关闭必须释放文件流，避免15路反复拖动后文件句柄增长。
歌词版本化（lyricsVer）已于 2026-09-28 落地：`loadCatalog` 启动时对每个 `.lrc` 算内容哈希+mtime 版本，catalog 下发第 8 字段 `lyricsVer`（无歌词为 null）；安卓 `LrcCache` 缓存键 = id + lyricsVer，换词后旧缓存自然失配重新下载（服务端 `server/src/library/catalog.ts`，安卓 `LrcCache.kt`/`Models.kt`）。
元数据联网匹配已并入上述管理器，原命令行同步器 `scripts/fetch-metadata.mjs` **已于 2026-09-27 删除、文件不存在**：抓取/打分/缓存的唯一实现是 `scripts/lib/metadata-sources.mjs`（QQ 音乐 / 网易云 / MusicBrainz 三源，共用一套阈值与 `buildChanges` 落库白名单）。候选只读、勾选后才写库，低置信度结果必须人工复核；出网只取搜索文本与封面地址，不下载音频、不带登录 Cookie。

## 异常与验收
空曲库可启动和入房，页面显示上传说明；格式错误/坏文件使启动失败并指出相关曲目ID。
运行期间文件缺失返回404；APP保持本地暂停并显示错误，不无限prepare。
Range全量、前段、后缀、末尾、非法组合、空文件/超范围和音频权限分别测试。
歌词目录在loadCatalog测试钉住：../逃逸/外部绝对路径/非.lrc/文件缺失/超256KB全部拒绝，正常引用解析为库内绝对路径。
删除曲目在离线驱动第 [8] 组钉住：坏参数 400/404、坏库 409 且 catalog 逐字节不变且不建空批次目录、三类共享各自留文件并说明引用者、最后一份引用消失才随曲目进回收目录、manifest 内容与批次目录归属、删到空库管理器继续服务。
15路音频真实读取必须校验收到的字节和持续吞吐；15个空闲WS连接不算音频负载。

## 核心注释与记录
loadCatalog说明路径信任边界、时长为什么来自MP3；Range说明闭区间、后缀范围和416；流说明取消与错误传播。
2026-09-21：已有基础解析与Range实现。
2026-09-26：第一轮Track扩展artist/cover/coverVer；第二轮同日加lyricsPath与/lyrics/:id路由、catalog歌词引用校验、
media-manage.sh新增lyrics子命令与verify歌手/封面/歌词列；封面暂时回退统一静态占位。
2026-09-27：本机真实曲库端到端验证歌词路由三档语义（200 正文/占位、404 无歌词与引用缺失、401 无令牌）与
catalog 七字段下发；真机验收暴露的客户端缺陷在 UI 侧修复（见模块01与陷阱4.8），服务端未改。
新增 scripts/build-local-catalog.mjs：把云端 catalog 落成本地可跑曲库（文件名映射为 <id>.mp3 + 挂 lyrics 引用，
缺音频文件即失败不产出半成品 catalog），用于不触碰公网的本地真机验收环境。
2026-09-27：封面限制解除。catalog支持独立cover文件，服务端恢复ID3回退与/cover字节下发；metadata-manager.html 增加
浏览器压缩后的封面上传/替换/移除，写入失败沿用整库校验与回滚。安卓现有coverVer缓存骨架直接生效。
2026-09-27：元数据抓取并入管理器并扩为三源（QQ 音乐/网易云/MusicBrainz，共享模块 `scripts/lib/metadata-sources.mjs`，
同名打分与阈值；国内平台按结果名次折算相关度）；新增 `GET /api/sources`、`POST /api/tracks/:id/sync`（缓存键含源名，
出网失败按单首 502 以便批量继续）、`POST /api/tracks/:id/apply`（候选值先验类型，`onlyIfEmpty` 写前再挡一层覆盖）；
命令行同步器 fetch-metadata.mjs 删除。限速：MusicBrainz 约 1.1 秒/请求、QQ 与网易云约 0.8 秒/请求，各自独立队列。
缓存键含源名（`源|曲目标识`），且候选与封面地址在返回前按**当次请求的阈值**再判一次——缓存存的是判定结果，判定参数随请求变。
缓存路径可用 `--cache` 挪到临时文件，验证驱动据此保证夹具运行永不污染真实缓存。
2026-09-27（晚）：media 目录重构为分区布局 audio/（<id>.mp3）+ lyrics/ + covers/，catalog 的 file 字段带
audio/ 前缀（loadCatalog 的 realpath 防逃逸本就允许子目录，云端布局不受影响；add-media.ps1 与
build-cloud-catalog.mjs 不依赖本地平铺布局，无需改动）。新增 scripts/fetch-covers.mjs 批量封面抓取：
复用 lib 共享匹配层与可视化管理器同一份缓存，阈值（默认 0.8）以下的候选一律不落封面，图片校验魔数与
≤1MB（与 loadCatalog 同口径），catalog 原子写+整库校验失败即回滚并清理新落图片；实测 23 首中 19 首达标
落图（QQ 源 800x800），4 首低于阈值留人工（单车/倔强/爱情转移/红日）。ID3 读取抽为 lib readId3Tags
（parseFile 注入，lib 保持零依赖可离线单测，31/31）。歌词：te-bie-de-ren 重抓去损坏、he-bu-ke 补坏字，
单车/红日 lrclib 无 synced 源维持占位待人工替换；用户决定繁简转换不做、后续手动换文件。
2026-09-27（深夜）：新增**删除曲目**闭环（按用户指令"这个脚本上没有删除音乐的功能"）。`DELETE /api/tracks/:id`
带 `run`（回收批次名，非法即 400）与 `files=audio,cover,lyrics`（白名单外 400）；闸门先行——先 `loadCatalog` 自检，
坏库回 409「未改动任何文件」，再移除条目走 `writeAndValidate`（失败 422 逐字节回滚），最后才把**独占**文件移进
回收目录（`--trash` 可挪根，跨分区/权限受限退化为复制后删；移文件失败只进 `failed[]` 如实上报，条目删除照常成立，
绝不留下"目录有条目、文件已消失"的半途状态）。引用计数从歌词扩到三类（共用文件留原地并点名剩余引用者）。
顺带修掉两处真实缺陷：`managedCoverPath` 原先靠 `resolve(COVER_DIR) + '\\'` 拼前缀判断归属，在 POSIX 口径下永远为假
（独立封面明明在却认不出来），改用与歌词同源的 `insideDir`；封面/音频漏做引用计数。
界面新增顶栏「多选删除」勾选态与单曲删除，对话框逐首列「标题｜歌手｜id｜音频/独立封面/歌词」再按类勾选，
批量逐首独立成败、失败留在窗口可重试、整批共用一个批次名。验证：离线单测 31/31、可复跑离线驱动扩至 8 组 77 项断言
（新增第 [8] 组专测删除）、浏览器在一次性 4 首临时曲库上实跑批量/单曲/坏库三条路径。只改本机脚本与文档，
未改服务端/协议/安卓，未部署云端（云端删曲仍走 add-media.ps1 + 服务器 media-manage.sh）。

2026-09-28：审查修复上传 audio/ 引用、共享封面替换/移除、单进程请求串行与原字节回滚，拒绝外站Origin和非法回收批次；Linux夹具85/85、源单测31/31。管理器独立上云，仅回环3100，通过SSH隧道访问；云端曲库不再限于手工脚本管理。详见[发布记录](../test-results/2026-09-28-metadata-release/README.md)。运行时仍不热加载，管理器不能与其他写库进程同时操作。

2026-09-28（匹配资源）：新增scripts/lib/metadata-assets.mjs，LRCLIB歌词按歌名/歌手/时长独立匹配，失败跳过；封面/歌词候选票据绑定曲目和30分钟快照，apply直接落唯一文件名并关联，整库失败撤销新资源。批量只补空（已有歌词引用即使占位也不覆盖），内嵌封面算已有；旧文件保留用于回退。封面白名单、跳转复验、流式1MB/12秒上限，歌词256KB。云端管理器02版已部署，37/37脚本测试+85/85驱动+Chrome交互通过；[详细证据](../test-results/2026-09-28-metadata-assets/README.md)。

2026-09-28（歌词替换默认，同日追加小轮）：按用户指令把单曲匹配的歌词改成「匹配到即可替换旧歌词」。`/sync` 新增可选 `onlyIfEmpty`，界面批量两端都带上它（只补空不变），单曲不带——于是已有歌词也把 `lyrics` 报进 `changes`、界面默认勾选、应用即替换；封面维持已有值不自动勾。替换只改 catalog 指针（新文件唯一名 `wx` 创建），旧 `.lrc` 原地保留。上一轮「已有歌词要在单曲候选中主动勾选」自此只对批量成立。验证：脚本单测 37/37（真实管理器用例改写并新增替换回归）、离线驱动 85/85、Chrome UI 驱动新增四条断言实跑 PASS、真实浏览器在临时 1 首曲库走完匹配→应用并盘上核对。**云端管理器仍是 20260928-metadata-02（旧口径），未重发**；未改服务端/协议/安卓。[追加证据](../test-results/2026-09-28-metadata-assets/README.md)。
