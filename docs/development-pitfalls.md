# 开发陷阱与规避清单

本文记录项目中**实际踩过**的问题（非理论风险），按"现象 → 根因 → 规避"组织。任何新会话开工前应通读一遍；踩到新坑必须回填本文，防止重复犯错。最近更新：2026-09-22（新增 2.7 无线 adb 通道实测打通；第 7 节为 Windows 路径/cmd 静默失效/曲库启动时加载等四条）。

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

### 1.4 PowerShell 5.1 不支持三元/空合并等 7+ 运算符（2026-09-22）
- 现象：脚本里写 `($x -eq "" ? "a" : "b")`，PSParser 报"表达式中包含意外的标记'?'"，整个脚本无法解析。
- 规避：项目脚本以 Windows PowerShell 5.1 为准——禁用 `?:`、`??`、`??=`、`?.`，条件取值改用 if 语句；新脚本交付前跑一次 PSParser 静态检查（见 m3long-sample.ps1 本轮修复）。

### 1.5 check.ps1 的 Stop 偏好遇外层输出重定向 + Gradle 锁残留（2026-09-22）
- 现象：外层 `& check.ps1 *>&1 | Out-File` 跑到 Gradle 阶段即抛**空消息异常**（"EXCEPTION: "后无内容）；之后单独重跑 gradle 报 `fileHashes.lock (拒绝访问)`，构建无法启动。
- 根因：①脚本内 `$ErrorActionPreference='Stop'`，PS 5.1 下外层流重定向把原生命令的 **stderr 进度行**（Gradle Daemon 启动提示）转成终止错误；②被中断的运行残留 Gradle Daemon，持有 `~/.gradle/caches/8.11.1/fileHashes/fileHashes.lock`。
- 规避：跑 check.ps1 **不做外层流合并重定向**；需要落盘证据时按阶段直跑、stdout/stderr 分文件输出（另注意 PS 5.1 的 `2>` 产出 UTF-16，读取前先 iconv）；锁冲突先 `gradlew --stop`（tasklist 确认无 java 进程）再重跑，**残留锁文件本身无需删除**。

## 2. 真机与 adb

### 2.1 USB 重插清空 adb reverse
- 现象：手机疯狂 ConnectException 重连失败，代理/后端完全正常，排查半天。
- 根因：USB 断开重连后 `adb reverse` 规则被清空，手机 127.0.0.1:3001 没有转发者。
- 规避：**每次 USB 重插后必须重新执行 `adb reverse tcp:3000 tcp:3000`（及 3001）**；故障注入测试前先 `adb reverse --list` 确认。排查"客户端连不上"时先查 reverse，再查代理。

### 2.2 adb 设备间歇性消失
- 现象：`adb devices` 空列表，`wait-for-device` 无限阻塞。
- 规避：用 `kill-server; start-server` + 有限次轮询（每次 4-5 秒），**不要用 wait-for-device 卡死命令**；连续失败再请用户检查授权弹窗/USB 用途选择框。
- 加重形态（2026-09-22）：设备在 device/offline/消失间**秒级抖动**，换口换线只能换来几秒稳定窗口，交互式测试（入房→注入→观察横幅）必然中途断；且每次 USB 重插清空 adb reverse（2.1），手机侧连接也会中断污染证据。规避：这种形态下不要硬跑交互测试——改用**无线调试**（手机开发者选项 → 无线调试 → 使用配对码配对，`adb pair <ip>:<port>` 输入 6 位配对码后 `adb connect`），物理链路不再参与；配对前先把手机与电脑接入同一 Wi-Fi。具体流程、实测数据与无线专属陷阱见 2.7。

### 2.3 后端是内存态
- 规避：后端重启 = 房间与成员全部丢失，WS 握手 404 → 客户端正确进入 Expired。测试脚本不能假设重启后房间还在；重新入房前先把旧会话 leave 干净。

### 2.4 OPPO 息屏挂起后台网络 + 60 秒成员清扫（2026-09-22）
- 现象：息屏数分钟后客户端 WS 报 EOF，1 秒退避重连即收到 404 → Expired，远快于 60 秒宽限期的预期。
- 根因：息屏期间 OPPO 挂起后台网络，服务端 15 秒心跳收不到 pong 先 terminate；成员离线满 60 秒被 `store.tick()` 清扫。客户端半开 TCP 迟迟才发现，重连时房间/成员已清。
- 规避：这是设计内失效路径，不要按 bug 排查。需要长时后台测试时先 `svc power stayon true`（USB 供电下保持亮屏）或加电池优化白名单；分析"快速 Expired"时先核对服务端心跳/清扫时间线，再核对客户端 EOF 时刻。

