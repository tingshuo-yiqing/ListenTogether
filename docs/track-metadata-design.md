# 歌曲元数据扩展方案（第一/二轮已落地，专辑与媒体元数据本地通过）

状态：第一/二轮已实施；2026-10-02 专辑字段与媒体元数据本地代码/自动化通过，云端与设备显示待验。落地进度与口径以 `docs/verification.md` 为准。
- 第一轮（Track 扩展 + ID3 歌手提取 + catalog 下发 + 封面接口 + 安卓封面/歌手副行）已实施；该轮按用户指示未做专辑字段与通知栏歌手；后续状态见下方 10-02 更新；
- 封面管理已补齐：catalog 支持独立 `cover` 相对路径，服务端优先读独立图片、无独立图片时回退 ID3；本地管理器支持浏览器压缩后上传、替换和移除；安卓已有 `coverVer` 缓存按图片版本刷新。
- 第二轮（`.lrc` 上架通道 + `/lyrics/:id` 接口 + 安卓 LrcParser/LrcCursor 纯函数与播放页滚动歌词）已实施；歌词来源经用户授权改为 lrclib.net 批量抓取（替代本文原"仅人工维护授权来源"约束，21/23 首命中，单车/红日无同步歌词为占位文件）；
- 元数据抓取已并入可视化管理器（2026-09-27）：`scripts/lib/metadata-sources.mjs` 提供 QQ 音乐 / 网易云 / MusicBrainz 三源匹配（共用一套打分与阈值），`scripts/metadata-manager.mjs` 界面上按曲或批量出候选、勾选后写库；原命令行同步器 `scripts/fetch-metadata.mjs` 已删除。封面仍由管理器上传落盘，歌词继续复用 `fetch-lrc.mjs`。
- 2026-10-02：专辑第 9 字段（手填/ID3/null）、安卓兼容解析和 Media3 artist/albumTitle 构造回归通过；歌手原已有 setArtist，本轮补测试。新 APK 未装机、云端 v1 未发专辑字段；编目自动生成方案未在本轮增加，见 [验收](test-results/2026-10-02-desktop-tasks/README.md)。
读完本文需要的背景：`docs/protocol.md`（当前协议与 JSON Schema 纪律）、`docs/deployment.md` 第 6 节（曲库上架）。

## 0. 目标与非目标

目标：让"歌"从 `{id, title, durationMs}` 三字段扩展为带歌手、专辑、封面、歌词的完整条目；展示更多样（封面、歌手行、同步歌词），管理更省事（元数据自动提取、编目条目可自动生成）。

非目标：
- 不改变 WS 协议与播放同步逻辑（state 消息仍只引用 `trackId`，schema 一个字段不动）。
- 不支持 MP3 以外的音频格式（`.mp3` 校验、转码管线、`audio/mpeg` 都保持现状，属另一条线）。
- 不做在线搜歌、下载源、公网管理后台 HTTP 写接口；本地管理器只监听回环地址，写编目仍需重启后端。
- 元数据联网匹配仅用于本地人工复核与按曲补字段；不抓网页、不带登录 Cookie，不能替代曲库上架或云端部署流程。
  - **2026-09-29 用户决策修订（音频下载）**：Hi歌曲的音频下载**对本地管理器开放**——单曲手动触发（管理器「⬇ Hi音频」按钮）、仅开发测试用途、非商用；实现走 `parseHiAudio`（player 页 Base64 直链）+ `allowedAudioUrl` 域名白名单（酷我 CDN 族 `*.kuwo.cn`）+ `AUDIO_LIMIT` 64MB 上限 + MP3 魔数校验 + 指针换新旧文件保留；不限速（单曲手动无批量入口）。云端管理器未包含此能力；其余来源（QQ/网易云/MusicBrainz）仍不下载音频。
- 不引入数据库；`catalog.json` 仍是曲库唯一事实来源。

## 1. 第一轮前的历史基线（2026-09-26 核对）

| 位置 | 现状 |
|---|---|
| `server/src/library/catalog.ts` | `Track = { id, title, durationMs, path, size }`；启动时对每首 MP3 调 `music-metadata` 的 `parseFile`（目前只取时长）；id/title/file 来自手写 `catalog.json` |
| `server/src/app.ts`（catalog 路由） | `GET /api/rooms/:code/catalog` 只回 `{id,title,durationMs}`；`path`/`size` 不出服务端 |
| `server/src/routes/audio.ts` | 音频下发：成员令牌鉴权 + Range 支持，404 语义齐全——封面/歌词接口照此模板写 |
| 安卓 `Models.kt` | `Track(id, title, durationMs)`，手写 JSONObject 解析 |
| 安卓 `MainActivity.kt` `PlaylistRow` | 歌单行 = 序号 + 歌名 + 时长 |
| 安卓 `RoomPlayer.kt` | MiniPlayer/PlayerSheet 只显示歌名与进度 |
| 安卓 `PlaybackService.kt` | 媒体通知 `setArtist("一起听歌")` 写死 |
| 上架脚本 | `media-manage.sh install`（manifest 两列：id、中文标题）+ `add-media.ps1`；中文只经文件内容流转 |

