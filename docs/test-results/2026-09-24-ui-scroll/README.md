# UI 试用反馈：布局、滚动与歌单长图

- 日期：2026-09-24；操作者：Codex。
- 状态：本地构建/73 项测试/Lint/链接通过；PHQ110 真机公网歌单/滚动/PNG 保存已测，系统原生长截屏与播放中听感仍待验。
- 范围：Android 页面与导出功能、测试和文档；未改后端、未部署、未修改音频同步参数。
- 输入：用户提供的四张 PHQ110 截图及「歌单下滑卡顿、不支持长截屏」反馈。

## 代码定位与改动

1. PlaybackService 每 500ms 调用 updatePosition，原 Activity 根级 collectAsState 随之刷新；LazyListScope 内每次重算全曲库过滤。将页面流与位置流分开订阅，按 tracks/query 缓存过滤结果，独立歌单行与 contentType。此为静态发现的开销来源，尚无证据证明用户手机卡顿只有这个原因。
2. 首页欢迎卡与分段切换、左对齐房间顶栏、紧凑无阴影播放卡（播放按钮与标题同排）、8dp 行间距、正确的大屏限宽；保留字号缩放和最小触控区域。
3. 系统长截屏：本地 Gradle 缓存 `ui-android/1.8.0/*/ui-android-1.8.0-sources.jar` 中 AndroidComposeView 在 SDK>=31 创建 ScrollCapture，onScrollCaptureSearch 遍历滚动语义；未添加过时实验开关，未改变系统截屏协议。
4. 歌单标题旁增加「保存长图」，原生文件创建器选择 PNG 保存位置。导出冻结的全部搜索结果、当前标记、房间码，长曲名换行，IO 线程编码；最大 1080×12000，超过明确报错不截断，失败清理新建空文档。保存器与待保存快照位于 Activity 组合域，列表滚出可见区域不会取消回调。

## PHQ110 真机验收（2026-09-24）

- 安装 APK SHA256 `B4833B95AAA278E8AFA946AB2D78786572A95A35A3622C8E704102B8FFB59431` 成功；USB 上出现无序列号的 PHQ110 transport 时改用 `adb -t <transport_id>`。真实公网 room/catalog 打开成功，页面显示「已连接」、测试房间名 `ScrollCheck`、曲目「有何不可」、歌单 24 首。
- **滚动帧率（仅新版，未安装旧版作基线）**：省电 `0`，电量 49%，电池温度 33.8°C。连续快速手势（350ms、间隔 150ms，共 10 次）：290 frames，69 janky（23.79%），p50 27ms / p90 44ms / p95 57ms / p99 97ms，Missed Vsync 9。自然间隔手势（300ms、每次后停 900ms，共 10 次）：629 frames，53 janky（8.43%），p50 15ms / p90 29ms / p95 34ms / p99 44ms，Missed Vsync 6。节奏不同不能作为改动前后对照；结果说明快速连滑仍会掉帧。两组测试期间房间播放暂停，没有测播放中的听感或音频欠载。
- **长图保存**：系统文件选择器在 Downloads 成功创建 `一起听歌-C2C07981.png`，并从设备拉回本目录；PNG chunk CRC 和 zlib 解码完整，尺寸 **1080×3001**、24 首、135,813 bytes，SHA256 `7288CDFED497C283977699DC4EA3D613805F93108BD87D41DD1C3DD04F3BFD8D`。可直接查看[公网歌单长图](public-playlist.png)。
- 两轮测试房间均通过退出确认返回入房页，手机前台停在无房间页面。服务端空房会话按既有行为最多 5 分钟回收。
- 尚待：与同设备旧 APK 使用同样手势/刷新率/温度做基线；播放中滚动并听感/诊断核对；ColorOS 系统截图界面是否给 LazyColumn 显示「长截屏」入口。设备性能数据和文件导出数据均有本轮实测，结论只对 PHQ110/当前设置。

## 帧率样本与导出文件

手势序列原始汇总（`dumpsys gfxinfo` 在手势前 reset）：

| 手势 | 动作节奏 | 总帧 | 卡帧 | p50 / p90 / p95 / p99 | Missed Vsync |
|---|---:|---:|---:|---:|---:|
| 快速连滑 | 300ms swipe + 150ms 间隔，10 次 | 290 | 69（23.79%） | 27 / 44 / 57 / 97 ms | 9 |
| 自然间隔 | 300ms swipe + 900ms 间隔，10 次 | 629 | 53（8.43%） | 15 / 29 / 34 / 44 ms | 6 |

本表两行不是版本对比，不能计算本轮代码带来的收益。用同一支设备与 24 首曲库实测，快速连滑仍能复现卡帧。导出文件保存在测试记录目录；测试副本通过 PNG 全 chunk CRC、IDAT 解压、宽高范围校验。SHA256：`7288CDFED497C283977699DC4EA3D613805F93108BD87D41DD1C3DD04F3BFD8D`。

## 自动化

构建命令（项目根目录）：

```powershell
.\android\gradlew.bat -p android :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug --console=plain
.\scripts\check.ps1 -Scope docs
```

- ScreenStateTest 3 项：101 次位置采样只输出一个屏幕结构状态；曲库/断线/暂停/退出透传；seek 的 room.version 与 room.positionMs 保留。
- 原有 70 项回归一并实跑，不以 UP-TO-DATE 当作测试通过。
- 构建过程发现并修正：nullable stateSaver 类型不匹配；Lint 拒绝在组合体直接读 StateFlow.value，初值改为 remember 的一次快照，后续由 Flow 收集驱动。
- 最终构建：BUILD SUCCESSFUL in 1m 17s；73 tests / 0 failures / 0 errors / 0 skipped；Lint `No issues found.`（0 错误、0 警告）。
- APK：`android/app/build/outputs/apk/debug/app-debug.apk`，SHA256 **B4833B95AAA278E8AFA946AB2D78786572A95A35A3622C8E704102B8FFB59431**。
- 证据：[构建日志](build.log)、[单测汇总](test-summary.txt)、[新增回归 XML](screen-state-test.xml)、[Lint](lint.txt)。文档链接检查通过，`git diff --check` 通过。

## 设备与尚待实测

PHQ110 经 USB/ADB 连接；本轮已安装、启动、进入公网歌单并退出测试房间；电池与省电状态及滑动 gfxinfo 已实测。真机系统长截屏、播放中听感、暗色/字号矩阵仍未覆盖。

恢复验收步骤：

1. 已测：同一 PHQ110、新 APK、24 首公网曲库、省电关、电池约 49%，暂停状态十次快速滑动与十次自然节奏滑动；详细数据在上节。需旧 APK 对照和播放中音频验收。
2. 已测：保存器选择 Downloads 并成功生成 PNG，整图 CRC/解压/尺寸完整；未覆盖搜索后保存、超过高度上限、取消和写入失败。
3. 待测：本机系统截图手势是否提供 ColorOS 长截屏入口；暗色、大字号与旋转矩阵。应用内 PNG 导出已验证，不能据此声称系统入口已修复。

清理：两轮公网测试房间均退出并返回入房页，无在线测试成员；服务端空房间按既有策略最多 5 分钟回收。未修改电源/显示设置，无故障代理。保留 APK、构建证据与 PNG 测试副本。