### 2.5 OPPO 前台应用会查杀后台播放进程（2026-09-22）
- 现象：其他媒体应用到前台约 33 秒后，本应用进程被系统杀掉（连媒体前台服务通知都没豁免）。
- 规避：做焦点抢占类测试时，启动对方应用后 **2-3 秒内把本应用切回前台**（音乐应用会在后台继续播放并保持焦点占用）；每步采样前先 `pidof` 确认进程未变，防止把"新进程"数据当连续会话分析。此约束同样影响 M3-LONG 息屏方案，需提前申请电池优化白名单并实测。

### 2.6 OPPO 音乐全屏广告与进程重启后的空昵称（2026-09-22）
- 现象：切回本应用后 dump 到的是"入房页"，误判为状态被重置；实际一次是 OPPO 音乐全屏广告盖在前台，一次是进程真的被杀重启。
- 根因：ConnectionStore 按设计只持久化 baseUrl，令牌与昵称不落盘；进程重启后地址预填、昵称为空，带空昵称点创建房间会校验失败且后续坐标点击全部落空。
- 规避：每次冷启动/重启后**先 dump EditText 实际 text 再操作**；昵称必须重填（keyevent 123+DEL 清空校验，见 3.2）。uiautomator 报 idle 超时时 dump 是旧快照（见 3.1），先看 `mCurrentFocus` 属于哪个应用。

### 2.7 无线 adb 通道（2026-09-22 实测打通）
- 结论：**无线 adb 下 `adb reverse` 完全可用**，本项目"APP 填 127.0.0.1:3000 + reverse 转发"的架构不需要任何改动。实测（PHQ110 / Android 14，调试端口 192.168.43.15:41959）：`reverse --list` 同时列出 3000 与 3001；**设备端 `curl http://127.0.0.1:3000/health` 返回 `{"ok":true}`**（设备自带 `/system/bin/curl`，可用于隧道自检）。
- 一把梭：`.\scripts\connect-wireless.ps1 -DebugHost <IP:调试端口> [-Port 3000,3001] [-PairHost <IP:配对端口> -PairCode <6位码>] [-Install] [-Verify]`，一个进程内完成配对→连接→reverse→（可选）装 APK→（可选）设备端自检，并打印后续脚本该用的 `-Serial`。
- 坑 A：**配对端口 ≠ 调试端口**。配对用弹窗里的端口，connect/reverse 用"无线调试"页"IP 地址和端口"的端口；混填必失败。且**每次重开无线调试两个端口都会变**，脚本参数不能长期写死。
- 坑 B：**配对码有时效**，弹窗关闭即失效。本次首次 `adb pair` 报 `error: protocol fault (couldn't read status message)`，但同一台手机 `adb connect` 仍直接成功并显示 `device`（该电脑此前配对过，记录在 `%USERPROFILE%\.android`）。规避：**配对失败先直接 connect 试一次，不要反复重试配对**。
- 坑 C：**adb server 一重启，无线连接就没了，且不会自动恢复**。实测前一条命令刚 `connect` 成功，下一条命令开头即 `* daemon not running; starting now`，随后所有操作报 `device not found`。规避：**connect、reverse 与后续操作必须在同一条命令/同一进程内连续完成**。本机沙箱环境下每次工具调用都会回收 adb server（用户自己的终端窗口不受影响），这正是 connect-wireless.ps1 把四步写在一个脚本里的原因。
- 坑 D：**同一台手机会出现两个 transport**。配对成功后 mDNS 追加一条 `adb-xxxxxxx-XXXX._adb-tls-connect._tcp`，与 `IP:端口` 并存且指向同一台手机。`install-debug.ps1` 不带 `-Serial` 时按条数判断设备数，会报"连接了多台设备"；传 `-Serial` 即可，或 `adb disconnect` 掉多余那条。
- 坑 E：**`powershell -File` 传数组参数会被拼接**。`-Port 3000,3001` 实测变成 `30003001`，报 `adb.exe: error: cannot bind listener: bad port number '30003001'`。规避：connect-wireless.ps1 的 `-Port` 声明为字符串并按 `[,\s]+` 拆分；新脚本凡"逗号分隔多值"参数都按这条处理。数组参数只在交互式 PowerShell 提示符下直接调用时才正常。**同类**：`-PairCode 028776` 在提示符下会被当成数字丢掉前导 0（实际发出去的配对码变成 `28776`，配对必然失败），必须写成 `-PairCode '028776'`；connect-wireless.ps1 已做"不足 6 位左侧补 0"的兜底，但不要依赖它。
- 坑 F：无线链路**同样受 2.4 约束**——adb 不掉线，但 OPPO 息屏照旧挂起业务网络；长时测试仍需 `svc power stayon true` 或电池优化白名单。
- 存储注意事项：无线调试的配对记录保存在电脑 `%USERPROFILE%\.android`（adbkey），不要提交或外传；手机侧可在"无线调试 → 已配对设备"里撤销。

