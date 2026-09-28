# 2026-09-27 凌晨 · 歌曲元数据第二轮真机验收（歌词页 + 占位封面）+ 歌词状态缺陷修复

用户指示：「请你装机验收一下，现在我连接 USB」。本次为元数据第二轮（歌词管线 + 封面静态占位）的真机门槛，按交付顺序在设备窗口内完成；同时发现并修复一个**歌词状态机缺陷**（详见第 4 节）。

- 设备：PHQ110（OPPO），adb 序列号 `fbddbe8`，USB 连接，**一次识别成功、全程未出现抖动**（用户要求"抖动就提示并重试"，实际未触发）。
- 后端：**本机** `node dist/index.js`（`MEDIA_DIR=D:\ListenTogether\media`，`HOST=127.0.0.1`），设备经 `adb reverse tcp:3000` 访问 `http://127.0.0.1:3000`。曲库是启动时一次性读入内存的，**验收结束时该进程仍在运行且持有 23 首曲目**；但请注意 `media/catalog.json` 已还原为入库模板 `[]`，**下次重启前需先跑一次装配**（见第 1 节），否则会加载到空曲库。
- 曲库：**从云端拉到本地**（用户选择"①拉曲库到本地，本地起后端验收"），23 首真实音乐 133MB，避免动公网服务。拉取流程见第 1 节。
- 房间控制：为验收新增 `scripts/host-remote.mjs`（电脑侧当房主并保持 WS，可下发 select/play/pause/seek），设备以**成员**身份跟听——这样"成员侧歌词跟随"才是真实路径。

## 1. 曲库落地（云端 → 本地）

