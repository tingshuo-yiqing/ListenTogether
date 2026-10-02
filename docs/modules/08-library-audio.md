# 08 曲库与音频传输

2026-10-02 发布：album 第9字段已在云端 v2 生效；管理器当前 Hi 默认/三视图/导入/回收能力已发布，FFmpeg8.0.1可用。45 首 media 的全部字节、属主/组/权限未改，不是曲库数据维护。证据：[发布](../test-results/2026-10-02-v2-cloud-release/README.md)。

## 专辑与删除补验（2026-10-02）

loadCatalog 读取 album：非空手填 trim 后优先；否则 ID3 common.album trim 后兜底；未知 null，与 artist 同一次 parseFile。公开 toSummary 第九字段 album，catalog/search/当前曲一致，revision 随值变化；真实 TALB 标签与应用响应两项测试通过。

Chrome 真界面删除/取消/删空/回收恢复 8/8，桌面与窄屏空库截图已目视；修复无歌时仍提示“从左侧选择”，改为新增/恢复指引。后端删前缓存必须重启才重载，空库可健康启动；恢复音频/封面/歌词 SHA256 与 Range 206 一致。WSL 原生 Linux 共享三类文件最后引用回收与恢复 3/3。

云端已有 SSH 隧道管理器，部署 6.3 已整理下架维护流程；本轮只操作合成夹具，未删真实曲或重启云端。server 74/74、脚本 51/51；[报告](../test-results/2026-10-02-desktop-tasks/README.md)。

## 职责与入口
library/catalog.ts启动时读取catalog.json，校验曲目，解析真实MP3时长与ID3歌手/专辑/内嵌封面，构建只读Track列表；catalog 的独立封面优先于 ID3。
library/catalog-index.ts（2026-09-30 QC-A）在 Track 列表之上构建 CatalogIndex：tracksById 按 ID O(1) 查找、规范化(NFKC+小写+合并空白)稳定排序（歌名→歌手→id）、内容 revision（公开编目 sha256 前 16 位，含 coverVer/lyricsVer/album，同内容恒定）、search() 分页检索（q≤100 码点、offset 非负、limit 1–50，非法 SearchError 400）。千首内存夹具与检索单测见 server/test/catalog-index.test.ts。
routes/audio.ts根据曲目ID找到文件，验证房间成员令牌后提供HTTP音频流。
routes/cover.ts、routes/lyrics.ts分别下发封面字节与LRC文本，鉴权与错误语义与音频路由同一套模板。
media为手动曲库；demo-media为独立合成测试曲库。开发脚本通过MEDIA_DIR切换，不覆盖个人音乐。

## 数据与现有边界
清单条目为id/title/file，可选artist/album（非空手填歌手/专辑，优先于ID3）、cover（库内相对路径的JPG/PNG/WebP）与lyrics（库内相对路径的.lrc）；
服务器内部Track另含durationMs/path/size/artist/album/cover/coverVer/lyricsPath/lyricsVer。
公开曲库只返回id/title/durationMs/artist/hasCover/coverVer/hasLyrics/lyricsVer/album，绝不返回磁盘路径与二进制。
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

## Hi歌曲优先与管理体验（2026-09-28）
默认来源改为 `higequ`：`scripts/lib/higequ.mjs` 只读同站搜索/详情HTML，标题/歌手须精确归一一致，版本文字保留；公开页面不含的年份/流派/时长不猜测。符合阈值才取详情，歌词按data-time秒转LRC、校验时间顺序与本地时长上界。Hi缺失/失败时按QQ→网易云→MusicBrainz回退；选定某个旧源则不自动换源。Hi歌词优先、LRCLIB补充。Hi成功详情缓存一天，缓存键含本地画像，详情部分失败不缓存。
图片仅增加实际观察到的 `img数字.kuwo.cn` HTTPS图床，继续应用字节上限、魔数校验和候选票据；不请求音频。每个候选返回实际来源及尝试结果供界面展示。

