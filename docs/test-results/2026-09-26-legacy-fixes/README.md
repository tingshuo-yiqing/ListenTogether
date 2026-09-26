# 遗留问题逐项复核与修复（2026-09-26）

执行者：Codex；工作区：D:/ListenTogether。保留本轮开始前已有的未提交改动，无 git 提交，无云端变更。

## 核对清单

| 来源/问题 | 处理与结论 | 验证边界 |
|---|---|---|
| verification 待办：InviteCode.HINT 引导复制后直接加入 | 改为「打开 App 扫描邀请二维码，或手动输入房间码加入」；沿用二维码/手动入口 | 旧口令解析兼容；未真机扫码 |
| InviteCode 注释承诺不截长码，实现却缺少尾部边界 | 8 位码后增加负向字母数字检查，9 位及更长错误码返回 null | 新增错误后缀/标点兼容 2 项测试 |
| verification 批次 A 遗留：全员离线清扫残留旧 hostId | 到期没有在线成员则清空 hostId；没有现存房主时首个 connect 广播前立即补位 | 新增 3 项测试，覆盖 59,999/60,000ms、无重复事件、权限立即生效与空房恢复；未部署 |
| 模块 03/04 承诺 load/seek/暂停复位倍速，代码仅复位缓存 | 删除 catchupSpeed 缓存，以实际 PlaybackParameters.speed 决策并写回；换曲、seek、共享暂停/本机暂停都复位 | 新增 5 项策略测试；未新增真机听感或双机同步结论 |
| 夜轮“PlaybackView 持续暂停”疑点 | 撤回确定性归因，修复 label-lag.py 忽略 dump 失败及重读旧文件的问题 | 3 项离线 mock 测试；13 次旧样本无法追溯验证，不宣称播放器通路绝对无缺陷 |
| 路线图/模块仍列 M3-LONG 挂起、同步滞回区描述错误、偏好持久化描述过期 | 根据既有实测记录与当前源码纠正；历史记录保留并追加更正 | 文档链接及 diff 检查 |

## 播放显示证据复核

旧脚本 `../2026-09-25-night-acceptance/label-lag.py` 在动画期间调用 uiautomator dump，忽略退出码/成功标志，然后读固定 `/sdcard/u.xml`。失败时旧文件仍在，13 次“已暂停”不能当作新鲜界面事实。

本轮逐张查看以下原始截图，MiniPlayer 副标题实际均为「播放中」，播放键为暂停图标：

- [17-benchmark-playing.png](../2026-09-25-night-acceptance/17-benchmark-playing.png)
- [18-benchmark-playing-check.png](../2026-09-25-night-acceptance/18-benchmark-playing-check.png)
- [19-benchmark-ui-vs-session.png](../2026-09-25-night-acceptance/19-benchmark-ui-vs-session.png)

截图与全部 13 次采样并非逐时刻配对，不能排除曾发生其他异常；可确认的是旧记录不足以锁定 Player.Listener 或 ForwardingSimpleBasePlayer 为根因。保持用户要求的精简界面，未来本机状态/歌词仍须独立验证。

脚本现在先删旧树，检查 dump 成功再读取，失败返回「无效采样」，缺少已删除文案返回「无状态文案」。主程序加 __main__ 守卫，离线导入测试不会操作设备。

## 测试与产物

- 后端：`scripts/check.ps1 -Scope server`，tsc 通过，23/23 测试通过。修复前新增用例实跑 21/23：旧 hostId 非空、重新上线未立即获得房主两处失败；修复后全部通过。
- 安卓：`:app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:assembleBenchmark --console=plain`。本轮 XML 汇总 91 项，失败/错误/跳过均 0；Lint issues=0，BUILD SUCCESSFUL in 9m 17s，实际退出码 0。测试、lintReportDebug 与 minifyBenchmarkWithR8 均实跑。
- 采样脚本：`python docs/test-results/2026-09-26-legacy-fixes/test_label_sampling.py`，3/3 通过，纯 mock，无 adb 操作。
- 门禁证据：`gradle.stdout.log`、`gradle.stderr.log`、`gradle.exit.txt`；测试计数来自本轮 cleanTest 后生成的 XML，Lint 报告先删再生。

## 外部条件与未覆盖项