### 2.8 OPPO 息屏冻结无线 adbd：TCP 端口在、握手永远 offline（2026-09-22 实测）
- 现象：无线连接成功后数分钟内 `adb devices` 变 `offline`；重连报 10060/10061；端口扫描发现旧端口仍 TCP 可达，但 `adb connect` 永远停在 `offline`（20:46 连通 → 20:50 失联 → 21:01 后 30000-60000 扫描逐步无监听）。ICMP ping 一直通，说明 Wi-Fi 未断。当晚端口轮换实录：41559 → 39731 → 46888 →（人工亮屏）41145。
- 根因：与 2.4 同源——OPPO 息屏挂起后台。TCP 监听队列由内核维持（`accept` 还能完成），但 adbd 用户态进程被冻结，TLS/adb 握手无响应 → 永远 offline。端口还会随 adbd 重启轮换（41559 → 39731 → 46888），不能写死。
- 规避：**先让手机亮屏再连**（亮屏后 adbd 解冻，旧端口可能直接恢复，也可能换新端口，先扫一遍）。跑复验类长测试时脚本开头就要 `svc power stayon true`（m3-auth-recheck.sh 在链路建立后才设，链路建立前这一窗口同样会被冻结——亮屏是人工步骤，脚本救不了）。无 USB 备份通道时无法远程唤醒，只能人工解锁。
- 排查顺序：ping 不通 = Wi-Fi 断；ping 通 + 扫描无端口 = adbd 未监听（无线调试被关）或全冻结；端口通但 offline = adbd 冻结，亮屏重试。

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

### 3.4 Compose 输入框的 adb 自动化（2026-09-22，真机公网 E2E 因此暂停）
- 现象：入房页自动填地址/昵称连续失败：①dump 节点属性顺序是 **text 在 class 前**，`class="…"[^>]*text="…"` 定位恒空；②地址框有残留默认值时，tap 后光标停在点击处，`KEYCODE_MOVE_END(123)` 在 Compose TextField **无效**，DEL 只删光标前内容——多轮输入后地址框变成"新URL+Host+旧URL"拼接体；③`pm clear` 被 OPPO 拒（SecurityException，shell 无 CLEAR_APP_USER_DATA）；④`run-as … sed -i` 改 `shared_prefs/connection.xml` **静默失败**（before/after 相同，toybox sed -i 在 run-as 下行为待排查）。
- 规避（恢复 E2E 时照做）：
  - 定位：先 `grep -o '<node[^>]*>'` 拆节点，再按属性**独立过滤**（先 grep text= 再 grep class=）；字段顺序看源码（2026-09-23 起：创建/加入切换→昵称→邀请码〔仅加入〕→地址→主按钮；旧坐标不可复用）；定位一律在 IME 收起后 dump（IME 会压缩布局使 y 漂移）。
  - 有残留的输入框**不做 UI 编辑**：改走存储层——ConnectionStore 即 SharedPreferences `connection.xml` 的 `baseUrl` 键。`run-as rm shared_prefs/connection.xml`（删除而非 sed 改写）→ 重启 app 后地址框为空，空框输入无拼接问题；或手机手动输入（最快）。
  - 播放验证以 `dumpsys media_session` 的 PlaybackState 位置推进为准；FAB content-desc="播放"，点曲目行只选曲不播。
  - `svc power stayon true` 每次会话开头设置；用户报的无线端口可能是已关闭的配对端口（connect 拒绝 10061 时先看 mDNS transport 是否已在 device 态，配对记录在则无需配对码）。