页面新增专辑检索、分类缺项筛选、排序、批量范围/停止/失败重试与来源页面链接；单曲新旧值与歌词预览复用现有流程。
回收恢复由 `scripts/lib/media-trash.mjs` 实现，`GET /api/trash` 返回未恢复记录，`POST /api/trash/restore` 接受run/key（清单行摘要），同进程请求串行。先验整库、复制回收文件（不覆盖目标）、再写库校验；失败撤销本轮副本，回收原件保留。原ID/同名文件冲突与路径/符号链接越界拒绝；坏批次独立报错。
本轮47/47脚本单测、85/85既有驱动、Chrome交互通过；真实站点抽查与未部署边界见[验收记录](../test-results/2026-09-28-higequ-manager/README.md)。

2026-09-29：新增 GET /api/tracks/:id/lyrics 预览 catalog 已保存的本地歌词，realpath 限曲库内 .lrc/256KB；缺歌词或丢文件 404，非法文件 422。编辑页「预览当前歌词」按纯文本显示，切歌和刷新使用请求序号隔离。Hi来源问题确认是旧 Node 进程未重启，本机服务现已更新；云端未同步。

## Hi歌曲音频下载（2026-09-29，用户决策：单曲手动、仅开发测试、非商用）

`scripts/lib/higequ.mjs` 新增 `parseHiAudio`：player 页以服务端渲染的 `let code="<base64>"` 携带音频直链（实测酷我 CDN、免签名免 Referer），解码后必须过 `allowedAudioUrl` 白名单（`*.kuwo.cn` 族，https/443/无凭证）才是可用地址。管理器新增 `POST /api/tracks/:id/higequ-audio`：复用 `syncTrack` 的 higequ 身份校验（`metadataAccepted`，拒同名翻唱/现场版）→ 取 player 页 → 直链 → `fetchLimited` 按 `AUDIO_LIMIT`（64MB）下载 → MP3 魔数校验 → 新文件 `audio/<id>-<uuid>.mp3` + catalog 指针换新（`writeAndValidate` 闸门，失败撤文件），**旧音频原地保留**（删除轮的引用计数继续管它）。不限速：无批量入口，逐首手动点击（编辑页「⬇ Hi音频」）。serviceVersion 升 `20260929-hi-audio`；云端管理器未包含。设计稿「不下载音频」红线按用户决策修订（见设计稿非目标节的修订注记）。

## Hi整首替换与搜索导入（2026-09-29 第二轮，按用户指令重构）

同日用户指令「替换直接替换不用保存，连名字都直接替换；增加直接在 Hi 上搜索爬取的接口；重构上传新歌面板」：

- **`POST /api/tracks/:id/higequ-replace`（替代原 /higequ-audio，后者不复存在）**：一次动作整首替换——音频（指针换新）+ 标题/歌手按 Hi 候选**连名覆盖** + 专辑（非空才覆盖）+ 歌词（新 .lrc 指针）+ 封面（新图指针）；**不要求表单先保存**（未保存编辑被服务端新值取代，即"直接替换"语义）；全部新文件走 `wx` 独占创建 + `writeAndValidate` 闸门，失败整组撤销；旧文件原地保留。UI 按钮改「⬇ 从 Hi 整首替换」并去掉 dirty 拦截。
- **`POST /api/higequ/search` + `POST /api/higequ/import`**：自由搜索（`searchHi`，模块级导出，无 1 秒间隔/无缓存，挑哪条由人定）→ 导入整首新歌（`parseHiDetail` 新增 `verifyIdentity:false` 与 title/artist 回传——导入以页面为准；新 ID 默认 `hi-<rid>` 可自定义，重复 409、坏 rid 400；无直链 404、白名单外 404、非 MP3 422，均不动库）。音频/信息/歌词/封面一次到位。
- **新增面板重构**：「上传新歌曲」改为「新增歌曲（Hi 搜索导入 / 手动上传）」——Hi 搜索结果行内一键导入（textContent 渲染，外部文本不可信），手动上传收进内层折叠保留（自有文件走这里）。
- 门禁：脚本离线 **51/51**（替换测试迁移并加歌词/封面/字段覆盖断言、导入闭环 1 组：搜索→导入→文件/指针/重复 409/坏 rid 400/无直链 404）、驱动 85/85；真网验证《富士山下》整首替换 200（7.2s：音频 4.0MB 换新、专辑补全 What's Going On...?、歌词/封面新指针、旧 6.2MB 保留）与搜索导入 200（4.4s，4.0MB+歌词+封面）。
- 本轮新坑：写歌词/封面文件前必须 mkdir（夹具无预建目录时 wx 直接 ENOENT）；`fetchLimited` 返回 Buffer，进 HTML 解析前必须 `.toString('utf8')`；离线 mock 已知约束同陷阱 10.5。

