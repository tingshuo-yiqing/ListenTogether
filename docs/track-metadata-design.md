# 歌曲元数据扩展方案（设计稿，未实施）

状态：**设计稿**，2026-09-26。本文只定方案与边界，不含任何已实施承诺；落地进度以 `verification.md` 为准。
读完本文需要的背景：`docs/protocol.md`（v1 协议与 JSON Schema 纪律）、`docs/deployment.md` 第 6 节（曲库上架）。

## 0. 目标与非目标

目标：让"歌"从 `{id, title, durationMs}` 三字段扩展为带歌手、专辑、封面、歌词的完整条目；展示更多样（封面、歌手行、同步歌词），管理更省事（元数据自动提取、编目条目可自动生成）。

非目标：
- 不改变 WS 协议与播放同步逻辑（state 消息仍只引用 `trackId`，schema 一个字段不动）。
- 不支持 MP3 以外的音频格式（`.mp3` 校验、转码管线、`audio/mpeg` 都保持现状，属另一条线）。
- 不做在线搜歌、下载源、管理后台 HTTP 写接口；写编目仍走脚本 + 重启。
- 不引入数据库；`catalog.json` 仍是曲库唯一事实来源。

## 1. 现状（2026-09-26 核对）

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
  cover: { mime: string; data: Buffer } | null;  // 新增：内嵌封面字节，启动时提取、常驻内存
  coverVer: number | null;          // 新增：封面版本 = 音频文件 mtimeMs，客户端缓存键
  lyricsPath: string | null;        // 新增：库内 .lrc 文件绝对路径（仅服务端使用）
};
```

catalog 下发字段（固定 7 个，未知值为 `null`，便于文档作为唯一出处与测试断言）：

```json
{ "id": "song-01", "title": "歌名", "durationMs": 213000,
  "artist": "歌手", "album": "专辑", "hasCover": true, "hasLyrics": false }
```

`coverVer` 也一并下发（`hasCover=false` 时为 `null`）：客户端封面缓存键 = `id + coverVer`，音频被替换后 mtime 变化，缓存自然失效。`path`/`size`/`cover`/`lyricsPath` 仍不出服务端。

## 3. 数据来源与优先级

每个字段按 **catalog.json 手填 > MP3 内嵌 ID3 > null** 的兜底链取值：

| 字段 | 来源 1（手填，可选） | 来源 2（自动） | 说明 |
|---|---|---|---|
| title | `catalog.json` 必填 | — | 现状不变 |
| artist / album | `catalog.json` 可选 `artist` / `album` | `parseFile().common.artist / .album` | 同一次 parseFile 顺手取，零额外 IO |
| cover | — | `parseFile().common.picture[0]` | 同上；单张 >1MB 跳过（内存保护）；mime 按原始值（image/jpeg、image/png）下发 |
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

- **解析**（`Models.kt`）：`artist/album` 用 `isNull` 判空取值；`hasCover/hasLyrics` 布尔；`coverVer` 可空数字。加解析单测。
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
- `media-manage.sh verify` 输出每首的歌手/专辑/有无封面/有无歌词，上架后一眼可查。
- `.lrc` 上架：`add-media.ps1` 增加 scp `/tmp/lt-up-<id>.lrc` + `media-manage.sh lyrics <id> </tmp/x.lrc>` 子命令（写盘 + 更新编目条目 + 校验），沿用"中文只经文件内容流转"的既有约束。
- 编目条目自动生成：install 时把 ID3 里读到的歌手/专辑**直接写进 catalog.json 条目**（服务器上 node 一行即可），后续人工只在标签不可信时修——"更好管理"主要落在这里。

## 8. 兼容、流量与部署

- **兼容顺序**：catalog 是普通 HTTP JSON，旧客户端只读已知键、忽略新字段 → **服务端可先上云，安卓端随后发版**，无锁步风险。旧客户端对新接口无感知（不会去调）。
- **流量**：封面 30–100KB/张，按 `id+coverVer` 缓存后每设备每曲一次性；歌词 <10KB。对比音频（192kbps ≈ 86MB/听者小时）可忽略，不动 20GiB/月的出网约束。23 首全库封面约 1–2MB 内存常驻，上限保护后最坏 ~23MB，1.7GiB 内存无压力。
- **部署**：媒体目录在 `/opt/listen-together/media`（releases 之外的持久层），`.lrc` 与编目变更不受升级影响；后端代码变更走现有 release 流程，**restart 清空全部房间**，选无人使用的时间窗，`current-version.txt` 按既有规矩成对维护。
- **重启即重提取**：封面缓存与元数据都在 `loadCatalog` 时重建，无需额外持久化。

## 9. 分轮实施计划

| 轮次 | 内容 | 验收口径 |
|---|---|---|
| 第一轮 | 服务端：Track 扩展 + ID3 提取 + catalog 字段 + 封面接口；编目校验放宽（可选字段）+ install/verify 支持；安卓：解析 + 歌单行/迷你条/展开页封面与歌手 + 媒体通知歌手；两端测试 | server 测试实跑全过；安卓 cleanTest + Lint 0；缺真机时 UI 以构建 + 单测 + 模拟器截图为准（如无设备，真机手感挂起） |
| 第二轮 | `.lrc` 上架通道 + 歌词接口 + 安卓歌词页（解析/游标纯函数 + UI） | 同上 + LrcParser/LrcCursor 单测 |
| 第三轮（可选，另议） | 歌单搜索框、按歌手分组 | 未定，不在本方案承诺内 |

每轮照旧：`scripts/check.ps1` 门禁（安卓段带 `:app:cleanTestDebugUnitTest`）、`git status` 核对证据文件、踩坑回填 `development-pitfalls.md`。

## 10. 待定问题（实施前需拍板）

1. ID3 乱码是否接受"手填覆盖"为唯一兜底（暂不引入编码探测）——建议接受。
2. 封面 mime 是否统一转 jpeg（当前设计：保留原 mime 原始字节，不转码）——建议保留原样。
3. `coverVer` 用音频 mtimeMs 是否够（多封面来源场景不存在，够用）。
4. 歌词页与展开页的关系：PlayerSheet 内嵌滚动区（推荐，不加新页面）还是独立全屏页。