- 状态：**未解决**，记录见 [test-results/2026-09-22-m4-public-test](test-results/2026-09-22-m4-public-test/README.md)。

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
- **压测/多成员脚本成员必须持有 WS**（2026-09-22）：服务端按"离线 60 秒"清扫无连接成员（store.ts:72 tick），空房间 300 秒后删除。纯 HTTP 的"假成员"先 401（成员被清）后 404（房间被删），表现为"前 60 秒成功之后全挂"。规避：load15.mjs 每名成员建立 WS 并保持（ws 客户端自动回 pong）；判断失败时间线时先对照服务端清扫/删除阈值。
- **长时任务要脱离工具进程树**（2026-09-22）：终端工具超时会连带杀死 Start-Process 启动的子进程（10 分钟负载第一次启动即被杀）。规避：用 `Invoke-CimMethod Win32_Process Create`（WMI 创建，非工具子进程）+ 输出重定向到文件，再轮询日志取结果。

## 7. 开发工具环境（2026-09-22）

- 现象：本次 exec_command 与 apply_patch 在读取项目文件前报 helper_unknown_error: setup refresh had errors。
- 定位：失败发生于 Windows 沙箱辅助进程初始化，尚未执行项目命令；具体环境根因未确认，不能归因于源码或 PowerShell 编码。
- 规避：先用最小只读命令确认；本次经工具审批的沙箱外命令可用，随后限定在项目内读取和编辑。不要盲目重装项目依赖；写入后核对 git diff 与文件编码。
- **Git Bash 外壳 PATH 损坏（2026-09-22 架构梳理时再次遇到）**：shim 脚本报 `dirname: command not found`、`cd: null directory`，随后 `ls/wc/find/cat` 全部 `command not found`，退出码却是 0，容易误判成"文件不存在"。规避：列文件/搜代码一律用 Glob/Grep/Read 专用工具（本次用它完成了全部源码核对）；必须跑脚本时用带绝对路径的解释器，例如 `C:/Users/ting/.workbuddy/binaries/node/versions/22.22.2-3/node.exe scripts/check-doc-links.mjs`，不要把失败输出当成 FS 事实。每条 Bash 命令开头 `export PATH=/usr/bin:/bin:$PATH` 可恢复 coreutils。
- **Windows 原生程序不识别 Git Bash 的 /d/ 路径（2026-09-22）**：ffmpeg/ffprobe 收到 `/d/ListenTogether/...` 报 `No such file or directory`，而同路径 `ls -l` 明明能看到文件（ls 是 MSYS 程序，会做路径转换）。规避：给 Windows 程序传参用 Windows 风格路径（`D:/ListenTogether/...`）或先 cd 进目录用相对路径；诊断"文件不存在"报错时先想路径转换，不要当成 FS 事实。
- **`cmd //c` 在 Git Bash 中静默失效（2026-09-22）**：`cmd //c "gradlew.bat ..."` 只打印 cmd 横幅就退出，构建根本没跑，退出码却是 0。规避：构建/Lint 用 PowerShell 工具执行；会话内 PowerShell 工具 stdout 可能不回显，命令末尾重定向到日志文件（`*>&1 | Out-File -Encoding utf8 <路径>; exit $LASTEXITCODE`），以退出码判成败、用 Read 工具读日志。禁止从 Bash 调 powershell.exe（安全策略拦截）。
- **演示后端曲库是启动时加载（2026-09-22）**：server 的 loadCatalog 只在启动读一次 catalog.json；往 demo-media 加测试音后必须重启演示后端才生效，不要误以为是文件没生成。

## 8. 云端部署（2026-09-22 首次部署实测）