## 2. 扩展后的 Track 模型

服务端 `Track`（`catalog.ts`）：

```ts
export type Track = {
  id: string; title: string; durationMs: number; path: string; size: number;  // 已有
  artist: string | null;            // 新增：歌手，ID3 或手填
  album: string | null;             // 新增：专辑
  cover: { mime: string; data: Buffer } | null;  // 新增：独立文件优先、ID3 回退，启动时常驻内存
  coverVer: number | null;          // 新增：图片内容版本，客户端缓存键
  lyricsPath: string | null;        // 新增：库内 .lrc 文件绝对路径（仅服务端使用）
  lyricsVer: number | null;         // 2026-09-28：歌词内容版本（内容哈希+mtime），客户端缓存键
};
```

catalog 下发字段（当前本地固定 9 个；artist/album/coverVer/lyricsVer 未知为 null，hasCover/hasLyrics 为布尔；云端 v1 待发布仍为 8 字段）：

```json
{ "id": "song-01", "title": "歌名", "durationMs": 213000,
  "artist": "歌手", "hasCover": true, "coverVer": 502594349944105,
  "hasLyrics": false, "lyricsVer": null, "album": "专辑" }
```

`coverVer` 也一并下发（`hasCover=false` 时为 `null`）：客户端封面缓存键 = `id + coverVer`，图片替换后版本变化，缓存自然失效。`lyricsVer`（`hasLyrics=false` 时为 `null`）：客户端歌词缓存键 = `id + lyricsVer`，换词后旧缓存自然失配。`path`/`size`/`cover`/`lyricsPath` 仍不出服务端。

## 3. 数据来源与优先级

每个字段按 **catalog.json 手填 > MP3 内嵌 ID3 > null** 的兜底链取值：

| 字段 | 来源 1（手填，可选） | 来源 2（自动） | 说明 |
|---|---|---|---|
| title | `catalog.json` 必填 | — | 现状不变 |
| artist / album | `catalog.json` 可选 `artist` / `album` | `parseFile().common.artist / .album` | 同一次 parseFile 顺手取，零额外 IO |
| cover | `catalog.json` 可选 `cover`（库内相对路径） | `parseFile().common.picture[0]` | 独立图片优先；JPG/PNG/WebP，单张 ≤1MB；无独立图片才读 ID3 |
| lyrics | `catalog.json` 可选 `lyrics`（库内相对路径） | 无自动来源 | 必须以 `.lrc` 结尾、`realpath` 后必须在库根内（与 mp3 同一套防护）、≤256KB |

标签质量兜底：老旧 MP3 的 ID3 可能是 GBK 编码或乱码——`music-metadata` 处理常见编码，仍乱码时在 `catalog.json` 手填覆盖即可；这正是保留手填优先级的原因。

## 4. 接口设计

全部沿用现有鉴权（成员令牌 Bearer，无效 401），错误体 `{"message":"..."}` 与现有一致。

| 方法与路径 | 返回 | 备注 |
|---|---|---|
| `GET /api/rooms/:code/catalog` | 上节 7 字段数组 | 扩展现有路由 |
| `GET /api/rooms/:code/cover/:id` | 图片字节，`Content-Type` 按提取的 mime；`Cache-Control: private, max-age=86400` | 无封面 → 404 `{"message":"该歌曲没有封面"}`；可直接回内存 Buffer，不需要 Range |
| `GET /api/rooms/:code/lyrics/:id` | LRC 原文，`text/plain; charset=utf-8`，`no-store`（文件小，不值得缓存） | 无歌词 → 404；超 256KB 的文件上架时就被拒，接口不再二次限制 |

考虑过并否决的替代：封面/歌词 base64 内嵌进 catalog 响应（一次性拿全）——23 首 × 封面会令 catalog 膨胀数百 KB，且无法独立缓存，否决。

## 5. 客户端设计（安卓）

