# 2026-09-26 歌曲元数据第一轮

按 [track-metadata-design.md](../../track-metadata-design.md) 第一轮方案落地：不带专辑、不带通知歌手；第二轮歌词按方案留到下轮。

## 改动清单

### 服务端
- `server/src/library/catalog.ts`：Track 类型扩展 `artist`/`cover`/`coverVer`；catalog.json 支持可选 `artist` 字段（手填优先覆盖 ID3）；`music-metadata` 提取 `common.artist` 与 `common.picture[0]`，>1MB 封面跳过；coverVer 用音频 mtimeMs。
- `server/src/app.ts`：catalog 路由下发 `{id,title,durationMs,artist,hasCover,coverVer}`。
- `server/src/routes/cover.ts`（新增）：`GET /api/rooms/:code/cover/:id`，Bearer 鉴权、404 业务错误体、Cache-Control: private, max-age=86400，mime 保留 ID3 原值（image/jpeg / image/png）。
- `server/test/catalog.test.ts`：新增手填 artist 优先 / null 语义用例；旧用例不变。
- `server/test/cover.test.ts`（新增）：鉴权、404、缓存头、字节一致；catalog JSON 包含新字段的 null 语义。

### 安卓
- `android/app/src/main/java/com/listentogether/app/network/Models.kt`：Track 加 `artist: String? = null` / `hasCover: Boolean = false` / `coverVer: Long? = null`（默认值兼容旧调用方）；`Track.parse` 读三个新字段，空串归 null。
- `android/app/src/main/java/com/listentogether/app/network/RoomClient.kt`：`RoomClient.create` 注入 OkHttpClient + CoverCache；新增 `suspend fun fetchCover(track)` 走会话上下文拉封面并缓存；`RoomClientSessionTest` 更新构造调用（测试不实际拉封面，传内存 CoverCache）。
- `android/app/src/main/java/com/listentogether/app/network/CoverCache.kt`（新增）：`CoverCache(dir: File)`，`key` / `file` / `decode` 三个无 Android 依赖的纯函数。
- `android/app/src/main/java/com/listentogether/app/ui/CoverView.kt`（新增）：`rememberCoverBitmap(client, track)` 用 `produceState` + `(id,coverVer)` 重启；先等 credentials 就绪再拉取。
- `android/app/src/main/java/com/listentogether/app/MainActivity.kt`：PlaylistRow 签名加 `client` 参数；左侧 44dp 封面（无封面回退序号/动效条）+ 歌名下方歌手副行（artist 空不占位）。
- `android/app/src/main/java/com/listentogether/app/ui/RoomPlayer.kt`：MiniPlayer 左侧 44dp 封面；PlayerSheet 顶部 180dp 圆角封面 + 歌名 + 歌手副行。
- `android/app/src/test/java/com/listentogether/app/ModelsTest.kt`（新增）：4 项解析测试（已知字段、null 字段、缺省回退、空 artist 归 null）。

### 协议与文档
- `docs/protocol.md`：catalog 行扩字段；新增 `/cover/:id` 行与封面错误语义。

## 门禁（实跑）

- 服务端 `npm run build`：tsc 0 错误。
- 服务端 `npm test`：**26/26**（catalog 防护 4 项 + 解析 1 项 + 新增 1 项 + 集成 2 项 + 协议/schema/实时/房间限连等历史项）。
- 安卓 `:app:cleanTestDebugUnitTest :app:testDebugUnitTest`：单测 **100/100 实跑、0 失败/0 错误/0 跳过**（基线 96 + ModelsTest 4）。
- 安卓 `:app:assembleDebug`：BUILD SUCCESSFUL，APK 再生。
- 安卓 `:app:lintDebug`：BUILD SUCCESSFUL，0 issues。
- `scripts/check-doc-links.mjs`：全量通过。

## 未覆盖（缺真机）

- PHQ110 真机目视：封面缩略图/180dp 大封面/歌手副行排版；
- 相机扫码入房（需人工对准屏幕）；
- 触感人工手感、双人同屏（缺第二台）、2 倍系统字号、小屏布局、emoji 昵称目视仍按外部条件挂起。

第二轮歌词（`.lrc` 上架通道、歌词接口、`LrcParser`/`LrcCursor` 纯函数、安卓歌词页）按方案在下一轮启动时按 [track-metadata-design.md](../../track-metadata-design.md) 第 9 节实施。