### 8.1 个人音频随 demo-media 整目录误上云
- 现象：M4 首次部署后检查发现 demo-media 中的个人歌曲（有何不可.mp3）被带上服务器（catalog 未引用、API 不会提供，但违反"个人曲库不自动上传"约定）。
- 根因：package-deploy.ps1 对 demo-media 整目录 `-Recurse` 复制，任何临时放进该目录的文件都会进包。
- 规避：打包脚本已改为**按 demo-media/catalog.json 引用过滤**（只拷 catalog.json、README 与被引用的音频）；个人音频不要放进 demo-media，放 media/（不会被打包）。

### 8.2 sha256sum -c 报 "FAILED open or read" ≠ hash 不匹配
- 现象：校验 Node 二进制时报 `FAILED open or read`，误以为下载损坏。
- 根因：SHASUMS256.txt 登记的是原始文件名，下载时改名（如存成 node.tar.xz）后 sha256sum -c 按名字找不到文件。
- 规避：要么保留原始文件名下载，要么直接比对单值：`grep "  <文件名>$" SHASUMS256.txt | awk '{print $1}'` vs `sha256sum <本地文件>`。

### 8.3 `node -e` 模式 process.argv 不含脚本名占位
- 现象：部署验证脚本里 `node -e '...' "$CODE" "$TOKEN"` 后用 `process.argv.slice(2)` 取参，实际只取到了第二个参数——WS 连到 `ws://…/ws/<token>`，报 404（房间不存在），被误判成"鉴权后的 WS 被拒"。
- 根因：`node -e` 下 argv = [execPath, ...args]，没有 `script.js` 那一格；`node script.js a b` 才是 argv = [execPath, script, a, b]。
- 规避：`node -e` 场景取参用 `argv.slice(1)`；排查 WS 404 时先打印实际连接的 URL/房间号，再怀疑鉴权。
- 同类：PowerShell 传数组参数被拼接（陷阱 2.7 坑 E）同属"参数传递形态差异"，跨 shell 调脚本先验证参数实际到达形态。


### 8.4 UI 连接状态不能代表音频播放状态（2026-09-23）

- 现象：401 真机截图中错误文字旁仍是绿色成功点，暂停/错误时卡片固定显示“正在播放”；入房异常写入 message 后首页没有显示位置。
- 根因：横幅样式仅依赖连接状态，播放器标题写死，入房表单未消费错误信息。
- 规避：错误反馈覆盖首页与房间页；通过媒体控制器观测播放/缓冲/错误，按 mediaId 隔离旧曲目数据；正常连接摘要与播放错误分别显示。纯状态回归与真机视觉验收分开记录。

### 8.5 “云端入口不可达”实为同机其他负载 OOM 冻结整机（2026-09-23 凌晨实测）

- 现象：真机公网建房 timeout、手机/电脑访问 8.166.126.136:3000 均超时、SSH banner 也超时，当轮记为“云端入口不可达、不归因于 UI”。数小时后复查 TCP/HTTP/SSH 全部恢复正常。
- 根因：该 ECS 内存仅 1.7Gi。有人在同一台服务器上经 VS Code Remote-SSH 运行了 Cline 等 AI 代理（/root/.vscode-server、/root/.cline 时间戳 23:38-00:21，session-52.scope 22:37 建立且为常驻登录会话），Node 进程（内核 OOM 报告中 comm 名为 "MainThread"——**Node 主线程的 comm 名，后端 node 进程同样如此，不能按名字猜进程**）膨胀至 RSS ~1GB / VSZ ~19.6GB，于 23:57、00:11、01:13 三次触发内核全局 OOM；01:13:30 journald 看门狗超时，说明整机冻结——用户态不参与应答，外部表现即“全端口超时”。listen-together 全程 active、NRestarts=0，从未中断。
- 规避：①1.7Gi 小机与重负载（VS Code Remote + AI 代理、并发构建）互相排斥，重负载请走本地 + `ssh aliyun` 执行单条命令，不要在服务器上挂常驻会话跑代理；②再遇“云端全端口超时”先 SSH 上去看 `journalctl -k | grep -i oom`、`free -h`，再查 `ls -lat /root`（.vscode-server/.cline 时间戳）与 session 来源，**不要先怀疑 listen-together 或安全组**；③判定“整机冻结”的旁证：TCP 三次握手能完成（内核收）但 HTTP/SSH banner 无响应（用户态冻）；④“服务恢复但原因不明”时核对 systemd NRestarts 与 ActiveEnterTimestamp，区分“服务死了重启”与“服务活着但整机不可达”。
