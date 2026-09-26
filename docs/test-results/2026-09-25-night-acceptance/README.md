# 09-25 夜轮装机验收（入房恢复 / 二维码邀请 / 滚动性能）

日期：2026-09-25 22:55 – 23:59（验收）+ 2026-09-26 00:00 前后（按用户指示精简界面提示并收尾）
设备：PHQ110（OPPO，Android 14，1080x2412），无线 adb；后端：云端 `http://8.166.126.136:3000`
被测范围：工作区未提交的夜轮改动（`JoinInputSaver`/`rememberSaveable` 表单恢复、`lastRoom` 预填与「重新加入房间」、`takeCodePoints` 昵称截断、ZXing 扫码与邀请二维码、`benchmark` R8 性能变体）

## 结论速览

| 项 | 结论 |
|---|---|
| 门禁 | 通过（首轮 Lint 失败→修复后重跑）：86 项单测 cleanTest 实跑 0 失败/0 错误/0 跳过、Lint issues=0 |
| 装机一致性 | debug 与 benchmark 两个包均 `pm path` 拉回 base.apk，SHA256 与交付锚逐位一致 |
| 入房恢复（预填 + 配置变化存活 + 重新加入） | 通过（含意外获得的「房间已被回收」失败分支） |
| 邀请二维码生成 | 通过（截图独立反解，四行结构与 `InviteCode.encode` 一致，无 `:3000`、无 32 位十六进制令牌） |
| 相机扫码入房 | **未覆盖**（需人工把手机对准屏幕；本轮无设备可继续操作） |
| 滚动帧耗时（R8 vs debug，同协议同条件） | 已采集：R8 0.77% / 0.16%，debug 7.66% / 2.08%（播放中快滑 / 带 1s 停顿） |
| 播放态文字显示 | 疑点未定性，**已随本轮删除该文案而关闭**（详见下节） |
| 双人（脚本成员 + 房主）同屏显示 | **未覆盖**（同一台手机被 ColorOS 杀后台，两客户端无法同时在线，需本机后端 + `adb reverse`） |

## 交付锚

| 阶段 | 变体 | SHA256 | 状态 |
|---|---|---|---|
| 门禁后交付稿 | debug | `9C48058311d96f2a958c6f6f9ec083b6f726aab88973d96ceef29df69a7f40eb` | 已装机，回拉一致；本轮全部真机场景在此包上跑 |
| 门禁后性能稿 | benchmark（R8） | `086079819f422c4eccaf2d9ea9a9940e3b2e86e2b617e3e5ebb9261c7bfd1ccc` | 已装机（2.4 MB vs debug 23 MB，R8 收缩生效），回拉一致；帧耗时在此包采集 |
| 删除状态文案后终稿 | debug | `BCF3DE1630969684B05BB6552E26925F76E34C0039C78B212F950CA250027AFE` | 84 项单测、Lint 0；**未装机（用户告知无法提供真机）** |
| 删除状态文案后终稿 | benchmark（R8） | `9E17F2916D1E4B3A3F3C21A51CEC476E6EDEF51886179081E5FC5E34A72C7302` | 构建通过；未装机 |
| 上轮候选稿（本轮开工前） | debug / benchmark | `E984FF40…` / `A201AE4A…` | 由夜轮实现会话登记，未跑门禁、未装机；本轮被上面两稿取代 |

## 门禁

1. **首轮失败**（`gate.log` 之前的一次运行，日志被后台包装器掩盖）：`:app:lintDebug` 报 `PermissionImpliesUnsupportedChromeOsHardware` —— 声明了 `android.permission.CAMERA` 却没有对应的 `<uses-feature android:name="android.hardware.camera" android:required="false" />`。同时清掉 2 条 `UseKtx` 警告（手绘二维码改 `androidx-core` 的 `createBitmap` / `set`）。
2. **修复后重跑**：`gate.log`，命令 `:app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug` → `BUILD SUCCESSFUL in 41s`，`> Task :app:testDebugUnitTest` 不带 UP-TO-DATE（真跑），合计 `tests=86 failures=0 errors=0 skipped=0`；Lint 报告先删再生，`<issue ` 计数 0。
3. **删提示后复跑**：`gate-2.log` → `BUILD SUCCESSFUL in 40s`，`tests=84`（净减 2 项：`playbackLabel` 的状态文案回归随文案一并删除），0 失败/0 错误/0 跳过，Lint 0。
4. `benchmark-build.log` / `benchmark-build-2.log`：`:app:assembleBenchmark` 通过，日志含 `> Task :app:minifyBenchmarkWithR8`（R8 确已执行）。

背景任务采集 Gradle 结论时**必须把退出码写进日志**（`echo "GRADLE_EXIT=$?"`）：首轮就是靠包装器的 `EXIT=0` 误判成通过，实际 `BUILD FAILED`（陷阱 1.7 补充）。

## 逐场景实测