2026-09-29：按用户指令恢复低置信度文字候选的手动应用。单曲 score < minScore 时只提示核对，不默认勾选，但可手动选择艺术家/专辑/年份/流派并应用；批量仍仅消费达标的 changes。资源未匹配到时不伪造封面或歌词候选。Chrome 实测 0.6 < 0.8 候选默认未选、可勾选并提交五月天；85/85接口回归通过。HTML按请求读取，刷新页面即生效，未改真实曲库。

## 导入拼音命名与真实曲库批量替换（2026-09-29 第二轮）

- **拼音 ID**：依赖 `pinyin-pro`（根 package.json，MIT）；管理器 `pinyinId()` 把歌名转无声调拼音 slug（非中文按原文、64 位截断、全空回退 `hi-<rid>`）；`/api/higequ/import` 默认 ID 即拼音，重名自动 `-2/-3` 后缀，`body.id` 显式指定时重复仍 409。
- **批量替换**：管理器没有批量端点（刻意——逐首手动）；本轮按用户指令以脚本对真实曲库逐首调 `/higequ-replace`。跳过判据 = 文件已呈 `audio/<id>-<uuid>.mp3`（Hi 形式）或刚导入；结果 8 首成功、11 首因站点交付 `.aac`（非 MP3）按边界跳过。
- **命名规范**：catalog 三路径字段必须 `<dir>/<id>.<ext>` 或 `<dir>/<id>-<uuid>.<ext>`、正斜杠、文件存在；检查脚本按条目 ID 前缀核对（本轮修正：改名脚本 `path.join` 写入 Windows 反斜杠 3 处，已归一——**catalog 路径一律正斜杠**，否则同步上云到 Linux 会坏）。

## .aac 转码收编（2026-09-29 第三轮）