- **解析**（`Models.kt`）：`artist` 沿用旧解析；`album` 只接收非空 trim 后字符串，缺字段/null/错类型为 null；`hasCover/hasLyrics` 布尔；`coverVer` 可空数字。加解析单测。
- **歌单行**（`MainActivity.kt` `PlaylistRow`）：左侧 44dp 封面缩略图（无封面回退为现在的序号圆片），歌名下方加歌手副行（`bodySmall`、`onSurfaceVariant`，artist 为 null 不占位）。
- **MiniPlayer / PlayerSheet**（`RoomPlayer.kt`）：MiniPlayer 左侧 44dp 封面；PlayerSheet 顶部放 ~180dp 封面与"歌名 + 歌手"两行。
- **封面加载**：接口带令牌头，不能直接丢给 Coil 的 url 加载器。做法：OkHttp 请求（带 Authorization）下载到 `cacheDir/covers/<id>-<coverVer>`，命中即读文件；`coverVer` 变了键就变，旧文件被 LRU 淘汰。
- **同步歌词页**（第二轮）：PlayerSheet 内滚动歌词列表；`LrcParser` 纯函数把 `[mm:ss.xx]` 行解析为 `(timeMs, text)` 有序表，`LrcCursor.binarySearch(positionMs)` 定位当前行（解析与定位都是纯函数，照 `seekConfirmed` 的模式配单测）；当前行高亮放大、两侧淡化；无歌词显示占位文案。增强型 LRC（字级时间戳）不支持，按普通行处理。
- **媒体通知**（`PlaybackService.kt`）：`setArtist(track.artist ?: "一起听歌")`，顺手消掉写死值。

## 6. 协议与测试纪律

- `docs/protocol.md` 的 **HTTP 表**同步更新（catalog 行 + 两个新行 + 一句封面/歌词错误语义）。WS 部分与 JSON Schema 完全不动，`protocol.test.ts` 不受影响。
- catalog 响应不在现有 schema 校验范围内，因此在 `server/test/catalog.test.ts` 增加字段断言（含 null 语义、hasCover/hasLyrics 与 fixture 文件的一致性），沿用"文档是字段唯一出处"的纪律。
- 测试 fixture：现有 fixture MP3 若无封面/标签，加一个带 ID3（含 APIC）的小文件；lrc 用文本 fixture。

## 7. 上架与管理流程

- `media-manage.sh install` 的 manifest 从两列（id、标题）扩为**可选四列**（id、标题、歌手、专辑），两列输入继续兼容；歌手/专辑缺省时服务端自动读 ID3，**大多数情况下 manifest 根本不用填新列**。
- `media-manage.sh verify` 输出每首的歌手/专辑/有无封面/有无歌词，上架后一眼可查；本地 `scripts/metadata-manager.mjs` 提供图片上传、替换和移除。
- `.lrc` 上架：`add-media.ps1` 增加 scp `/tmp/lt-up-<id>.lrc` + `media-manage.sh lyrics <id> </tmp/x.lrc>` 子命令（写盘 + 更新编目条目 + 校验），沿用"中文只经文件内容流转"的既有约束。
- 编目条目自动生成：install 时把 ID3 里读到的歌手/专辑**直接写进 catalog.json 条目**（服务器上 node 一行即可），后续人工只在标签不可信时修——"更好管理"主要落在这里。

### 7.1 元数据联网匹配（管理器内，原 CLI 已并入）

`node scripts/metadata-manager.mjs`（`http://127.0.0.1:3100`）读取 `media/catalog.json` 与音频 ID3，把当前曲的"歌名 + 歌手 + 时长"送进所选元数据源做候选匹配。**2026-09-27 起该能力只在界面里提供，命令行同步器 `scripts/fetch-metadata.mjs` 已删除**，抓取/打分/缓存的唯一实现是 `scripts/lib/metadata-sources.mjs`（避免界面与脚本对同一候选给出不同结论）。

