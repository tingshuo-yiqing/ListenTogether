# 开发陷阱与规避清单

本文记录项目中**实际踩过**的问题（非理论风险），按"现象 → 根因 → 规避"组织。任何新会话开工前应通读一遍；踩到新坑必须回填本文，防止重复犯错。最近更新：2026-09-21。

## 1. Windows / PowerShell

### 1.1 .ps1 中文脚本解析失败
- 现象：`install-debug.ps1` 报"字符串缺少终止符"，整个脚本无法运行。
- 根因：PowerShell 5.1 对无 BOM 的 UTF-8 按 ANSI(GBK) 读取，中文乱码吞掉引号。
- 规避：**所有含中文的 .ps1 必须保存为 UTF-8 with BOM**。2026-09-21 已为 scripts/*.ps1 统一补 BOM；新建脚本时检查前三个字节是 `239,187,191`。

### 1.2 二进制输出经 PowerShell 重定向损坏
- 现象：`adb exec-out screencap -p > s.png` 得到的 PNG 打不开（GDI+ 报"内存不足"）。
- 根因：PS 5.1 把原生命令 stdout 当文本解码再编码，破坏二进制流。
- 规避：截图用 `adb shell screencap -p /sdcard/s.png` + `adb pull`；任何二进制数据不要用 PS 管道/重定向落地。

### 1.3 控制台中文乱码导致无法匹配文本
- 现象：Select-String / -match 中文常量匹配不到已经乱码的 uiautomator dump。
- 规避：命令里**避免直接写中文**。匹配 UI 文本用 Unicode 码点拼接（`-join @([char]0x7ACB,...)`），或改用控件类名（EditText/Button/SeekBar）+ bounds 定位。

## 2. 真机与 adb

### 2.1 USB 重插清空 adb reverse
- 现象：手机疯狂 ConnectException 重连失败，代理/后端完全正常，排查半天。
- 根因：USB 断开重连后 `adb reverse` 规则被清空，手机 127.0.0.1:3001 没有转发者。
- 规避：**每次 USB 重插后必须重新执行 `adb reverse tcp:3000 tcp:3000`（及 3001）**；故障注入测试前先 `adb reverse --list` 确认。排查"客户端连不上"时先查 reverse，再查代理。

### 2.2 adb 设备间歇性消失
- 现象：`adb devices` 空列表，`wait-for-device` 无限阻塞。
- 规避：用 `kill-server; start-server` + 有限次轮询（每次 4-5 秒），**不要用 wait-for-device 卡死命令**；连续失败再请用户检查授权弹窗/USB 用途选择框。

### 2.3 后端是内存态
- 规避：后端重启 = 房间与成员全部丢失，WS 握手 404 → 客户端正确进入 Expired。测试脚本不能假设重启后房间还在；重新入房前先把旧会话 leave 干净。

## 3. UI 自动化（uiautomator/input）

### 3.1 动态进度界面导致 dump 失效
- 现象：`could not get idle state`，dump 出来的是旧快照。
- 规避：播放验证以 `dumpsys media_session` 为准，UI dump 只用于静态布局；失败的 dump 标记无效，不当代证据（见 playback-test 文档）。

### 3.2 键盘弹起导致坐标漂移、输错字段
- 现象：昵称输入串进地址字段（"UITest2http://…"），创建房间按钮点空。
- 根因：IME 弹起压缩布局，固定坐标跨步骤失效。
- 规避：**每步操作前重新 dump 取 bounds**；文本输入后先 `input keyevent 111`（ESC 收起键盘）再点按钮；文本框先 `keyevent 123`（MOVE_END）+ 循环 DEL 清空再输入。

### 3.3 dump 抓到系统界面
- 现象：dump 全是"USB 调试已打开"等系统通知文本。
- 规避：dump 前用 `dumpsys window` 确认 mCurrentFocus 是本应用；误抓通知栏先 keyevent 4 收起。

## 4. Compose / Material3

### 4.1 API 弃用与签名陷阱
- `LocalClipboardManager` 已弃用 → 用 `LocalClipboard` + `setClipEntry(ClipEntry(ClipData...))`（suspend，需 rememberCoroutineScope）；注意参数是 **ClipEntry 不是 ClipData**。
- 方向敏感图标（ExitToApp 等）用 `Icons.AutoMirrored.Outlined.*`。
- 规避：构建出现 `w:` 弃用告警**当场修复**（项目规则：新增告警必须解释或修复），不积压。

### 4.2 "等服务端确认"造成的回跳型延迟
- 现象：进度条拖动松手后跳回旧位置 1-2 秒才到目标。
- 根因：UI 状态只有"拖动中"和"服务器进度"两态，松手即回落。
- 规避：需要服务器确认的操作采用**乐观预览 + 快照确认 + 5 秒超时提示**三段式（见 01 模块文档）；同时服务端动作落地后**立即上报一次状态**（不等周期 ticker），消除确认与周期刷新之间的闪烁窗口。此模式可复用于任何"操作 → 等广播"的 UI。

### 4.3 LazyColumn 里持状态
- 规避：跨 item 共享的可变输入放 `remember` 的状态类（如 JoinInput）并在 setContent 层创建，不要在各 item lambda 里各自 remember。

## 5. 协程与 JVM 单元测试

### 5.1 测试调度器与生产调度器语义不同
- 现象：join 内部 leave 的 DELETE 在测试里被排到 join 完成后才执行，响应队列顺序错乱、用例失败。
- 根因：UnconfinedTestDispatcher 把**嵌套 launch 排进事件循环**；生产 Main.immediate 立即执行。
- 规避：假传输层测试**不要断言跨协程的请求顺序**（如"DELETE 必须在 POST 之前登记"）；按"每个协程按需消费响应"设计队列；差异已记录在 02 模块文档。

### 5.2 runTest 被无限循环卡死
- 现象：校时循环每 5 秒 delay 永久续期，runTest 永不结束直至超时。
- 规避：打开过 Socket 的测试**结束时必须 client.leave()**（取消 syncJob/reconnect）；新增常驻协程时检查测试收尾。

### 5.3 advanceTimeBy 不执行恰好落在边界的任务
- 规避：需要触发"t 时刻"的任务时 `advanceTimeBy(t + 1)` 或补 `runCurrent()`。

### 5.4 依赖与桩
- JVM 单测用 org.json：android.jar 桩会抛 "not mocked"，已加 `testImplementation("org.json:json:20240303")`；新用例若触到 Android 类，先抽象边界（Clock/Transport/Store/Diagnostics 模式，见 RoomClient）而不是 mock 框架。
- okhttp WebSocket 假实现要同时覆写 `send(String)` 与 `send(ByteString)`。
- coroutines-test 的 API 需要 `@OptIn(ExperimentalCoroutinesApi::class)`，不要留 opt-in 告警。

## 6. 设计与流程纪律

- **行为约定优先**：UI 优化不得违反"服务端为播放唯一来源、明确点击才能解除本机暂停"（README）。乐观预览只改显示，不提前改播放器/房间状态。
- **同一次交付同步更新**：代码 + 单测 + 模块文档 + verification.md；漏文档的交付等于没交付。
- **真机结论必须有操作步骤与实测数据**（test-results 目录）；单测通过 ≠ 真机验收，挂起项显式标注（如 M2 缺第二台手机）。
- **APK hash 每轮记入 verification.md**，历史 hash 保留，用于回溯"哪版引入的问题"。
- **故障注入先于修复**：构造失败场景再改代码，避免无依据的大规模重写（计划第 3 节原则）。
- **短测试音会掩盖音频错误与长时问题**：本机环回下 ExoPlayer 会一次性缓冲 30/45 秒的 demo 测试音（buffered position = 文件全长），停后端或改名不再产生 HTTP 请求，401/404/断流错误无法触发；30 分钟息屏/60 分钟播放也需要足够长的测试音。规避：已加入 `demo-media/demo-long.mp3`（40 分钟 220Hz 单声道 32kbps，ffmpeg 合成），音频错误注入时改名该文件并拖动进度到未缓冲区域；新增长测试音后必须**重启演示后端**才会加载进曲库。
