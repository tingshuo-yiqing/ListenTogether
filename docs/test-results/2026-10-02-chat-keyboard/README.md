# 聊天键盘与歌曲栏优化（2026-10-02）

键盘弹出时收起底部歌曲栏，让聊天输入框靠近键盘；关闭键盘后恢复歌曲栏。MuMu 的浅/深主题、实际输入/发送、队列/点歌及播放连续性通过。PHQ110 本轮无在线连接，新布局真机观感待验。

## 实现

原 Scaffold 整体 imePadding 会把 bottomBar 中的 MiniPlayer 一起抬到键盘上方。MainActivity 保留 IME 避让，歌曲栏仅在 `WindowInsets.ime.getBottom(LocalDensity.current) == 0` 时显示；Manifest 明确 `windowSoftInputMode="adjustResize"`。使用实际占用高度，实体键盘或模拟器零高输入法不误收歌曲栏。

播放器状态、Controller 与 Service 接线保留在显示条件之外；键盘开关只改变布局，草稿、发送和播放逻辑未改。点歌搜索同样适用。产品改动仅 MainActivity/Manifest 两个文件，无新增产品依赖。

只读参考 [AndroidX WindowInsets 源码](https://github.com/androidx/androidx/blob/androidx-main/compose/foundation/foundation-layout/src/androidMain/kotlin/androidx/compose/foundation/layout/WindowInsets.android.kt) 和 [Android 官方 IME 避让说明](https://developer.android.com/develop/ui/compose/system/insets-ui)。ui-ux-pro-max 对键盘查询无对应条目，具体实现按官方 API；未复制第三方代码。

## 门禁与版本

- 安卓强制实跑 **180 项 / 24 套件**，失败/错误/跳过均 0；assembleDebug 通过、Lint 0。见 [build-results.json](build-results.json)、[构建日志](android-check.log)、[JUnit](junit/)、[Lint XML](lint-results-debug.xml)。删除旧 Lint 报告后本轮生成。
- APK **21,787,637 字节**，SHA256 `041b42955fb8bf6b740960e5032bb3c0c9e8c0e8932304d8ac70e5693aa3c753`；MuMu 安装及回拉字节数/哈希一致。固定交付副本 `.workbuddy/chat-keyboard-debug.apk`，避免后续构建覆盖已验版本。
- 180 项包含工作区现有 TrackMetadataTest 3 项，不算作键盘新增测试或元数据专项验收。本轮未新增镜像布尔表达式的 JVM 用例，IME 交互通过真实窗口与输入验证；服务端/脚本未修改、未重跑门禁。

## MuMu 实测

MuMu Android 15 / API 35，1080×1920，transport `127.0.0.1:16384`。独立 ADB 端口 5038，3002 后端只读 demo-media 合成长测试音；一个持 WS 的脚本房主和 MuMu 成员参与，未重启 3000 调试后端或接触真实 media/。

| 场景 | 结果与截图 |
|---|---|
| 原版 89E90EEB… 弹键盘 | [原版](before-keyboard.png)：歌曲栏夹在输入框与键盘之间，输入框下沿距键盘 168px |
| 新版浅色弹键盘 | [优化后](after-light-keyboard.png)：歌曲栏收起，输入框距键盘 21px，发送按钮可见 |
| 输入与发送 | [草稿](after-light-draft.png)、[发送后](after-light-sent.png)：逐字输入 draft，真实服务端聊天确认到达，键盘保持显示 |
| 收起后恢复 | [浅色](after-light-restored.png)、[深色](after-dark-restored.png)：原歌曲栏恢复 |
| 深色键盘 | [深色](after-dark-keyboard.png)：输入框距键盘 21px、消息可读 |
| 队列与点歌 | [队列](after-queue.png)、[点歌](after-catalog.png)、[搜索键盘](after-catalog-keyboard.png)、[搜索恢复](after-catalog-restored.png)：歌曲栏正常显示/收起/恢复，搜索框可见 |
| 播放期间开关键盘 | [播放时键盘](playing-keyboard.png)：MediaSession 三次均 PLAYING，位置 2887 → 5892 → 10951ms；[恢复](after-playback-restored.png) |

15 组布局/窗口检查通过，见 [device-results.json](device-results.json)、[设备日志](device-check.log)。浅深及播放截图已人工查看；UI XML、IME/window 转储和 playing-*-media.txt 一并留档。几何检查确认实际 IME 正高度、歌曲栏专属播放控件缺席、聊天输入框距键盘 0–50px、关闭后恢复；输入/播放另与服务端消息和 MediaSession 进度对账。

MuMu 自带 Sogou 的 visible=true 对应零高窗口，不能算可见键盘。临时使用 [Simple Keyboard 官方发行包](https://github.com/rkkr/simple-keyboard/releases)，来源/版本/哈希见 [keyboard-dependency.json](keyboard-dependency.json)。已切回原 Sogou、卸载本轮输入法、恢复 show_ime_with_hard_keyboard=0、旋转 1/1/free，并停止合成后端、移除 3002 reverse；设置复查见 [cleanup-results.json](cleanup-results.json)，测试输入法不随项目分发。

初始仪器问题留在 [初始记录](initial-zero-height-ime/)：零高 IME、可选 visibleFrame 字段、同名曲目造成播放器误判、默认 ADB 中途重启。改为核对实际高度和截图、按专属播放按钮识别、独立 ADB 后完整复跑通过。规避已回填 [开发陷阱](../../development-pitfalls.md)，未把仪器失败改写为产品通过。

## 边界与复跑

未安装到 PHQ110、未部署云端、未提交 Git、未调同步参数。系统字号/小屏、TalkBack、弱网、双真机等保留原待办，本轮只判 MuMu 当前竖屏配置。

[构建助手](tools/build-check.py)、[设备助手](tools/device-check.py)、[合成实例](tools/fixture-backend.mjs)。设备复跑需 `.workbuddy/keyboard-before.apk`、固定交付 APK 和临时输入法 APK，原始设置与下载元数据已归档。最终 `node scripts/check-doc-links.mjs` 与 `git diff --check` 通过。