| # | 场景 | 操作 | 实测结果 | 证据 |
|---|---|---|---|---|
| 1 | 冷启不静默入房 + 表单预填 | 清后台冷启 App | 停在入房页，昵称与房间码由 `lastRoom` 预填、地址为已记住的云端地址；**未自动连接**（要人再点一次） | `00-home-launch.png`、`05-relaunch-prefill.png` |
| 2 | 手填入房 | 填昵称 → 创建房间 | 建房成功，房间页正常，房间码 `B5882E16`（顶栏不显示房间码，取自诊断 JSONL 与口令文本） | `03-room-created.png`、`diag-host-2311.jsonl` |
| 3 | 邀请二维码 | 顶栏分享 → 二维码对话框 | 弹层渲染二维码；对截图独立反解得到四行文本：`来一起听歌 / 房间码 B5882E16 / 服务器 http://8.166.126.136 / 复制提示…`，行数与字符数与 `InviteCode.encode` 逐位对应，`:3000` 已剥离，`has_token_like_32hex = false`（**令牌不入二维码**） | `04-invite-qr.png`、`qr-decoded.txt` |
| 4 | 配置变化不丢表单 | `cmd uimode night yes` 强制重建 Activity | 昵称/房间码/地址三项在重建后仍在（`rememberSaveable` + `JoinInputSaver`），令牌不在 SavedState（纯函数与单测保证，界面侧无泄漏面） | `07-dark-recreate.png` |
| 5 | 会话失效 → 房间内重新加入 | 息屏/后台导致 WS 掉线，服务器 60 秒后移除成员 | 回到前台判为 Expired：错误色横幅「房间或成员已失效，请退出后重新加入」+「重新加入房间」「退出房间」两个入口（成员区摘要同句复述）；点「重新加入房间」用当前房间码换发**新令牌**重新入房，1 人 · 已连接恢复 | `09-bench-state.png` → `10-after-rejoin.png` |
| 6 | 房间已被回收后的入房失败 | 空房超 5 分钟被服务端回收后，用邀请码 B5882E16 再次加入 | 表单内联错误「房间不存在或已过期」，昵称 `AccHostRot` 与邀请码**全部保留**，可直接改码重试；进行中状态不吞错误（`joinError` 只在非 busy 且未持凭证时显示） | `20-host-rejoin2.png` |
| 7 | benchmark 包可用（R8 + 仅该变体放行 HTTP） | 装 `com.listentogether.app.benchmark`，加入页填昵称/8 位邀请码/云端 HTTP 地址 | 加入页「扫描邀请二维码」按钮在位、手动邀请码可用；`http://8.166.126.136:3000` 未被拒；建房 → 选歌 → 播放后 `dumpsys media_session` 为 PLAYING、位置前进 | `13-benchmark-nobtn.png`、`16-benchmark-host-room.png`、`17-benchmark-playing.png`、`msession.txt`、`ms-now.txt` |
| 8 | 滚动帧耗时 A/B | 播放中，`gfxinfo reset` → 脚本化快滑歌单 → 取计数；两包跑同一套脚本与同一曲目 | 见下表 | `gfx-r8-benchmark.txt`、`gfx-debug-current.txt` |
| 9 | 相机扫码入房 | —— | **未执行**：需要人工把手机对准显示器上的二维码，本轮之后无法提供真机 | —— |
| 10 | 双人同屏（脚本成员 + 房主）/成员展开 180dp 滚动 | —— | **未执行**：见「环境限制」第 2 条 | —— |
| 11 | 空歌单、2 倍系统字号、小屏布局 | —— | **未执行** | —— |

### 滚动帧耗时（同条件 A/B，播放中滑动歌单）

| 包 | 快滑（连续 8 次） | 带 1s 停顿（4 次） | 快滑 P50/P90/P95 | 带停顿 P50/P90/P95 |
|---|---|---|---|---|
| benchmark（R8 优化，`08607981…`） | 777 帧 / 6 掉帧 = **0.77%** | 616 帧 / 1 掉帧 = **0.16%** | 10 / 13 / 14 ms | 11 / 15 / 16 ms |
| debug（当前源码，`9C480583…`） | 731 帧 / 56 掉帧 = **7.66%** | 624 帧 / 13 掉帧 = **2.08%** | 16 / 28 / 34 ms | 14 / 22 / 25 ms |

- 这一对是**本轮唯一同协议、同脚本、同曲目、同时段**的对照，结论是：上一轮记在 debug 包上的 27.27% / 13.38% 不能外推到用户实际拿到的 R8 构建；给用户的构建里歌单滑动掉帧率已在 1% 量级，P95 帧耗时 14–16 ms（60Hz 预算内）。
- 跨轮次对比（上一轮 debug 27.27%/13.38% vs 本轮 debug 7.66%/2.08%）只能算倾向性证据：帧总数不同（242/142 vs 731/624）、曲目与滑动节奏不完全一致，不作为"已优化 X%"宣称。
- `Janky frames (legacy)` 一栏 debug 高达 31.19%/12.50%，是旧口径把 >32ms 全算掉帧，仅作参考。

## 播放态文字显示疑点（未定性，承载面已删除）