- 无真机：新 APK 未装机；扫码、双人同屏、2 倍字号、小屏/空歌单、emoji 目视、滚动中切歌、手感继续挂起；M2 双机精度不能用脚本成员替代。
- 本轮后端变更未部署，云端仍以此前 20260924-0937 记录为准（本轮未实时核查）。重启会清空房间，部署验收单独安排。
- TLS/域名沿用用户此前挂起决策；真实令牌作废入口、反应互动、歌词属于新功能，不把本轮遗留修复扩成协议开发。公网弱网/蜂窝、升级失败注入继续保留待测。
- 未改变同步阈值、服务端播放唯一来源、明确点击才解除本机暂停等行为约定。

## 清理

只运行本地自动化，无设备/云端操作、无故障注入、无临时线上房间；测试服务器由测试钩子关闭。构建日志与回归脚本保留在本目录。

## 本轮交付锚（均未装机）

| 变体 | SHA256 | 用途 |
|---|---|---|
| debug | `EC5FCF0A987D10087CE88CEC228CF4509CDCC5B4E6D06E0CC79662005A4C4870` | 调试/试用 APK，23,049,926 字节 |
| benchmark | `F943E3CA4942B84E23169CF0927A07BE11D607329F27DA86B27225F894E2438B` | R8 性能测试专用，不分发，2,429,597 字节 |

机器可读计数与 hash 见 [summary.json](summary.json)。旧 APK 锚保留在 verification 历史表；本轮未重新执行任何真机场景。R8 构建耗时约 9 分钟，线程采样确认期间仍在优化，日志存在输出缓冲，不能据短时间无日志断定卡死。

## 补充小轮：本地审计收尾两处修复（2026-09-26 下午）

用户指示先修不用真机的问题、后统一测试。本小轮为同日补充，无设备、无云端操作，上文主轮记录不变。

### 修复内容

1. **seek 确认窗口改用单调时钟**（`ui/RoomPlayer.kt`）：确认窗口"发起以来的流逝时长 + 1500ms"此前用 `System.currentTimeMillis()` 差值度量，系统对时跳变会瞬间膨胀/收缩窗口。改为 `SystemClock.elapsedRealtime`（`nowMs` 注入保持可测），并把确认判定抽成纯函数 `seekConfirmed(target, snapshotVersion, pendingSeekVersion, snapshotPositionMs, elapsedMs)`：快照版本必须新于发起时刻记录的版本，且位置与目标贴合（相对贴合，沿用 E-07 相对推进量口径）。全局排查后主源码不再有 `System.currentTimeMillis()` 做流逝度量的残留。
2. **过期横幅「重新加入房间」补昵称合成**（`MainActivity.kt`）：`onRejoin` 此前把原始输入昵称直接传给 `join`，绕过 `composeNickname`（emoji 头像前缀选择器 + 24 码元截断）；改为 `composeNickname(null, input.name)`，与服务端 ≤24 码元校验一致，重新加入不再因长昵称被 400 拒绝。

### 新增测试

`SeekConfirmTest` 4 项：旧/同版本快照永不确认；窗口内确认（含 elapsed 抵消远位置的边界）；远位置需播放推进进入窗口；elapsed 为负不能确认任意位置。

### 门禁（实跑）

- 后端：tsc 0 错误，**23/23**。
- Android：`cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:assembleBenchmark`，退出码 0（gradle-2.exit.txt），**96 项实跑、0 失败/0 错误/0 跳过**，Lint 报告先删再生 issues=0，BUILD SUCCESSFUL in 4m 3s。证据：`gradle-2.stdout.log`、`gradle-2.stderr.log`、`gradle-2.exit.txt`。
- **计数口径更正**：主轮登记的"91 项"按测试文件归类少计 1 项——`DisplayNameTest.kt` 一个文件内含 `DisplayNameTest`(10) 与 `AvatarGlyphTest`(2) 两个测试类，JUnit XML 按运行时类名拆分。主轮真实基线为 92，本轮 96 = 92 + 4（SeekConfirmTest）。本轮 XML 全部 17:02 新生成，无旧文件混入。

### 本小轮交付锚（未装机）

| 变体 | SHA256 | 用途 |
|---|---|---|
| debug | `517A776B05C30EEBF2E7A0E2B68FE315F959748F0C3C8057FC20B975B69D98A3` | 调试/试用 APK，23,049,926 字节 |
| benchmark | `764D0FE19B27DEC71EA629115297CE1D74911DF1E782F775A2282F149239F1B8` | R8 性能测试专用，不分发，2,429,597 字节 |

seek 真机听感（拖动→快照确认→5 秒兜底横幅）与扫码入房等设备项按用户指示留待统一测试。