- **三个源，一套阈值**：`qq`（默认，一次搜索即拿全 title/artist/album/year/duration/封面）、`netease`（`cloudsearch/pc`，主接口失败退旧接口）、`musicbrainz`（唯一能给可读流派，且有 release 级权威年份）。国内平台不返回数值相关度，故按**结果名次**折算相关度后进入同一 `scoreCandidate` 加权（词形/时长/艺术家/相关度），阈值口径三源一致；已用单测钉住"网易云榜首是翻唱时必须选中原唱"。
- **候选只读，勾选才写**：`artist`/`album`/`genre`/`year` 按 `buildChanges` 白名单生成差异，界面逐字段勾选后经 `POST /api/tracks/:id/apply` 落库；已有值默认不覆盖（"批量匹配缺字段"走 `onlyIfEmpty`，写前按当前编目再过滤一遍）。低于阈值只展示候选、不给封面地址，也不会被批量模式写入。
- **写库口径与保存一致**：统一走 `writeAndValidate()` → `dist/library/catalog.js#loadCatalog` 整库校验 → 失败回滚 + HTTP 422；候选值本身先验类型（字符串非空、年份 1800–2100 整数），杜绝"空值即删"语义被外部脏数据触发。
- **出网边界**：只发检索文本、只取回文本字段与封面 URL，**不下载音频、不带任何登录 Cookie、不做批量爬站**；每源独立限速队列（MusicBrainz 约 1.1 秒/请求，QQ 与网易云约 0.8 秒/请求），批量为串行并带进度。结果缓存在 `.workbuddy/metadata-cache.json`（JSON 对象，键形如 `源|曲目标识`，坏了当空缓存重查即可、不拖垮匹配；勾选应用不回写缓存），曲库目录之外不写任何路径。
- **歌词与封面不在匹配范围**：歌词继续由 `scripts/fetch-lrc.mjs` 单独抓取（人工授权决定），封面只在候选里给地址、确认后仍经管理器上传落盘，服务端不接受外部图片 URL。

## 8. 兼容、流量与部署

- **兼容顺序**：catalog 是普通 HTTP JSON，旧客户端只读已知键、忽略新字段 → **服务端可先上云，安卓端随后发版**，无锁步风险。旧客户端对新接口无感知（不会去调）。
- **流量**：封面 30–100KB/张，按 `id+coverVer` 缓存后每设备每曲一次性；歌词 <10KB。对比音频（192kbps ≈ 86MB/听者小时）可忽略，不动 20GiB/月的出网约束。23 首全库封面约 1–2MB 内存常驻，上限保护后最坏 ~23MB，1.7GiB 内存无压力。
- **部署**：媒体目录在 `/opt/listen-together/media`（releases 之外的持久层），`.lrc` 与编目变更不受升级影响；后端代码变更走现有 release 流程，**restart 清空全部房间**，选无人使用的时间窗，`current-version.txt` 按既有规矩成对维护。
- **重启即重提取**：封面缓存与元数据都在 `loadCatalog` 时重建，无需额外持久化。
- **本地管理器**：`node scripts/metadata-manager.mjs` 只监听 `127.0.0.1:3100`；手工编辑、音频上传、封面上传（写入 `media/covers/`）、联网匹配（`/api/sources`、`/api/tracks/:id/sync`、`/api/tracks/:id/apply`）都在同一界面，写编目统一过 `dist/library/catalog.js#loadCatalog` 校验并失败回滚，故干净克隆后需先 `cd server && npm run build`（缺产物时工具直接打印这条命令）。云端发布仍按部署手册单独上传媒体文件与清单。

## 9. 分轮实施计划

| 轮次 | 内容 | 验收口径 |
|---|---|---|
| 第一轮 | 服务端：Track 扩展 + ID3 提取 + catalog 字段 + 封面接口；编目校验放宽（可选字段）+ install/verify 支持；安卓：解析 + 歌单行/迷你条/展开页封面与歌手 + 媒体通知歌手；两端测试 | server 测试实跑全过；安卓 cleanTest + Lint 0；缺真机时 UI 以构建 + 单测 + 模拟器截图为准（如无设备，真机手感挂起） |
| 第二轮 | `.lrc` 上架通道 + 歌词接口 + 安卓歌词页（解析/游标纯函数 + UI） | 同上 + LrcParser/LrcCursor 单测 |
| 第三轮（可选，另议） | 歌单搜索框、按歌手分组 | 未定，不在本方案承诺内 |

每轮照旧：`scripts/check.ps1` 门禁（安卓段带 `:app:cleanTestDebugUnitTest`）、`git status` 核对证据文件、踩坑回填 `development-pitfalls.md`。

## 10. 待定问题（实施前需拍板）

1. ID3 乱码是否接受"手填覆盖"为唯一兜底（暂不引入编码探测）——建议接受。
2. 管理器是否强制转 jpeg——已定：原图不超过1MB时保留 JPG/PNG/WebP；大图由浏览器缩放并转为 ≤1MB JPEG。
3. `coverVer` 是否只用音频 mtimeMs——已改为图片内容哈希加文件时间，替换同一路径的封面也能刷新客户端缓存。
4. 歌词页与展开页的关系：PlayerSheet 内嵌滚动区（推荐，不加新页面）还是独立全屏页。