> **2026-09-26 证据复核更正**：以下保留当时推断，但不能再作为已证实的播放器缺陷引用。`label-lag.py` 未检查 dump 退出码/成功标志，也未清除旧 `/sdcard/u.xml`；动画期间 dump 失败会重读旧树。逐张复核本目录 `17-benchmark-playing.png`、`18-benchmark-playing-check.png`、`19-benchmark-ui-vs-session.png`，MiniPlayer 均实际显示「播放中」。这些截图不与全部 13 次采样严格同刻，不能证明每次均正常，但足以撤回“持续显示已暂停”及归因 `PlaybackView` 的确定性结论。脚本已修复；无新真机重测。删除文案是用户选择，继续保留；未来本机状态/歌词功能需独立验证，不以本旧记录推断必然失败。


真机观察到：MiniPlayer 副标题持续显示「已暂停」，而 `dumpsys media_session` 同时刻是 `PLAYING` 且位置在前进——159 秒配对采样（`label-lag.py`，每 5 秒同时读界面文案与播放器位置）13 个样本全部为「界面=已暂停 / 播放器=PLAYING」，位置从 12.7 s 走到 157.9 s；点 ▶ 键能正常出声与恢复。矛盾在于展开页 `21b-sheet-try2.png` 又显示「播放中」且是暂停图标（该值取服务端 `room.playing`），说明房间意图为真，异常出在本机 `PlaybackView.playing` 这一路观测上（该值只由 `Player.Listener.onEvents` 刷新，叠加 `ForwardingSimpleBasePlayer.getState()` 的命令透传改写）。

**这不是本轮改动引入**：`playbackLabel` 与控制器接线本轮未触碰，上一批次 A 真机验收时该文案未被逐项采样过。

处置：2026-09-26 按用户指示删除「播放中/已暂停」状态文案、展开页「当前歌曲 + 状态」行与「播放与暂停同步给所有人」说明，该显示面不再存在，疑点随之关闭；**根因未做诊断**，剩余的本机观测只用于 `showStatusNotice` 的音频错误判定（`playerError` + `mediaId` 匹配），播放/暂停判定一律取服务端快照。若后续要恢复任何"本机是否出声"的显示，需先把这条 `isPlaying` 通路查清。

删除后保留的可见反馈：异常/连接中/本机暂停/非默认消息仍由状态横幅承载（`StatusBanner`，含「立即重试」「重新加入房间」「退出房间」入口），当前曲与播放/暂停态由歌单行高亮 + `PlayingIndicator` 动效条 + 播放键图标表达。

## 环境限制（如实记录）

1. **无第二台设备**：双人场景需本机演示后端 + `adb reverse tcp:3000` + `node scripts/member-sim.mjs`；本轮 PC 侧访问公网 `8.166.126.136` 被安全策略拦截，而 `media/catalog.json` 为空，本机后端起不来可用曲库，故未搭。
2. **ColorOS 后台网络切断**：App 退到后台约 1 分钟即被断 WS，服务器 60 秒后移除成员、5 分钟回收空房——同一台手机上的 debug 与 benchmark 两包**无法同时在线**，这直接造成场景 11 不可执行（也顺带把场景 5/6 的失效与重入路径跑出来了）。
3. **benchmark 包不可调试**：`run-as` 返回 `package not debuggable`，性能包拿不到本机诊断 JSONL，播放器真实状态只能靠 `dumpsys media_session` 与截图。
4. **文本注入受限**：`adb input text` 打不进非 ASCII 且吞 `://`（需整段引号包 URL），清空多行框要 `KEYCODE_MOVE_HOME(122)` + `KEYCODE_FORWARD_DEL(112)`（`MOVE_END(123)` 只到行尾，纯 `DEL` 卡住）。因此**昵称 emoji/代理对截断只在单测层面验证**（`DisplayNameTest`），未做真机目视。
5. **权限受限**：`settings put global low_power` / `settings put system user_rotation` 对 shell 抛 SecurityException（未授予 WRITE_SECURE_SETTINGS），强制重建 Activity 改用 `cmd uimode night yes|no`。

## 本目录物料

- 日志：`gate.log`（86 项通过稿）、`gate-2.log`（84 项删提示后终稿）、`benchmark-build.log`、`benchmark-build-2.log`
- 帧耗时原始输出：`gfx-r8-benchmark.txt`、`gfx-debug-current.txt`（每个文件含两段：快滑 + 带停顿）
- 播放会话快照：`msession.txt`、`ms2.txt`、`ms-now.txt`（`dumpsys media_session`）
- 客户端诊断：`diag-host-2311.jsonl`、`diag-host-latest.jsonl`、`diag-host-final.jsonl`；`diag-benchmark.jsonl` 是 `run-as` 拒绝的记录（限制 3）
- 二维码反解：`qr-decoded.txt`
- 复测脚本：`dev.py`（adb 包装 + UTF-8 输出）、`measure.py`（滑动帧耗时）、`label-lag.py`（界面文案 vs 播放器配对采样）、`h.sh`
- 过程截图：`00-` … `21b-`（编号即时间顺序，场景表中已引用的为主要证据，其余为过程留痕）
- 装机一致性样本：`installed-benchmark.apk`（`pm path` 拉回的 benchmark 包，SHA256 = `08607981…`）