| 步骤 | 命令/产物 | 结果 |
|---|---|---|
| 云端打包（ASCII 名） | 服务器侧 `tar --transform` 按 catalog 把 `红日.mp3` → `hong-ri.mp3` | `/tmp/lt-media-ascii.tar` 138,987,520 字节（23 首 + catalog） |
| 下载 | `scp aliyun:/tmp/lt-media-ascii.tar` | 字节数与云端一致，耗时 82s |
| 解包 | `tar -xf` 到 `.workbuddy\media-stage\` | **exit 0，23/23，全 ASCII 名** |
| 装配 | `node scripts/build-local-catalog.mjs`（新增） | `media/catalog.json` 23 条，`file` 映射为 `<id>.mp3`，挂 `lyrics` 引用 23/23 |

> 入库边界：`media/catalog.json` 是被 `.gitignore` 特意放行的**模板文件**（HEAD 内容为 `[]`），本轮为跑真机验收把它装配成了 23 条本机曲目——**验收结束后已 `git checkout` 还原为 `[]`**，23 首 mp3 与 23 个 `.lrc` 都留在本机（gitignore 覆盖，不入库）。后续要重跑本机真实曲库，先执行上面的装配命令再起后端。

> 为什么不直接拉中文名：Windows 自带 `tar.exe` 按 ANSI 代码页解析 tar 头，23 个中文名条目只解出 20 个且文件名乱码。已回填陷阱 1.8。
> 首次尝试（直接打包中文名）**失败**：`tar -xf` exit 1，实际只落地 20 个文件、名如 `绾㈡棩.mp3`；弃用改为 ASCII 方案，**未污染本地曲库**（解到独立暂存目录核对后才装配）。

## 2. 本地后端门禁（真实曲库）

| 检查项 | 结果 |
|---|---|
| `npm run build`（tsc） | 0 错误 |
| `npm test` | **28/28 通过**，0 失败 |
| `GET /api/rooms/:code/catalog` | 23 首，7 字段（`id,title,durationMs,artist,hasCover,coverVer,hasLyrics`），`hasLyrics=true` 23/23 |
| artist 解析 | 「痴心绝对」→ 李圣杰、「富士山下」→ 陈奕迅、「句号」→ G.E.M. 邓紫棋（ID3 兜底生效） |
| `GET .../lyrics/he-bu-ke` | 200 · `text/plain; charset=utf-8` · `private, no-store` · 2147 字节 / 53 行中文原样 |
| `GET .../lyrics/dan-che`（占位、无时间戳） | 200 + `; 未在 lrclib.net 匹配到带时间戳歌词；曲名「单车」` |
| `GET .../lyrics/<不存在>` | 404 `{"message":"歌曲不存在"}` |
| 无令牌访问 | 401 |
| 路径泄漏检查 | catalog 响应中无 `.mp3` / `.lrc` / 绝对路径 |

## 3. 装机与真机验收

### 3.1 装机一致性
- 交付包 `b1e805735979558b4456abeb552141a7f821c50f1228a33ff2f80f133777d1ea`（20,484,498 字节）→ `adb install -r` **Success**。
- `pm path` 回拉后**字节数与 SHA256 双重核对逐位一致**（陷阱 2.15 要求）。

### 3.2 占位封面（三处）
- 歌单行 44dp、MiniPlayer 44dp、展开页 180dp 均显示 `CoverPlaceholder`（渐变圆角 + 图标）。
- 真机旁证：`hasCover=false` 23/23（服务端强制停用封面提取），客户端未尝试网络路径。

### 3.3 歌词页（本轮核心）

| 验证项 | 方法 | 结果 |
|---|---|---|
| 歌词渲染 | 「有何不可」展开页 | 标题 + 无歌手行（artist 为 null 不占行高）+ 进度 + 真实繁体歌词 ✅ |
| 当前行高亮 | 截图 | 当前行加粗放大、两侧灰色渐隐、居中偏下 ✅ |
| **逐行跟随** | 每 8 秒采样一次，共 5 次 | 进度 0:55→1:37，高亮行分别为「為你解凍冰河…」「它僅僅代表著…」「夏末秋涼里…」「傻站在你家樓下」「抬起頭 數烏雲」——**每次采样都与时间轴对应且持续推进** ✅ |
| **手动翻看暂停跟随** | 歌词区上滑后立即截图 | 歌词停在列表末尾（「有換季的顏色」下方空白），未跟到当时时间轴 ✅ |
| **松手后自动恢复** | 滑动后等 4 秒截图 | 画面对齐回当前时间轴，高亮行更新为「為你唱這首歌 沒有什麼風格」 ✅ |
| **「回到当前歌词」按钮** | 滑动后 300ms 内抢拍 | 按钮出现在歌词区底部居中（青色文字）✅ |
| 按钮点击回到当前 | 点击后观察 | 歌词跳回当前行并居中 ✅（首次点击落在按钮下方使 sheet 收起，但跳回已发生；精确坐标重试未再复现，**如实标注为"已验证跳回效果，未在 sheet 内完成一次干净点击"**） |
| 切歌重载歌词 | 房主切「痴心绝对」 | 歌词随曲目切换为「想用一杯 Latte 把妳灌醉」✅ |
| 无时间轴占位 | 切「单车」（占位 .lrc） | 显示「这首歌的歌词没有时间轴，暂时没法逐行跟随」✅ |
| **无歌词占位（缺陷修复后）** | 临时改名 `ju-hao.lrc` 制造 404 | 修复前卡「加载中」>2 分钟；**修复后显示「这首歌还没有歌词」** ✅ |
| 文件恢复后正常渲染 | 还原 `ju-hao.lrc` 后切走再切回 | 「句号」歌词正常渲染 ✅ |

### 3.4 附带覆盖
- **播放跟听链路**：`dumpsys media_session` 显示 `state=PLAYING(3)`、`speed≈1.04`、元数据「有何不可」；播放位置持续推进；自动切下一首（有何不可 4:01 走完后自动到「痴心绝对」）。
- **成员侧无控制权符合设计**：设备上点歌单行不改变全房间状态（403 语义），所有切歌均由房主侧下发。
- **播放中动效条**：同一区域连拍 3 帧，像素哈希 3/3 各不相同 → 动效条确实在动 ✅。

## 4. 本轮发现并修复的缺陷（歌词状态机）

### 4.1 现象
宿主曲目「句号」的 `catalog.json` 有 `lyrics` 引用、但磁盘 `.lrc` 缺失（服务端按设计返回 `404 歌词文件缺失，请联系管理员`）时，展开页歌词区**停在「歌词加载中」超过两分钟不动**，而正确文案应为「这首歌还没有歌词」。

### 4.2 定位
1. 先在 `LyricsSection` 的 `produceState` 内埋点，打印出：`producer fetched=null` → `producer value assigned=null`（取值 60ms 内完成，值确实被置为 null）。
2. 再在渲染分支埋点：`render lyricText=null lines=0 hasLyrics=true`——**控件拿到的是正确的 null，问题在渲染分支的判断**。
3. 根因：`produceState` 初值为 `if (hasLyrics) "" else null`（`""`=加载中、`null`=没内容），而分支写作「先判 `lyricText == null`，再在分支内按 `track.hasLyrics` 二分」。hasLyrics=true 的曲目取值失败后仍是 null，于是永远落进「加载中」那一支——**「这首歌还没有歌词」实际不可达**。

### 4.3 修复
- 新增 `ui/LyricsState.kt`：`lyricsUiState(hasTrack, lyricText, hasLyrics, lineCount)` 纯函数 + `lyricsPlaceholderText(state)`，显式区分 `Loading`（仅 `lyricText == ""`）/ `NoLyrics`（`null` 一律归此）/ `NoTimeline` / `Ready` / `Empty`。
- `ui/RoomPlayer.kt::LyricsSection` 改为按枚举渲染，不再自行拼条件。
- 新增 `LyricsStateTest`（7 项）：包含"加载文案 ≠ 失败文案"的断言——该断言在本轮**当场抓出了修复第一版**把 null 并入加载态的同类错误，说明这类"两个状态被压成一个"的缺陷确实需要专门用例钉住。
- 与服务端无关，未改协议、未改 catalog 字段。

## 5. 门禁（实跑）
- 服务端：`npm run build` tsc 0 错误；`npm test` **28/28**。
- 安卓：`cleanTestDebugUnitTest → testDebugUnitTest → lintDebug → assembleDebug → assembleBenchmark`，**BUILD SUCCESSFUL**（5m48s，102 tasks）。单测 **118/118 实跑、0 失败/0 错误/0 跳过**（18 个测试类；基线 111 + LyricsStateTest 7，另有 `diagnostics/DiagnosticsLogTest` 8 项在子目录内，故源码 `@Test` 110 + 8 = 118）。
- Lint：报告**先删再生**（陷阱 5.5），`lint-results-debug.xml` mtime 为本轮 00:53:27，`<issue ` 计数 **0**，txt 为 `No issues found.`。
- 交付包与设备装机一致性：`pm path` 回拉的 base.apk 与本地 `app-debug.apk` **字节数 + SHA256 逐位一致**。

## 6. 交付锚

| 产物 | SHA256 | 装机 |
|---|---|---|
| debug | `7C503FDD5853BD252705EA527B6B5D5FE4B7F3EA10E72EE8E5241E2C1046BF9A`（20,484,498 字节） | **是**，PHQ110 `fbddbe8`，回拉核对逐位一致 |
| benchmark | `3945E4C83E21597B1D5D6910764F7FA35077D2094B0002138B6E3B4F6AE576E0`（2,429,597 字节） | 否（性能专用，不分发） |

> 上一轮的 `b1e80573…` 包在本轮发现缺陷后**已被取代**；该包的字节副本留在 `.workbuddy\deliverable-b1e80573.apk`（gitignore 覆盖，仅本机留档）。

## 7. 未覆盖（如实标注）
- **云端未部署**：新后端（含 `/lyrics`）、21 个真实 `.lrc`、云端 `catalog.json` 的 `lyrics` 引用**均未上云**；`add-media.ps1` 的歌词通道未补。上云需 restart（清内存房间），等用户开窗。
- 「回到当前歌词」按钮未在 sheet 内完成一次干净的点击闭环（见 3.3 备注）。
- 歌词长列表快滑、2 倍系统字号下的歌词排版、小屏布局、emoji/代理对昵称目视、触感手感、双人真机同屏（缺第二台）——均未覆盖。
- 封面为**统一静态占位**（服务端提取临时停用），未验真实封面渲染。
- 本地曲库现为 `<id>.mp3` ASCII 命名 + 装配脚本生成的 catalog，与云端中文名布局不同——**这是本地验收环境的有意差异**，云端布局未动；后续若要复用本地环境，直接跑 `scripts/build-local-catalog.mjs` 即可。

## 8. 本轮新增工具（可复用）
- `scripts/build-local-catalog.mjs`：把云端 catalog 落成本地可跑曲库（ASCII 名映射 + 歌词引用挂接 + 缺文件即失败不产半成品）。
- `scripts/host-remote.mjs`：电脑侧房主遥控（保持 WS、`--cmds` 文件驱动、`--ack` 执行回执、`--join` 加入已有房间），用于设备当成员时的跟听侧验收。
