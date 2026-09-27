# 2026-09-26 深夜 · 歌曲元数据第二轮（歌词管线 + 封面回退静态占位）

用户指示：「先生成已存在歌曲的歌词文件，封面现在统一占位。再开始第二轮」。
本轮无 WS 协议改动、无云端操作、未装机（设备项按交付顺序留待用户开启真机窗口）。设计口径见 [track-metadata-design.md](../../track-metadata-design.md)（状态已改为"第一/二轮已落地"）。

## 变更清单

### 歌词抓取（用户授权 lrclib.net 公开 API，替代"仅人工维护来源"）
- 新增 `scripts/fetch-lrc.mjs`：stdin `id<TAB>标题<TAB>durationMs[<TAB>歌手]`；按 (track_name, duration ±2s→±10s) 搜 `syncedLyrics`，再放宽不带 duration 全量搜；503 过载重试一次；默认跳过已含 `[mm:ss]` 的产物（`--force` 重抓）；未命中写一行 `;` 占位 .lrc。
- 云端 23 首清单经用户授权由公网 API `GET /catalog` 拉取（当时 SSH 被工具策略拦截）。**结果：21/23 命中真实歌词**；单车（陈奕迅，lrclib 全库无 synced 条目）、红日（李克勤，lrclib 无该曲条目）为占位文件，界面按"歌词没有时间轴/没有歌词"回退。
- 产物在 `media/lyrics/*.lrc`（gitignore 覆盖，不入库）；云端挂载与 catalog.json 的 lyrics 引用属部署窗口，本轮未动云端。

### 服务端
- `library/catalog.ts`：Track 新增 `lyricsPath: string|null`；catalog.json 可选 `lyrics` 字段——realpath 后必须仍在库根内、`.lrc` 后缀、≤256KB，坏引用启动即失败（与 MP3 同一套防逃逸）。**封面提取临时停用**：`cover/coverVer` 强制置 null（提取表达式、`/cover` 路由、客户端缓存骨架全部保留，删一行即恢复）。
- `routes/lyrics.ts`（新增）：成员令牌鉴权 → 无歌词 404「该歌曲没有歌词」→ 引用文件被删 404「歌词文件缺失，请联系管理员」（非 500）→ 命中返回 `text/plain; charset=utf-8`、`private, no-store`、整读。
- `app.ts`：catalog 路由第 7 字段 `hasLyrics`；注册 lyricsRoutes。
- 测试：`catalog.test.ts` 新增「歌词引用加载期校验」6 分支（正常/无字段/../逃逸/非 .lrc/文件缺失/超 256KB）；`lyrics.test.ts`（新增）5 分支（401/歌曲不存在/无歌词/悬挂引用/UTF-8 中文原样往返+缓存头）；`cover.test.ts` catalog 断言扩至 7 字段并钉住"绝对路径绝不出服务端"。
- 门禁：tsc 0 错误，**28/28 通过**（上轮 26 + 歌词路由 + 歌词校验）。

### 安卓
- `Models.kt`：Track 加 `hasLyrics`（默认 false，旧服务端兼容）；`ModelsTest` 四个解析用例覆盖缺省/null/true。
- `LrcParser.kt`（ui 包纯函数）：`parseLrc` 多标签行、乱序归位升序、元数据/注释/无文本行丢弃、BOM/CRLF 容忍、增强型字级 `<...>` 按普通文本保留；`indexAt` 二分定位（空表/未到首行 -1）。`LrcTest` 11 项。
- `network/LrcCache.kt`（新增）：`cacheDir/lyrics/<id>.lrc`；键只有 id（服务端换文本本机不感知，已记入模块 08"下一阶段"）。
- `RoomClient`：构造注入 `LrcCache`；`fetchLyrics`（会话守卫 → 缓存命中直读 → Bearer 下载落盘），失败/无歌词统一 null。
- UI：PlayerSheet 进度行下方新增 220dp `LyricsSection`——当前行高亮放大、`animateScrollToItem` 跟随（顶部留白 70dp 近似居中；foundation 1.8 无像素级居中 API，已注释口径）；手势滚动（NestedScroll UserInput 源）暂停跟随 + 松手 500ms 自动恢复 + 「回到当前歌词」按钮；无歌词/加载中/无时间轴三种占位文案。
- 封面回退（同用户指示）：`CoverPlaceholder`（渐变圆角 + 音符图标）统一用于歌单行 44dp、MiniPlayer 44dp、展开页 180dp；`rememberCoverBitmap`/`fetchCover`/`CoverCache` 骨架保留（服务端恒 404 → 恒回退占位）；PlaylistRow 序号列随之移除（`number` 参数删除）。
- 门禁：cleanTest 实跑 **111/111、0 失败/错误/跳过**；Lint issues=0；assembleDebug 通过；debug APK SHA256 `b1e805735979558b4456abeb552141a7f821c50f1228a33ff2f80f133777d1ea`（**未装机**；装机基线仍为 `517A776B…`）。

### 脚本与文档
- `media-manage.sh`：新增 `lyrics <id> /tmp/lt-up-<id>.lrc` 子命令（≤256KB + 必须含 `[mm:ss]` 行 + 落盘去 BOM + 回写 catalog `lyrics` 字段）；`verify` 输出追加 歌手=/封面=/歌词=（引用存在但文件缺失标"缺文件!"）。干跑验证：临时 catalog 挂接成功、无时间戳文件拒收 exit=1。
- `docs/protocol.md`：catalog 行 7 字段、新增 lyrics 行与封面停用标注、歌词来源与校验一句。
- 模块 06/08 补齐第一轮遗漏（catalog 字段、cover/lyrics 路由、Track 内部字段、歌词上架与停用口径）；设计稿状态节改写为"第一/二轮已落地"。

## 未覆盖（如实标注）
- 真机：歌词页渲染、跟随滚动、手动翻看/「回到当前歌词」、占位封面观感——缺设备窗口，未做。
- 云端：后端未部署（`/lyrics` 未上线）、`.lrc` 未 scp 上云、云端 catalog.json 未挂 lyrics 引用——按交付顺序（先设备测试，用户发话再上云）留待下轮。
- `add-media.ps1` 的上云歌词通道未加（部署窗口执行时手动 scp + `media-manage.sh lyrics` 即可，脚本可届时补）。