批量替换发现 11 首（句号/爱错/倔强/囚鸟/特别的人/爱情转移/背对背拥抱/淘汰/当你/天后/遇见）站点交付 **.aac**（如 kw-bj.kuwo.cn/.../*.aac），按用户决策「开始做吧」补上转码能力：`parseHiAudio` 放行 `.mp3/.aac/.m4a`（白名单不变）；管理器 `transcodeToMp3`——非 MP3 魔数的下载字节经 **ffmpeg libmp3lame 192k** 本地转码（180s 超时，临时文件即用即删，产物过魔数+长度校验），`/higequ-replace` 与 `/api/higequ/import` 共用；ffmpeg 缺失/转码失败回 422 带原因。serviceVersion 升 `20260929-hi-aac`。门禁 51/51（新增真 aac 夹具 e2e：ffmpeg 合成 1s 正弦 → 替换 → loadCatalog 时长校验过）；**真实曲库 22/22 全部替换为 Hi 形式**（11 首 aac 转码 5–8s/首），命名合规复检通过。转码只在导入/替换的下载环节发生，播放链路照旧只读 MP3。

## 管理页面：视图拆分与列表节点缓存（2026-09-29）

只改 `metadata-manager.html`（含页面自带 JS/CSS），`metadata-manager.mjs` 零改动——它只把 HTML 当文件原样吐出（`HTML_PATH`）、不碰 DOM，其余全是 JSON API，所以页面可重构而服务端不动。

- **三视图互斥**：`浏览曲库 / 批量匹配 / 新增歌曲`，由 `body[data-view]` 驱动 CSS 显隐、当前 tab 以 `aria-selected` 高亮。「新增歌曲」与「批量匹配」原是编辑面板下方的两个 `<details>` 折叠层，现已搬为独立视图（`#batch-details` 不再存在；`btn-batch` 这个 id 保留在 tab 上，页面驱动不受影响）。切视图不碰数据：切走再切回，选中曲目、编辑区内容、列表顺序都保持。进批量视图即提示缺字段数量。
- **列表行节点缓存**（`rowCache`）：行按 id 建一次，筛选/排序/多选/删除只改类名、勾选状态与节点顺序（`appendChild` 对已有节点是移动，兼作排序）。原实现每次 `input` 都整表 `innerHTML=''` 重建。失效节点随曲库变化回收，被筛掉的行从面板摘下但留在缓存。
- **内联样式**：24 处收掉 22 处为语义类；`#editor` 与 `#cover-img` 的 `display:none` **故意保留内联**，它们由 JS 的 `style.display` 切换，挪进类会与 JS 抢同一属性。
- **版本告警误报修复**：页面原以严格相等比对硬编码的期望版本，服务端 09-29 升到 `20260929-hi-aac` 后，"服务端更新"被判成"旧版本"并常驻误导性横幅。改为比下界常量 `PAGE_SERVICE_VERSION`（日期串直接比大小），服务端不比页面旧即兼容。
- 门禁：脚本离线 **51/51**；新增页面驱动 [2026-09-29 manager-ui](../test-results/2026-09-29-manager-ui/README.md)（视图互斥、切视图不动数据、节点复用与空态、多选联动、删除后缓存清理、1280px+390px、无未捕获异常），09-28 两份驱动回归通过。函数拆分（`select` 176 行 / `resourceRow` 114 行）本轮未做，等用户实际使用后单独一轮。

## 封面按需读取与解析限并发（2026-09-30 QC-D）

千首扩库前的资源边界落地（设计「千首曲库的资源边界」），catalog 不再把封面字节常驻内存。

- **`Track.cover` 改引用形态**：`{ mime, file(独立图片绝对路径|null), embedded }`。启动时仍读一次封面只为算 `coverVer`（内容哈希语义不变），字节随即丢弃；内嵌封面启动解析只记录来源/类型/版本，不保留图片。`toSummary`/catalog 下发口径不变（hasCover 布尔位）。
- **`library/cover-cache.ts`（新）**：`CoverCache` 全服 32MiB 字节 LRU（`COVER_CACHE_LIMIT_BYTES`，按字节计费，Map 序即 LRU 序、触碰刷新热度）；键 = `id + coverVer`（换封面 → 版本变化 → 自然换键）。读盘/内嵌 APIC 重解析经 `COVER_IO_CONCURRENCY = 4` 上限；同资源在途读取合并（inflight 表）；失败不进缓存（文件恢复后无需重启）。`stats()` 暴露字节/峰值/在途/解析并发计数供基准与测试。
- **`library/pool.ts`（新）**：`Limiter`（并发上限 + active/peak/queued 计数）与 `mapPool`；`loadCatalog` 音频解析（music-metadata + 封面/歌词读取）默认 `PARSE_CONCURRENCY = 4`，`{ stats }` 参数上报解析峰值并发——千首启动不再发起千路并发 IO。
- **路由 O(1) 化**：audio/lyrics/cover 三路由由 `tracks.find` 线性扫改 `rooms.byId.get`（播放路径 QC-B1 已切 Map）。
- 门禁：server **56/56**（新增 cover-cache.test.ts：同资源在途合并 + 内嵌 APIC 按需重解析；cover.test.ts 重写为引用形态夹具，补 LRU 淘汰顺序/字节峰值/缺文件 404；catalog.test.ts 补解析峰值并发 = 4 断言；rooms.test.ts /health 断言同步）。
- 基准：`scripts/qcd-bench.mjs`，2000 首合成夹具启动 1.64s、峰值 RSS 89MB、搜索 p95 0.048ms、缓存峰值 32.5MB → 清退后稳定 31.5MB（与曲库规模无关）；明细见 [QC-D 证据](../test-results/2026-09-30-queue-chat-QC-D/README.md)。
