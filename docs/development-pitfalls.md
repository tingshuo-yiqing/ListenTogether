# 开发陷阱与规避清单

本文记录项目中**实际踩过**的问题（非理论风险），按"现象 → 根因 → 规避"组织。任何新会话开工前应通读一遍；踩到新坑必须回填本文，防止重复犯错。最近更新：2026-09-24（新增 5.5 Gradle 增量构建让门禁"测试通过"变成上一轮结论、7 Windows 下 fs.symlink 静默退化为普通文件、8.9 验收脚本字符串全等断言与存量配额；1.6 补充 check.ps1 的 EAP 收窄）。

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

### 1.6 PS 脚本调原生命令：stderr 警告在 EAP=Stop 下变终止异常，exit 0 也白搭（2026-09-23）
- 现象：add-media.ps1 首跑《单车》时报 `Invalid UTF8 sequence in avio_put_str16le` 判为"转码失败"；实际 ffmpeg **转码成功（exit 0）**——那只是复制 ID3 元数据时的警告（老文件 GBK 字节被标成 UTF-16，ffmpeg 跳过该标签继续）。脚本内 `$ErrorActionPreference='Stop'` 把这行 stderr 转成 NativeCommandError 直接抛出，显式的 `$LASTEXITCODE` 检查和兜底重试永远执行不到；修 EAP 后同文件一次通过。
- 根因：PS 5.1 下原生命令**任何** stderr 输出（警告、进度行）在 EAP=Stop 时都会变终止错误；陷阱 1.5 的机制在"命令其实成功"的场景再现，且失败信息具有误导性。
- 规避：调用会写 stderr 的原生命令（ffmpeg/ffprobe/scp/ssh/gradle）前把 EAP 收窄为 Continue（用完恢复），stderr 用 `2> 文件` 承接（PS 5.1 产出 UTF-16，Get-Content 自动识别），成败只认 `$LASTEXITCODE`。另：给原生命令传"一组选项"必须数组展开 `@("-map_metadata","-1")`，单个字符串 `"-map_metadata -1"` 会被当成一个参数名（同 2.7E 参数形态坑）；ffmpeg 真因元数据 fatal 时用 `-map_metadata -1` 去元数据重转，曲库标题来自 catalog.json 不受影响。
- **2026-09-24 补充**：`scripts/check.ps1` 的 `Invoke-CheckedCommand` 已按本条改造——调用原生命令期间把 EAP 收窄为 Continue，`finally` 恢复，成败只认 `$LASTEXITCODE`（此前的写法在 EAP=Stop 下会把 gradle/npm 的任意一行 stderr 变成终止错误，退出码 0 也中招）。脚本外部仍**不要**对外层做 `*>&1` 合并重定向（陷阱 1.5）。

### 1.7 用 `*>&1 | Out-File` 采集 Gradle 输出，Kotlin 报错被拆行加装饰后搜不到（2026-09-25）
- 现象：编译失败的日志里只剩「Compilation error. See log for more details」，`Select-String '^e: '` 一条都匹配不到；真正的错误 `e: file:///...MainActivity.kt:505:26 Unresolved reference 'contentDescription'` 被 PowerShell 按控制台宽度折断成两行，中间还插入 `所在位置 行:1 字符: 204`、`+ CategoryInfo`、`RemoteException` 等装饰。
- 根因：原生命令的 stderr 行被 PowerShell 包装成 ErrorRecord 后再格式化输出（与 1.5/1.6 同族），格式化会折行；外层 `*>&1` 合并重定向正是 1.5/1.6 明令避免的写法。
- 规避：原生命令的 stdout/stderr **分开做文本重定向**（`1>out.log 2>err.log`），错误行保持原样；再用 Grep 工具搜 `e: file` 定位。已按此跑 `gradlew :app:compileDebugKotlin` 验证——同一次错误直接给出文件:行:列与未解析符号名。
- **2026-09-25 深夜补充（后台任务的退出码）**：把 Gradle 挂到后台跑时，若包装命令结尾是 `tail`/`echo`，工具看到的退出码属于最后那条命令，**`BUILD FAILED` 也会报"exit code 0"**（本轮首轮门禁的 Lint 失败就是这样被掩盖成通过，靠翻日志才看到）。规避：包装里显式回写 `echo "GRADLE_EXIT=$?" >> 日志`，判定只读这一行；后台任务完成通知里的"成功"不能当作门禁结论。

### 1.8 Windows 自带 `tar.exe` 按 ANSI 代码页解析 tar 头：UTF-8 中文文件名解成乱码、部分条目直接解包失败（2026-09-27 实测）
- 现象：把云端曲库（`红日.mp3`、`背对背拥抱.mp3` 等中文名）在 Linux 侧 `tar -cf` 打包、用 Windows `tar -xf` 解到本地，**23 个条目只解出 20 个**，且文件名变成 `绾㈡棩.mp3`、`瀵屽＋灞变笅.mp3` 这类乱码；stderr 报 `tar: ./背\257\271背拥抱.mp3: Invalid empty pathname`。tar 本身在服务器上 `tar -tf` 列表完全正常，所以"包是好的"。
- 根因：Windows 的 bsdtar 按**当前 ANSI 代码页**解释 tar 头里的路径字节，而 GNU tar 写进去的是 UTF-8 字节序列。多字节序列被按单字节代码页错误解码后既产生乱码，也可能拼出非法路径（内嵌反斜杠、控制字符）而被判为空路径丢弃。这是跨平台归档的经典坑，与"控制台显示乱码"（1.3）不是一回事——**后者只是显示，前者是数据真的坏了**。
- 规避：**不要让中文文件名过 Windows 工具链**。在服务器侧用 `tar --transform` 把文件名统一换成 ASCII（本项目换成曲目 `id`：`s|^\./红日\.mp3$|./hong-ri.mp3|`，规则由 `catalog.json` 生成，中文只留在服务器上的规则文件里），本地解包后再由 `scripts/build-local-catalog.mjs` 把 catalog 的 `file` 字段映射回 ASCII 名。附：`tar --transform` 的 `sedfile=` 写法在部分环境报 `Unknown flag in transform expression`，改用**内联分号表达式** `--transform="s|…|…|;s|…|…|"` 更稳；`tar -xf` 的路径写 `D:/…` 正斜杠形式，反斜杠会被当转义。

### 1.9 把带 CRLF 的 bash 脚本经 ssh stdin 送进 Linux：每条命令尾都多一个 `$'\r'`（2026-09-27 实测）
- 现象：`$script | ssh aliyun "bash -s"` 执行本地写的临时脚本，业务输出全部正常（`ls`、`node -e` 都对），但 stderr 混着 `bash: line 18: $'\r': command not found`，且脚本中途某些判断莫名其妙；工具因此把整次调用标成失败。
- 根因：脚本文件是 Windows 换行（CRLF），经 stdin 原样进远端 bash 后每个 `\r` 都被当成独立命令；`set -e` 下还可能提前中断。业务命令能跑是因为 `\r` 追加在行尾、多数命令忽略尾部空白。
- 规避：管道前统一换行再送：`$script = (Get-Content x.sh -Raw) -replace "\`r\`n", "\`n"; $script | ssh host "bash -s"`。中文字符串同样只在脚本内容里流转，不要进命令行参数。

### 1.10 PowerShell 5.1 的 `Get-Content`/`ConvertFrom-Json` 默认按 ANSI 读文件：UTF-8 中文 JSON 会被读坏（2026-09-27 实测）
- 现象：`Get-Content .workbuddy/media-stage/catalog.json -Raw | ConvertFrom-Json` 报 `Invalid object passed in, ':' or '}' expected`，打印出来的内容是 `"title": "鏈変綍涓嶅彲"`——看上去像文件本身被写坏了，差点按"源文件损坏"重做一遍拉取。同一文件用 Node `readFileSync(p,'utf8')` 读出来完全正常，字节探针也显示是合法 UTF-8（`e6 9c 89 …`）。
- 根因：Windows PowerShell 5.1 的 `Get-Content` 在**未显式指定编码**时按 ANSI（本机 GBK）解码；UTF-8 中文因此变成乱码，`"` 等字符还可能被解码成别的字节，JSON 解析随之失败。PowerShell 7+ 默认 UTF-8，所以同一条命令在两边结论相反。
- 规避：**判定"文件是否损坏"必须看字节，不能看 PowerShell 的字符串**。用 `[System.IO.File]::ReadAllBytes()` + `New-Object System.Text.UTF8Encoding($false,$true)` 严格解码，或用 Node 读；读文本一律 `-Encoding UTF8`。凡"某个脚本报 JSON/文本坏了"而另一个语言读得好，先怀疑读取侧编码，再怀疑文件。

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
- **2026-09-23 补充（坑 G）**：用户只报"配对端口+配对码"时（本次 172.19.0.1:43419 + 658177），配对端口本身不能 connect（10060 超时）。用 `adb mdns services` 一次拿到两个端口：`_adb-tls-pairing` 是配对端口（与用户报的一致），`_adb-tls-connect` 才是调试端口（本次 39805）。手机"无线调试"页显示的 IP（172.19.0.1）与 mDNS 解析出的地址（192.168.43.15）可以不同，connect 用 mDNS 给的地址即可；已有配对记录时 daemon 启动后约 10 秒内会自动重连到 device 态（先 `start-server` + sleep 再 devices，别急着判失败）。
- **Toast 不进 uiautomator dump**（2026-09-23）：返回键 Toast"仍在后台播放，可在通知栏停止"在 dump 中不存在但截图清晰可见——Toast 类反馈的自动化验证只能靠 screencap 目视，dump 断言会误报为失败。

### 2.8 OPPO 息屏冻结无线 adbd：TCP 端口在、握手永远 offline（2026-09-22 实测）
- 现象：无线连接成功后数分钟内 `adb devices` 变 `offline`；重连报 10060/10061；端口扫描发现旧端口仍 TCP 可达，但 `adb connect` 永远停在 `offline`（20:46 连通 → 20:50 失联 → 21:01 后 30000-60000 扫描逐步无监听）。ICMP ping 一直通，说明 Wi-Fi 未断。当晚端口轮换实录：41559 → 39731 → 46888 →（人工亮屏）41145。
- 根因：与 2.4 同源——OPPO 息屏挂起后台。TCP 监听队列由内核维持（`accept` 还能完成），但 adbd 用户态进程被冻结，TLS/adb 握手无响应 → 永远 offline。端口还会随 adbd 重启轮换（41559 → 39731 → 46888），不能写死。
- 规避：**先让手机亮屏再连**（亮屏后 adbd 解冻，旧端口可能直接恢复，也可能换新端口，先扫一遍）。跑复验类长测试时脚本开头就要 `svc power stayon true`（m3-auth-recheck.sh 在链路建立后才设，链路建立前这一窗口同样会被冻结——亮屏是人工步骤，脚本救不了）。无 USB 备份通道时无法远程唤醒，只能人工解锁。
- 排查顺序：ping 不通 = Wi-Fi 断；ping 通 + 扫描无端口 = adbd 未监听（无线调试被关）或全冻结；端口通但 offline = adbd 冻结，亮屏重试。

### 2.9 shell 写不了系统设置：`settings put` 被拒，改用 `cmd power` / `cmd uimode`（2026-09-23）
- 现象：`adb shell settings put system screen_off_timeout 1800000` 报 `SecurityException: com.android.shell was not granted this permission: android.permission.WRITE_SETTINGS`；`settings put global low_power 1` 报 `SecurityException: Permission denial, must have one of: [WRITE_SECURE_SETTINGS]`，且**读回来仍是 0**（不报错时更危险，容易误判"已开启省电"）。
- 根因：`settings put` 的 `system`/`global` 命名空间分别要求 WRITE_SETTINGS / WRITE_SECURE_SETTINGS，本机 shell 两个都没有；`settings get` 不受影响（所以"能读不能写"）。
- 规避：需要状态切换时走对应子系统命令——省电用 **`cmd power set-mode 1`（1=on，0=off）**，改完必须 `settings get global low_power` 复核（应为 1、sticky 通常也为 1）；夜间模式用 `cmd uimode night yes|no|auto`（先 `cmd uimode night` 读原值，测完复原）；被改过电池状态用 `dumpsys battery reset` 收尾。屏幕超时等其他 system 设置只能人工在设置界面改。
- **2026-09-25 深夜补充（把限制变成工具）**：`settings put system user_rotation` / `accelerometer_rotation` 同样被拒（shell 无 WRITE_SETTINGS），想造"配置变更"验证 `rememberSaveable` 是否存活，**不必转手机**——`cmd uimode night yes` 再 `cmd uimode night no` 就会强制 Activity 重建（Manifest 未声明 `configChanges`），比物理旋转稳定且可脚本化。本轮入房表单恢复项即用它取证。

### 2.10 `screenrecord` 在 PHQ110 段错误，录屏不可用（2026-09-23 实测）
- 现象：`adb shell screenrecord --time-limit 3 /sdcard/rec.mp4` 返回 **rc=139**（128+11=SIGSEGV）、stdout/stderr 全空、文件不存在；`--size 480x800`、换 `/data/local/tmp` 同样失败。
- 根因：本机 ColorOS 的 screenrecord 二进制/编解码路径崩溃，非参数问题；不要反复换参数试。
- 规避：需要逐帧/过程证据时改用**连续 screencap 连拍**（设备端落盘、最后批量 pull，间隔约 0.55s），事后用 ffmpeg `scale=1:1 -pix_fmt gray` 逐帧取均值做亮度判据（示例见 docs/test-results/2026-09-23-w1-recheck/tools/coldstart_flash_probe.py）。连拍分辨率受 screencap 编码耗时限制，比 flash 更短的现象可能漏采，报告里要如实标注。

### 2.11 ColorOS 输入法对 uiautomator 不可见：`keyevent 111` 收不起，底部区域 tap 被吞（2026-09-24 实测）
- 现象：真机自动化中创建按钮（y≈1287）可正常点击，加入按钮（y≈1695-1953）`input tap` 多次无响应——无 busy、无错误横幅、无导航；dump 只有应用自身节点、看不到输入法窗口；被吞的 tap 会在当时聚焦的输入框追加字符（昵称 B1→B1B1），证明 tap 实际落在输入法上。
- 根因：ColorOS 定制输入法不进入无障碍转储（dump 看不到它），且 **`keyevent 111`（ESC）在 ColorOS 上不收起输入法**；输入法覆盖约 y≥1500 的底部区域。此前只点过 y<1500 的按钮所以未暴露，陷阱 3.2 的"111 收起键盘"在本机不成立。
- 规避：文本输入完成后用 **`input keyevent 4`（BACK）收起输入法**——字段聚焦时 BACK 只收 IME 不退出页面；若 IME 已收起 BACK 会退出页面，dump 复核无 EditText 就重启 App 兜底，收起后再 dump 取坐标。连带三个坑：①播放/滚动中的 LazyColumn 只组合可见行，目标行不在视口时 dump 里根本没有该节点——先滚动查找，选中后滚回播放卡核验「当前歌曲」；②服务端空房 5 分钟回收后客户端可能仍停留在房间页（僵尸会话，UI 操作全部无效）——自动化前先看 `/health` 的 rooms 计数，残留会话一律退出重进；③`input text` 对非空字段是**追加**不是覆盖，填充前先循环 DEL 清空。
- 实证：UI 批次验收驱动加入 keyevent 4 后，手填 join 与确认卡 join 立即恢复；对照数据见 docs/test-results/2026-09-24-ui-batch-acceptance/。

### 2.12 触感反馈没有 adb 级客观证据：`dumpsys vibrator_manager` 不记录 `performHapticFeedback`（2026-09-25 实测）
- 现象：想为"点播放/切歌/拖动有震动"留客观证据，读 `dumpsys vibrator_manager` 的 `Previous vibrations for usage TOUCH` 历史——本机只保留 ALARM / TOUCH / NOTIFICATION 三类，且**应用包名（`opPkg=com.listentogether.app`）零条**，点击前后计数都是 0；而同一时刻 `dumpsys media_session` 显示 `state=PLAYING`、诊断 `localPause=false` 且位置推进，说明点击确实生效、只是震动没进这份历史。
- 根因（未深挖，按现象记录）：`View.performHapticFeedback` 走输入系统的 `HapticFeedbackConstants` 通道，ColorOS 的 vibrator 历史只登记显式 `Vibrator.vibrate()`（含 usage 归属）的调用。
- 规避：**不要用 dumpsys 给触感下结论**；触感的"有无/轻重是否合适"必须在验收记录里标为人工手感项（与"听感"同类），或者改用 `HapticFeedbackConstants` 之外的显式 `Vibrator` 调用（本项目不采用，避免为了可测性改产品实现）。本轮场景⑤因此如实标注"无客观证据，待人工确认"。

### 2.13 同一台手机装两个包也测不了双人：ColorOS 后台断网 + 60 秒清扫（2026-09-25 深夜实测）
- 现象：想验"房主 + 成员同屏"，于是在同一台 PHQ110 上并装 `com.listentogether.app`（debug）与 `com.listentogether.app.benchmark`（R8），A 包建房后切到 B 包加入。B 包能进房，但 A 包一切回前台就变成 `Expired`；两次都是同一条链路：App 退到后台约 1 分钟 WS 被系统掐断 → 服务端 60 秒后移除该成员 → 空房 5 分钟回收 → 重连拿到 404。
- 根因：陷阱 2.4（息屏/后台挂起网络）+ 2.5（前台应用查杀后台进程）在"同机双客户端"场景下必然触发，与本项目代码无关；不是同步逻辑缺陷。
- 规避：**双人场景不要试图用同机两包做**——要么第二台真机，要么"一台手机 + `scripts/member-sim.mjs` 脚本成员"（成员必持 WS），且脚本成员要连本机演示后端并 `adb reverse tcp:3000`（公网地址在 PC 侧可能被安全策略拦截）。反过来，这条链路是**免费的失效路径复现器**：本轮的 Expired 横幅、「重新加入房间」换发新令牌、房间回收后的表单内联错误三个场景就是这样顺带验掉的，写进验收记录时按"意外覆盖"标注而不是"设计用例"。

### 2.14 性能包（`isDebuggable=false`）拿不到客户端诊断：`run-as` 直接拒绝（2026-09-25 深夜实测）
- 现象：在 benchmark 变体上执行 `adb shell run-as com.listentogether.app.benchmark cat files/diagnostics/*.jsonl` → `run-as: package not debuggable: com.listentogether.app.benchmark`，性能包一侧完全没有本机诊断证据。
- 根因：`run-as` 要求包可调试（debuggable），而 benchmark 变体刻意 `isDebuggable=false` 才能贴近 release 的 R8/运行时表现；这是取舍不是 bug。
- 规避：性能包的取证只能靠**外部可见通道**——`dumpsys media_session`（播放态与位置）、`screencap` 截图、`dumpsys gfxinfo <pkg>`（帧耗时）；诊断类结论（seek 确认、漂移校正）留在 debug 包上验。要同一份代码两种口径对照时，**帧耗时用性能包、诊断日志用 debug 包**，并在记录里写明各自来源。另：`am start -n <applicationId>/.MainActivity` 对带 `applicationIdSuffix` 的变体会报"Activity class does not exist"，改用 `monkey -p <pkg> 1` 或写全 `com.listentogether.app.benchmark/com.listentogether.app.MainActivity`。

### 2.15 `adb pull` 遇 USB 抖动静默截断：装机回拉只对哈希会在中途误判（2026-09-26 实测）
- 现象：装机后 `pm path` 回拉 base.apk，SHA256 与交付锚不一致；`adb pull` 退出无报错（输出被 `tail -1` 过滤后更看不见），文件却只有 4,587,520 / 23,049,926 字节——USB 传输中断把尾部丢了。
- 根因：USB 线/接口抖动（本轮同日两次设备掉线）使 pull 中途断流；部分路径下 adb 不重试也不显著报错，截断文件留在本地，按哈希一比对就是"装机不一致"的假信号。
- 规避：装机一致性核对**先比字节数、再比哈希**，大小不符直接重拉而不是怀疑构建；USB 反复掉线时换线/换口，或改用无线 adb（陷阱 2.7）。证据：2026-09-26 设备复测 README「装机与一致性」。

### 2.16 制造「断网 60s+」触发服务端清扫：飞行模式会连带关热点，改用 `svc data disable`（2026-09-26 实测）
- 现象：为验证「断网 >60s → 服务端清扫 → 令牌作废 → 过期横幅 → 重新加入」，按 HOME 挂后台 78 秒不触发（音频前台服务保活 WS）；`am force-stop` 更不行（冷启不静默入房、无横幅）；飞行模式 70–95 秒能触发，但用户在开个人热点——**飞行模式会把热点一并关掉**，用户明确要求不得关闭热点/不得再开飞行模式。
- 根因：飞行模式切断整机射频（WiFi AP 含在内）；而热点主机的自身流量走蜂窝数据，`svc data disable` 只断数据面、热点 AP 保持开启。
- 规避：需要短时断网时用 `adb shell svc data disable`（恢复 `svc data enable`），热点与其余射频不受影响；触发窗口要覆盖清扫 tick——70 秒可能恰好跨过 tick 不触发（实测 70s 一次失败、一次成功），**用 95 秒更稳**；重连后先「连接断开，正在重试」，重连拿到 401 才升级为过期横幅。

### 2.17 设备掉线后以 `(no serial number) device` 回来：序列号枚举为空，但 `getprop ro.serialno` 仍正常（2026-09-27 实测）
- 现象：一轮相册扫码验收中途设备从 `adb devices` 整条消失（不是 offline 抖动），重试第 3 次回来了，但列表显示 `(no serial number)	device product:PHQ110 ...`——**序列号字段为空**。此后带 `-s fbddbe8` 的每条命令都报 `device 'fbddbe8' not found`，看起来像设备换了身份。
- 根因：USB 重新枚举时 adb 未能从设备取到序列号，该 transport 的 serial 为空；但设备内部 `ro.serialno` 没变，`adb shell getprop ro.serialno` 仍返回原值。序列号只是 adb 侧的标识，不是设备身份。
- 规避：①此时**不要带 `-s`**——现场只有一台设备，`adb shell` / `adb install` 不带 `-s` 直接作用于唯一设备（本轮据此继续完成了验收）；②`adb reverse` 规则随掉线清空，必须重建；③要恢复带 `-s` 的用法就 `adb kill-server && adb start-server` 或在设备端重新确认 USB 调试授权；④设备"消失"先按连接问题处理（换线/换口/重插），不要怀疑装机或构建。

## 3. UI 自动化（uiautomator/input）

### 3.1 动态进度界面导致 dump 失效
- 现象：`could not get idle state`，dump 出来的是旧快照。
- 规避：播放验证以 `dumpsys media_session` 为准，UI dump 只用于静态布局；失败的 dump 标记无效，不当代证据（见 playback-test 文档）。
- **2026-09-25 补充（代价实例）**：批次 A 真机轮在播放中连续两次 dump 都返回**播放前的旧层级**（显示"已暂停 / 单车 当前"），而诊断 JSONL 与 `dumpsys media_session` 明确显示已切到《富士山下》且 `localPause=false`、位置在推进——一度看起来像"切歌没生效 + 莫名暂停"。改用 `screencap` 截图直接看到真实界面（时间线、当前曲动效、"播放中"）才澄清。**结论：播放/动画进行中的界面事实一律以截图或诊断为准，dump 只能用于静态页面（进入房间前、暂停后）取证。**

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

### 3.5 adb server 回收清掉 reverse → 应用掉线横幅把布局整体推下去，旧坐标必然点错控件（2026-09-23 实测）
- 现象：一段"点曲目行 + 点播放"打完，`dumpsys media_session` 里状态纹丝不动（仍 PAUSED、pos=0、updated 不变），诊断随后刷出 `EOFException`。看上去像"播放按钮点了没反应"。
- 根因：沙箱每次工具调用回收 adb server → `adb reverse` 规则随之消失 → 设备端 `127.0.0.1:3000` 没有转发者，应用立刻 EOF 进入"连接断开，正在重试"；**首页插入该横幅后整个内容区下移约 324px**，于是上一进程 dump 出来的坐标（曲目行 y≈1973、FAB y≈1181）在这一轮分别落到别的行和进度条上，等于点空/误点。同一进程内先 dump 再点则是准的。
- 规避：**一个测试阶段一个进程**——`kill-server/start-server → 等设备就绪 → reverse → 设备端 curl health → force-stop/start 应用 → 建房 → dump 取坐标 → 操作 → 采样 → 导出诊断` 全部写在同一个脚本/同一次调用里；任何一步要用坐标都必须**在同一进程内、连接恢复成 Ready 之后**重新 dump。播放中不要 dump（SeekBar 动画会让 uiautomator 拿不到 idle，陷阱 3.1），改为在暂停态一次取齐坐标、播放中只用 media_session 判断。可复跑示例见 docs/test-results/2026-09-23-w1-recheck/w1_driver.py。
- **2026-09-27 复发（同一现象的第二种触发源）**：首页出现"房间不存在或已过期"错误横幅后，「加入，一起听」按钮从 `[108,1707][972,1863]` 上移/下移到 `[108,1619][972,1775]`，按旧坐标 `y=1785` 点击**只差 4px 落空**，表现为"点了加入毫无反应、服务端日志里连请求都没有"。同时注意：横幅出现/消失的瞬间按钮位置就变，同一轮里前面 dump 的坐标会失效。规避同上——**每次点击前重新 dump 取坐标**，不要跨 dump 复用；坐标落空时先怀疑布局位移，再看网络。

### 3.9 `adb shell input swipe` 起点落在系统手势区会把 APP 切走（2026-09-27 实测）
- 现象：为触发歌词列表滚动手势，在 y≈1850–1950 之间做 `input swipe`，结果 APP 退到后台（`dumpsys activity` 显示前台变成短信应用），随后所有操作都打在别的应用上；回收站里那张截图上还留着上一个应用的内容。一度被误判成"歌词页崩溃/自动退出"。
- 根因：PHQ110 用底部手势导航，屏幕最下方约 60–100px 是"上滑回桌面/悬停多任务"的手势区；`input swipe` 从该区域起手会被系统当导航手势消费。这与 2.11"底部区域 tap 被吞"同源，但 swipe 的后果更重（直接切走应用）。
- 规避：滚动类滑动把起手点抬高到内容区中部（本项目歌词区用 `y=1900→1500` 就踩线，改成 `y=1800→1500` 安全），或先把界面滚动到目标控件可见再做短距滑动；每次滑动后**先 `dumpsys activity activities | grep topResumedActivity` 确认前台仍是本应用**再继续，发现被切走就 `am start -n com.listentogether.app/.MainActivity` 拉回（房间会话在内存里，拉回后仍在房）。

### 3.10 自动化"从相册选图"时，自己的截屏会把相册首屏占满（2026-09-27 实测，代价约 1 小时）
- 现象：验收"相册选二维码图片"功能时反复失败——每次 `screencap` 拉取诊断用的截图都会**同时存进设备相册**，几十张 `1080×2412` 的截图把"最近"首屏占满且顺序不断变化；按上一轮 dump 的坐标去点，点到的全是自己的截图。App 日志里解码失败（`bounds=1080x2412`，而待测二维码是 `720×720`），一度被误判成"解码器有 bug"，实际解码器一次就通过了（`bounds=720x720 ... decoded=65`）。
- 根因：`adb shell screencap -p /sdcard/x.png` 写在共享存储根目录，媒体扫描器会把它当用户照片收录；而 `uiautomator dump` 出来的坐标是**点击那一刻**的网格，任何新增照片都会让整个网格平移。
- 规避：①**截屏落到设备上时用一个不被媒体库收录的目录**（如 `/data/local/tmp/`，`run-as` 或 `adb shell` 均可写），或直接 `adb exec-out screencap -p > 本地.png` 不落设备盘；②已有污染先清理：`adb shell rm -f /sdcard/*.png /sdcard/*.xml`（只删自己推的临时文件，不要 `rm -rf` 整个 Pictures）；③选图类自动化必须**先 dump 再点**、且用"这个格的 content-desc 时间戳"核对到目标图，别复用上一轮坐标——本项目二维码图的时间戳就是推送时刻，可用来精确定位；④分辨"图错了"还是"代码错了"：把待测图**独立反解一次**（本轮用 `jsQR`，与生成端 `qrcode` 不同实现），图能解出而 App 解不出才是代码问题。

### 3.6 Compose 输入框：`input text` 长串只落首字符；改地址一律走存储层（2026-09-23 实测，补充 3.4）
- 现象：`adb shell input text "http://127.0.0.1:3000"` 之后应用报 `Expected URL scheme 'http' or 'https' but no scheme was found for h`——地址框里只有 `h`。两个字符的昵称（`W1`）则正常。
- 根因：`input text` 以极快节奏注入按键事件，Compose 的 IME 连接丢事件，字符越长丢得越多（不是转义问题，空格/斜杠都不涉及）。
- 规避：**地址这类长串不要用 UI 输入**。`ConnectionStore` 就是 SharedPreferences `connection.xml` 的 `baseUrl`，直接写存储层最稳：
  `adb shell "run-as com.listentogether.app sh -c 'echo <base64(xml)> | base64 -d > shared_prefs/connection.xml'"`（写后 `cat` 复核；`rm` 该文件可让地址框恢复空值并自动展开）。
  对比 3.4：`sed -i` 在 run-as 下静默失败，**重定向 `>` 可用**。昵称用短 ASCII 串 + `input keyevent 111` 收键盘即可。

### 3.7 `input text` 打不进非 ASCII、URL 里的 `://` 会被吞；多行框清空要 `MOVE_HOME`+`FORWARD_DEL`（2026-09-25 深夜实测）
- 现象：①昵称想输 emoji 或中文，`input text` 后框内为空或只剩乱码；②地址 `http://8.166.126.136:3000` 经 `adb shell input text http://…` 只落进一个 `h`（与 3.6 的"长串丢字"同源，但这里连引号都被 shell 层吃掉）；③清空一个已有多行内容的 Compose 输入框时，`KEYCODE_MOVE_END(123)` 后循环 `KEYCODE_DEL(67)` 删到某一行开头就再也不动。
- 根因：`input text` 走 keyevent 注入，非 ASCII 无键位可映射；Git Bash → adb → device shell 两层引号会剥掉 `://` 之后的内容；`MOVE_END` 在 Compose 多行字段里**只到当前行行尾**，DEL 于是反复删已空的行首，看起来"卡住"。
- 规避：①**非 ASCII 昵称不做真机注入**——emoji/代理对截断这类逻辑交给 JVM 单测（`DisplayNameTest`）覆盖，并在验收记录里显式标注"真机未目视"；确需非 ASCII 时人工输入或走存储层写偏好。②URL 整体放进设备端单引号里：`adb shell "input text 'http://8.166.126.136:3000'"`（本轮实测可用），或按 3.6 直接改 `connection.xml`。③清空多行框：`KEYCODE_MOVE_HOME(122)` + 循环 `KEYCODE_FORWARD_DEL(112)` 向后删，或先 `MOVE_HOME` 再一次性 `FORWARD_DEL` 到末尾。
- 附带：`input keyevent 4` 收 ColorOS 输入法并不总生效（2.11），点空白处（如 y≈1500 的卡片外）也能收起，收完再 dump 取坐标。

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

### 4.4 进度采样驱动整页重组（2026-09-24）
- 现象：用户反馈歌单下滑明显卡顿；代码检查发现 PlaybackService 每 500ms 把 positionMs 写进 UiState，Activity 根级直接 collect，LazyListScope 内还每次 map/filter 全歌单。尚无真机帧率证据，不能认定这是唯一根因。
- 规避：屏幕结构流先去掉 positionMs 再 distinctUntilChanged；只有播放器订阅原始进度。搜索按曲库/查询缓存，列表类型分离并保留稳定 key。不丢 room.version/room.positionMs，否则会破坏 seek 确认。ScreenStateTest 覆盖过滤边界。

### 4.4 补充：列表内动画逐帧改变布局尺寸（2026-09-25）

- 现象：用户反馈上下滑动歌单迟滞，检查发现当前曲目 `PlayingIndicator` 在组合阶段读取动画值，并用其修改三根 Box 的 height；这会逐帧触发重组及布局测量，与列表滚动竞争帧预算。无设备帧率证据，不能认定为唯一根因。
- 规避：外部尺寸固定，在 Canvas 绘制阶段读取动画值、改变绘制高度；动画只触发重绘。切歌跟随同时检查 `isScrollInProgress`，用户正在滑动时跳过自动滚动；进度采样仍按 4.4 隔离，不为优化歌单而改变已修复的 seek 行为。

### 4.5 长截屏开关与实际依赖版本不一致（2026-09-24）
- 现象：用户反馈 ColorOS 不支持长截屏，但旧网页建议的 ComposeFeatureFlag_LongScreenshotsEnabled 在本项目依赖中已不存在。
- 根因与规避：本地 BOM 2025.04.01 对应 Compose UI 1.8.0，核对 sources.jar 的 AndroidComposeView/ScrollCapture 可见 API 31+ 默认接入。先查真实依赖源码，不能盲加旧实验开关或把 OEM 未识别归因于框架缺失；设备离线时保持原生入口待验，新增应用内长图导出作为兜底。
- 同轮构建问题：`rememberSaveable(stateSaver=...)` 的状态可空而 `listSaver` 原类型非空，编译报 MutableState 类型不匹配；Saver 的 Original 类型必须与状态一致（本轮为 PlaylistImage?），空值保存为空列表。

### 4.6 昵称首字符用 `take(1)` 会把 emoji 截成半个代理对（2026-09-25）

- 现象：为成员加 emoji 头像后（昵称形如「🐱 小王」），原来的 `name.trim().take(1)` 只取到 UTF-16 高位代理，头像位渲染成方框（tofu），成员行文字也可能出现半个字符。
- 根因：Kotlin 的 `Char` 是 UTF-16 码元，emoji（如 🐱 U+1F431）占两个码元；`take(1)`/`[0]`/`charAt(0)` 都是码元级操作，对星平面字符必然截断。
- 规避：按码点/字素簇取首字符——`String.codePointAt` + `Character.charCount`，并向后吞掉变体选择符（FE00–FE0F）、肤色修饰符（1F3FB–1F3FF）、keycap（20E3）、成对地区指示符与 ZWJ 组合（`previous == ZWJ` 也要继续吞，否则 👨‍👩‍👧 只取到第一个 emoji）。实测 `"👨‍👩‍👧 一家人"`、`"🇨🇳 中国"`、`"👍🏽 好"` 必须整体取回；回归钉在 DisplayNameTest（含反例断言 `"🐱 小王".take(1).length == 1`，把这个坑固定在测试里而不是注释里）。
- 连带约束：昵称长度在**两处**都按 UTF-16 码元校验——客户端输入框 `take(24)` 与服务端 `store.ts` 的 1–24 字；给昵称加头像前缀会让总长超限并直接 400，因此拼接后必须再按 24 截断（`composeNickname`）。**截断本身也不能用 `take`**：第 21/24 个码元正好是代理对高位时会切出半个字符，请求体经 UTF-8 编码后被替换成 `?` 存进服务端，成员列表就是方框；用 `takeCodePoints`（累加码点直到再加一个就超限）放不下整个 emoji 时宁可少一个字。

### 4.7 `remember` 的 key 漏了会话/配置维度：跨房间复用与重建清零（2026-09-25，独立复核发现）

- 现象一（跨房间复用）：`remember(client)` 里的 `RoomPlayerState` 存着 `pendingSeek` 与发起那一刻的快照 version。房主拖完滑条 5 秒内退出或换房，新房间 version 从 0 起，确认分支 `snapshot.version <= pendingSeekVersion` 永远成立 → 新房间滑条停在上一个房间的 seek 目标值，5 秒后凭空弹出"进度跳转未确认，请重试"（用户没在新房间做过任何操作）。修法：`remember(client, ui.credentials?.token)`，退房（credentials 变 null）即重建清空；该 state 只存进度与预览，重建无副作用。
- 现象二（重建清零）：房间动态的 entries/previous/everOnline 用纯 `remember`，而 AndroidManifest 未锁方向、无 `configChanges`——旋转屏幕、切深色、改系统字号都会重建 Activity。`RoomClient` 是 Application 级单例，房间状态因此保住、界面不报任何错，但时间线归零；偏偏成员区展开状态是 `rememberSaveable`，于是出现"展开着却一条动态都没有"的自相矛盾界面。修法：需要跨重建存活的状态用 `rememberSaveable` + `listSaver`（Saver 的 Original 类型必须与状态一致，见 4.5），并把读取放在最小作用域——本轮返回 `State`，在成员区那个 `item` 里读 `.value`，避免每条动态重组整个房间页。
- 判定口诀：**这个状态属于"进程 / 房间会话 / 页面"哪一层？** 属于房间会话的，必须把会话标识（token 或房间码）写进 `remember` 的 key；属于页面且用户看得见的，必须能跨配置变更存活，否则要么补 Saver，要么接受归零并保证文案自洽（"展开着但空白"就是不自洽）。同轮复核还指出：`JoinInput`（昵称/邀请码/地址）也还是纯 `remember`，旋转后输入会丢——本轮未改，留待后续。

### 4.8 `null` 与 `""` 兼作"加载中/无内容"两个语义，会把失败态永久卡在"加载中"（2026-09-27 真机发现）
- 现象：真机上切到一首"catalog 有 lyrics 引用但 .lrc 文件缺失"的歌（服务端正确返回 `404 歌词文件缺失，请联系管理员`），歌词区**停在「歌词加载中」两分钟以上不动**；同一位置本该显示「这首歌还没有歌词」。
- 定位过程（可复用）：①埋点打印证明 `fetchLyrics` 60ms 就返回了 null 且 `value = null` 已执行；②在渲染分支再埋点，打印出 `render lyricText=null hasLyrics=true`——**控件拿到的是正确的 null，是渲染分支判断错了**。
- 根因：`produceState` 的初值用 `if (track.hasLyrics) "" else null`（"" = 加载中，null = 没内容），但渲染分支写成"先判 `lyricText == null`，再在分支内按 `track.hasLyrics` 二分"。于是 hasLyrics=true 的曲目取值失败后（null）仍然落进"hasLyrics 为真"的那一边，永远显示「加载中」——**「这首歌还没有歌词」这句文案实际不可达**。
- 规避：①同一个值不要兼职两种语义；本项目改为**显式判别**：`lyricText == ""` 才算 Loading，`lyricText == null` 一律算 NoLyrics（hasLyrics=true 时取值成功必有非空文本，所以 null 只可能是失败）。②更重要的是**把判定抽成纯函数**（`ui/LyricsState.kt` 的 `lyricsUiState`/`lyricsPlaceholderText`），Compose 侧只按枚举渲染——这样这条回归能用 JVM 单测钉死，不必靠真机反复试。③写纯函数测试时专门加一条"加载文案 ≠ 失败文案"的断言，这类"两个状态被压成一个"的缺陷正是它抓出来的（本轮它当场就抓出了修复第一版的同类错误）。

### 4.9 歌词恢复只监听当前行：暂停歌曲手动翻页后永久留在远处（2026-09-27 真机复现）
- 现象：云端《有何不可》暂停在 0:50，手动向后翻歌词，3 秒后仍停在后面的段落；「回到当前歌词」按钮已消失。旧包 `85484698…` 可复现。
- 根因：倒计时只把 `manualPaused` 改回 false，自动滚动却是 `LaunchedEffect(current)`；暂停或长句期间 current 不变，恢复状态不会触发滚动。原先按最后一次触摸滚动事件延迟 500ms，也没有等待惯性滚动结束。
- 规避：跟随流同时观察当前行与手动暂停状态，暂停发 null 取消旧滚动，恢复时即使行号不变也重新定位；等 `isScrollInProgress=false` 后再开始倒计时（本轮按用户确认改为 **3 秒**，移除「回到当前歌词」按钮）。`LyricsFollowTest` 钉住同一行恢复、翻看中跨行、重复采样、首行前取消四种行为。切歌用 `key(id, hasLyrics)` 重建整个歌词子树，因为 `produceState` 的 key 只重启 producer，**不会重新应用 initialValue 或重置列表状态**。
- 验收必须补「歌曲暂停、当前行不变」场景；只在持续播放时等几秒，下一句变化会掩盖此缺陷。证据见 [云端真机补验](test-results/2026-09-27-cloud-device-followup/README.md)。

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

### 5.5 Gradle 增量构建让门禁里的"测试通过"变成上一轮的结论（2026-09-24，Q-2）

- 现象：`scripts/check.ps1 -Scope all` 报告安卓段通过，日志里却是 `> Task :app:testDebugUnitTest UP-TO-DATE`——测试**根本没跑**。上一次真正的执行结果被当成这一轮的验收结论，改测试代码以外的任何东西都发现不了（验收记录里已经出现过"45 项 UP-TO-DATE"这种写法）。
- 根因：Gradle 的增量/构建缓存按输入输出判 up-to-date；测试任务的输入（源码、classpath、参数）没变时直接复用上次的输出，退出码 0、报告是旧的。这是构建系统的正常行为，不是故障——但它与"门禁必须给出本轮实测结论"的语义冲突。
- 规避：**在测试任务之前清掉该任务的输出**。`gradlew :app:cleanTestDebugUnitTest :app:testDebugUnitTest`（Gradle 会为每个 Test 任务自动生成 `clean<任务名>`，删除 `build/test-results`、`build/reports` 下的对应目录）即可强制实跑，只影响测试结果目录，不触发重新编译与重新打包（APK hash 不变）。等价的强制手段：单独一次 `gradlew :app:testDebugUnitTest --rerun`（`--rerun` 只能用于命令行上只指定一个任务的场景，故不适合与 assemble/lint 串在一条命令里）。判断是否真跑过：日志里出现 `> Task :app:testDebugUnitTest` 而不是 `UP-TO-DATE`，且 `build/test-results/testDebugUnitTest/*.xml` 的 mtime 是本次。
- 同类提醒：**任何"复用上次结论"的验收都要在本轮重新取证**（报告里的 UP-TO-DATE、缓存的 hash、上次的服务端响应）；写验收记录时不要照抄上一轮的"通过"字样。
- **2026-09-25 补充：Lint 报告同样是"可能过期的产物"**。`> Task :app:lintReportDebug UP-TO-DATE` 表示报告内容被判定未变而**不重写磁盘文件**——本轮就遇到 `app/build/reports/lint-results-debug.txt` 的 mtime 还停在 09-24 20:20，内容却是"No issues found."，直接照抄等于把上一轮的结论写进本轮验收（分析任务 `lintAnalyzeDebug` 其实跑了）。规避：先删 `app/build/reports/lint-results-debug.*` 再跑 `:app:lintDebug`，确认日志里 `lintReportDebug` 不带 UP-TO-DATE、报告的 mtime 是本轮，并且以 `lint-results-debug.xml` 的 `issues` 计数（0）为证，而不是只看 txt 的一句话。

### 5.6 加了 `CAMERA` 权限却没声明 `uses-feature`，门禁被 Lint 拦下（2026-09-25 深夜实测）
- 现象：为扫码加入引入 ZXing 并在 manifest 加 `<uses-permission android:name="android.permission.CAMERA"/>`，`:app:testDebugUnitTest` 与 `:app:assembleDebug` 都过，只有 `:app:lintDebug` 失败：`Permission exists without corresponding hardware <uses-feature android:name="android.hardware.camera" android:required="false"> [PermissionImpliesUnsupportedChromeOsHardware]`。
- 根因：Android 把"权限"与"硬件特性"分开登记；只声明权限会让 ChromeOS/无相机设备被判定为"要装到不支持的设备上"，Lint 按兼容性阻断构建。扫码这类**可选能力**必须 `required="false"`。
- 规避：加权限的同一轮就补 `<uses-feature android:name="android.hardware.<xxx>" android:required="false"/>`，并把 Lint 与编译放在**同一条门禁命令**里跑（本项目 `:app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug`），不要"先编译过就算"。同类：`UseKtx` 警告（手绘位图该用 `androidx-core` 的 `createBitmap` / `set`）也在此轮一并清掉——新增 `w:` 必须当场处理（4.1）。

### 5.7 用 `grep -c "<issue"` 数 Lint 问题数会把根标签算成 1 条（2026-09-25 深夜实测）
- 现象：`grep -c "<issue" lint-results-debug.xml` 返回 `1`，看起来"还有 1 个问题"，实际 XML 是 `<issues>` 根标签自己。
- 根因：`<issue` 同时前缀匹配 `<issues>`。
- 规避：判计数用带空格/属性的模式 `grep -o '<issue ' | wc -l`，或直接解析 XML（`python -c "import re;print(len(re.findall(r'<issue ', open(p,encoding='utf-8').read())))"`）；报告仍要先删再生并确认 `> Task :app:lintReportDebug` 不带 UP-TO-DATE（5.5 补充）。

### 5.8 按"测试文件数"对账单测数会少计：JUnit XML 按运行时类名拆分（2026-09-26 审计发现）
- 现象：上一轮登记"安卓 91 项"，下一轮按 91+新增对账发现实际 96（对不上 1 项）；XML 目录里出现"没有源码文件的 AvatarGlyphTest"。
- 根因：`DisplayNameTest.kt` 一个文件内含 `DisplayNameTest`(10) 与 `AvatarGlyphTest`(2) 两个测试类；JUnit XML 每个运行时类一份 `TEST-<类名>.xml`，按文件或按"文件数=类数"对账就会少计。
- 规避：对账一律汇总 XML 属性（`tests/failures/errors/skipped` 逐文件累加）并与源码 `grep -c '@Test'` 全量核对（本仓 96=96）；一个文件多个测试类是合法形态，别把 XML 里的"多余类"当旧文件混入（结合 17:02 时间戳与 cleanTest 排除陈旧结果）。

### 5.9 假通过：`runTest` 不会等待真实 `Dispatchers.IO`，测试全绿但被测代码一行没跑（2026-09-27 实测）
- 现象：为"歌词下载失败要返回 null"写了 5 个用例，全部通过，看起来这条路径有回归保护了。加一行 `println` 才发现每个用例里 `session=false`——**会话根本没建立起来，5 个用例都是在"无会话直接 return null"这一步通过的**，被测的 404/网络失败分支一行都没执行。
- 根因：`fetchLyrics` 用真实 OkHttp，`okHttpTransport` 内部是 `withContext(Dispatchers.IO)`；而 `runTest` 只驱动**测试调度器**上的任务，真实 IO 线程池上的工作它不等。于是 `join()` 的协程停在真实的 IO 调用上，测试直接往下走，`session` 仍是 null。用例"通过"是因为函数在最前面就返回了，与断言的语义无关。
- 判别与规避：①**任何用真实网络/真实 IO 的单元测试，先断言前置状态真的建立了**（本轮若在 `join` 后加一句 `assertNotNull(client.state.value.credentials)` 就能立刻暴露）；②同理，断言要在意"函数为什么返回这个值"——"返回 null"既可能是被测分支，也可能是更早的守卫；③优先把逻辑抽成**纯函数**再用注入式假实现测试（5.4 的边界模式），真机行为另由 test-results 证据承载；④发现假通过后要**删掉那个用例**而不是留着充数——假保护比没有保护更危险。

### 5.10 轮询"指令文件"时用字节偏移去切解码后的字符串，会把行首字符吃掉（2026-09-27 实测）
- 现象：验收辅助工具（`host-remote.mjs` 的 `--cmds` 文件轮询）执行到 `select dan-che` 时日志打出 `> lect dan-che` → `未知指令: lect`，切歌静默失败；而单次写入时又完全正常。
- 根因：偏移量按 `statSync().size`（**字节**）记，却用 `content.slice(offset)`（**UTF-16 码元**）去切解码后的字符串。文件开头的 UTF-8 BOM 占 3 字节但解码后是 1 个字符，偏移因此漂移 2 位，正好吃掉下一行开头的字符。
- 规避：**不要混用字节与字符两种单位**。改为按"已执行的行数"记进度（每次全量读文件、切掉已执行的前 N 行），幂等且不受 BOM/多字节影响；写入侧用 ASCII 或无 BOM 编码，并在工具里加**执行回执文件**（`<cmds>.ack` 记录时间+原文），免得再靠服务端状态反推"指令到底有没有被看到"——本轮正是靠回执才确认是行首被吃、而不是指令没送到。

## 6. 设计与流程纪律

- **行为约定优先**：UI 优化不得违反"服务端为播放唯一来源、明确点击才能解除本机暂停"（README）。乐观预览只改显示，不提前改播放器/房间状态。
- **同一次交付同步更新**：代码 + 单测 + 模块文档 + verification.md；漏文档的交付等于没交付。
- **真机结论必须有操作步骤与实测数据**（test-results 目录）；单测通过 ≠ 真机验收，挂起项显式标注（如 M2 缺第二台手机）。
- **APK hash 每轮记入 verification.md**，历史 hash 保留，用于回溯"哪版引入的问题"。
- **故障注入先于修复**：构造失败场景再改代码，避免无依据的大规模重写（计划第 3 节原则）。
- **短测试音会掩盖音频错误与长时问题**：本机环回下 ExoPlayer 会一次性缓冲 30/45 秒的 demo 测试音（buffered position = 文件全长），停后端或改名不再产生 HTTP 请求，401/404/断流错误无法触发；30 分钟息屏/60 分钟播放也需要足够长的测试音。规避：已加入 `demo-media/demo-long.mp3`（40 分钟 220Hz 单声道 32kbps，ffmpeg 合成），音频错误注入时改名该文件并拖动进度到未缓冲区域；新增长测试音后必须**重启演示后端**才会加载进曲库。
- **压测/多成员脚本成员必须持有 WS**（2026-09-22）：服务端按"离线 60 秒"清扫无连接成员（store.ts:72 tick），空房间 300 秒后删除。纯 HTTP 的"假成员"先 401（成员被清）后 404（房间被删），表现为"前 60 秒成功之后全挂"。规避：load15.mjs 每名成员建立 WS 并保持（ws 客户端自动回 pong）；判断失败时间线时先对照服务端清扫/删除阈值。
- **由快照反推"上下线"必须区分"首次连接"与"掉线回来"（2026-09-25）**：服务端 `add()`（HTTP join）先广播一份新成员 online=false 的快照，WS `connect()` 之后才置 online=true（store.ts）；只比较前后两帧的 online 位，会把每个新人都播成"加入了房间"+"回来了"两条，而后者是假的。规避：跨快照维护"见过在线"的成员 id 集合（`everOnline`，用 `updateEverOnline` 只保留当前在房成员，集合随 15 人上限有界），"在线"事件要求该 id 此前已在集合里，并补单测（`firstConnectionAfterJoinDoesNotReportComeBack`）。同类教训：**从全量快照反推事件之前，先去 server 源码确认快照的产生时序**（谁先谁后、哪些动作会 broadcast），不要按直觉假定"加入即在房且在线"。
- **长时任务要脱离工具进程树**（2026-09-22）：终端工具超时会连带杀死 Start-Process 启动的子进程（10 分钟负载第一次启动即被杀）。规避：用 `Invoke-CimMethod Win32_Process Create`（WMI 创建，非工具子进程）+ 输出重定向到文件，再轮询日志取结果。

## 7. 开发工具环境（2026-09-22）

- 现象：本次 exec_command 与 apply_patch 在读取项目文件前报 helper_unknown_error: setup refresh had errors。
- 定位：失败发生于 Windows 沙箱辅助进程初始化，尚未执行项目命令；具体环境根因未确认，不能归因于源码或 PowerShell 编码。
- 规避：先用最小只读命令确认；本次经工具审批的沙箱外命令可用，随后限定在项目内读取和编辑。不要盲目重装项目依赖；写入后核对 git diff 与文件编码。
- **Git Bash 外壳 PATH 损坏（2026-09-22 架构梳理时再次遇到）**：shim 脚本报 `dirname: command not found`、`cd: null directory`，随后 `ls/wc/find/cat` 全部 `command not found`，退出码却是 0，容易误判成"文件不存在"。规避：列文件/搜代码一律用 Glob/Grep/Read 专用工具（本次用它完成了全部源码核对）；必须跑脚本时用带绝对路径的解释器，例如 `C:/Users/ting/.workbuddy/binaries/node/versions/22.22.2-3/node.exe scripts/check-doc-links.mjs`，不要把失败输出当成 FS 事实。每条 Bash 命令开头 `export PATH=/usr/bin:/bin:$PATH` 可恢复 coreutils。
- **Windows 原生程序不识别 Git Bash 的 /d/ 路径（2026-09-22）**：ffmpeg/ffprobe 收到 `/d/ListenTogether/...` 报 `No such file or directory`，而同路径 `ls -l` 明明能看到文件（ls 是 MSYS 程序，会做路径转换）。规避：给 Windows 程序传参用 Windows 风格路径（`D:/ListenTogether/...`）或先 cd 进目录用相对路径；诊断"文件不存在"报错时先想路径转换，不要当成 FS 事实。
- **`cmd //c` 在 Git Bash 中静默失效（2026-09-22）**：`cmd //c "gradlew.bat ..."` 只打印 cmd 横幅就退出，构建根本没跑，退出码却是 0。规避：构建/Lint 用 PowerShell 工具执行；会话内 PowerShell 工具 stdout 可能不回显，命令末尾重定向到日志文件（`*>&1 | Out-File -Encoding utf8 <路径>; exit $LASTEXITCODE`），以退出码判成败、用 Read 工具读日志。禁止从 Bash 调 powershell.exe（安全策略拦截）。
- **演示后端曲库是启动时加载（2026-09-22）**：server 的 loadCatalog 只在启动读一次 catalog.json；往 demo-media 加测试音后必须重启演示后端才生效，不要误以为是文件没生成。
- **非交互 PowerShell 5.1 的 Invoke-WebRequest 直接失败（2026-09-23）**：报"Windows PowerShell 处于非交互模式。朗读和提示功能不可用"，与目标 URL 无关。规避：HTTP 健康检查改用 `[System.Net.HttpWebRequest]::CreateHttp($u)` + GetResponse/StreamReader；会话内 PowerShell stdout 不回显时按 152 条惯例写日志文件再 Read。
- **Git Bash 会把 adb shell 的 /sdcard/... 参数改写成 Windows 路径（2026-09-23）**：`adb shell uiautomator dump /sdcard/ui.xml` 实际收到 `C:/Users/.../PortableGit/.../sdcard/ui.xml`，dump "成功"却找不到文件，pull 报 failed to stat。规避：命令前加 `export MSYS2_ARG_CONV_EXCL="*" MSYS_NO_PATHCONV=1`，或改用 PowerShell 工具执行 adb。这是陷阱 7 "Windows 原生程序不识别 /d/ 路径"的镜像形态：MSYS 对**看起来像路径的参数**都会转换，进设备 shell 的参数同样中招。
- **AI 会话中断/网络重试后，"失败"的编辑可能实际已应用（2026-09-23）**：一次会话中断续接后，同一批文件出现 import 重复、`SmoothRenderers` 类重复定义、"未找到匹配串"实为早已改过。规避：中断恢复后先 Read 关键文件再继续编辑；提交前跑一次构建，编译器的 Redeclaration 错误是重复编辑的最好探测器；见到"已在文件里"的修改不要慌，先核对内容是否正是意图所需。
- **"看起来没变"的替换会吃掉行尾换行，把两个 import 并成一行（2026-09-25，本族镜像形态）**：一次本意是"原样保留"的替换去掉了 `import androidx.compose.foundation.layout.Arrangement` 行尾的换行，与下一行 `import ...layout.Box` 并成 `Arrangementimport ...layout.Box`，两个 import 同时失效。**编译错误报在使用处**（文件末尾 376/380 行 `Arrangement`/`Box` 未解析），与受损位置相距 350 行，第一眼极易误判成"新代码写错了"。规避：批量改 import 区后先自查——Grep 搜 `^import .+import ` 是否有并行（本轮用它 2 秒定位）；见到"未解析引用"先看 import 区，再动使用处代码。与上一条同源：编辑落地与意图不一致时，以文件实际内容为准，不以"我刚改了什么"为准。
- **Windows 下 `fs.symlink` 的文件类型静默退化成普通文件（2026-09-24，本机实测）**：写"曲库拒绝库外符号链接"的回归用例时，`fs.symlinkSync(绝对目标, 链接路径)`（type 缺省或 `'file'`）**既没抛错也没建出链接**——`lstat().isSymbolicLink` 为 `false`、`isFile()` 为 `true`、`nlink=1`、`readlinkSync` 报 `EINVAL`，`realpathSync` 直接返回链接自己的路径（不解析目标）。后果具有欺骗性：被测的 `realpath + startsWith` 防护在本机会**放过**这类文件，看起来像"防线失效"，实际是链接压根没建出来（生产是 Linux，realpath 会正常解析）。规避：①需要符号链接证据时用**目录链接**——`fs.symlink(target, path, 'junction')`（Windows 走 junction 不需要管理员权限，POSIX 忽略 type，实为目录符号链接），实测 `realpathSync` 能解析到真实目标，逃逸用例据此编写；②判定"链接是否真的建立"必须看 `lstat().isSymbolicLink`，不要只看 `symlink()` 没报错；③这类"同一 API 跨平台语义不同且静默降级"的问题，最终结论要落在目标平台（Linux）上，本机只能证明"防护对已解析出的库外路径生效"。
- **会话沙箱内 scp 被拦：`scp: pipe: Unknown error` exit 255（2026-09-23 LOAD-15 云端轮实测）**：PowerShell 工具沙箱内运行 `add-media.ps1`，转码/ffprobe/scp 前置全过，唯独 scp 上传报 `pipe: Unknown error`（exit 255）；同一会话中 Bash 通道（沙箱外执行）的 scp/ssh 全部正常。规避：①在此环境跑涉及 scp 的脚本前，先用最小 scp 命令探通道，失败即换 Bash 通道；②`add-media.ps1` 中断后的**续传路径**：转码产物在 `%TEMP%\lt-media\up-<id>.mp3`，手动完成 `scp 上传 → manifest（UTF-8 无 BOM，`id\t标题`）→ `media-manage.sh install <id> <临时名> <manifest>` → `-Restart` 段的 systemctl restart + health 轮询 → `media-manage.sh verify`；不要从头重跑浪费一轮转码。属陷阱 7"沙箱辅助进程初始化"的同族形态。
- **Windows 下 `node --test <目录>` 会把目录当文件加载：报 MODULE_NOT_FOUND 而不是"没有测试"（2026-09-27 接入 scripts 门禁实测）**：`node --test scripts/lib` 直接以"找不到模块 scripts\lib"退出，看起来像测试文件坏了，实际是 Node 在 Windows 上不对目录做递归发现。规避：门禁一律用 glob 形式 `node --test "scripts/**/*.test.mjs"`（`check.ps1 -Scope scripts` 已按此固化）；写新门禁时**先确认失败模式是"0 个测试"还是"加载报错"**，前者会静默放行、后者才会拦人，两者的告警价值完全不同。
- **国内音乐平台接口的现状与口径（2026-09-27 三源整合实测，参考本机 `百度之星/music_downloader` 的 provider 注释）**：①**必须带 `Referer`**——QQ `c.y.qq.com/soso/fcgi-bin/search_for_qq_cp` 无 `Referer: https://y.qq.com/` 时返回的不是 JSON，报错表现为"解析失败"而不像鉴权问题；②**这些端点会悄悄失效**：`client_search_cp` 已 HTTP 500、`musicu.fcg` 的 `SearchCgiService` 返回空列表/500003、网易云 `/api/search/get/web` 响应体被 AES 加密成 hex、`/song/media/outer/url?id=..mp3` 302 到 404——**"返回空"不等于"这首歌没收录"**，所以 lib 里对结构缺失一律抛错而不是回 null 候选；③**单位不一致**：QQ `pubtime` 是 epoch **秒**、网易云 `publishTime` 是**毫秒**且常为 0，`interval` 秒 vs `dt` 毫秒，混用会得到 1970 或四位数年份之外的垃圾，故归一函数只认 `durationMs`/四位年份，`epochYear(0)` 必须是 null；④**网易云榜首常是翻唱/AI 版本**，不能"取第一条"，必须让阈值参与决策（实测《句号》原唱在第 2 位）；⑤搜索类接口无需登录 Cookie，**音源/下载接口才需要**（`qm_keyst`/`MUSIC_U`）——本项目只取文本与封面地址，因此**绝不注入 Cookie**。
- **缓存把"判定结果"和"判定参数"分开传，出口必须按当前参数重算（2026-09-27，由验证驱动当场抓出）**：`低于阈值就不给封面地址`这条规则原先只在**元数据源层**执行（当场查平台时按那次请求的阈值压掉 `coverUrl`），而管理器把整份结果连同 `coverUrl` 一起写进了缓存；阈值却是**每次请求带的参数**（界面可以调高再试）。结果：状态已经判成 `needs-review`，响应里仍带一个"点一下就存图"的封面地址。修法是在返回处按本次阈值再闸一次（`coverUrl: accepted ? … : null`）。规避要点：**任何"结果 + 参数"分开传的缓存，读出来之后必须用当次参数重新判定，不能假定写入时的判定在今天仍然成立**；同一规则在多层各写一遍时，要么收成一个函数，要么就用测试把最外层的口径钉住（本轮就是靠驱动里那句 `低于阈值时不给封面地址` 断言抓到的，不是靠读代码）。
- **「空值即删」的写库语义遇到外部候选会静默丢字段（2026-09-27 夹具 E2E 抓出）**：`applyEdit` 为了支持"界面清空一个字段"，把空串/非法值统一当成删除。手工编辑时这是正确行为，但候选值来自外部平台：一条 `year: "不是数字"` 的脏数据经同一入口会把已有年份**清掉**而不是写入垃圾——夹具断言"垃圾值被拒"当场失败才发现。规避：同一写入函数被第二类调用方（自动化/外部数据）复用前，必须在新调用方入口加**独立的前置校验**（apply 路由现只接受非空字符串与 1800–2100 整数，"清空"这条语义根本不对外开放），并保留"清空只有手工编辑才有"的不对称性；别指望下游校验器兜住，因为它的语义就是"空=删"。
- **`spawn(node, [脚本, ...])` 里 Node 自己的开关必须排在脚本路径之前（2026-09-27 离线驱动实测，代价是一次真实公网请求）**：给管理器加"出网必失败"的降级用例时，用 `--import` 预加载去替换子进程的 `globalThis.fetch`，但参数写成了 `[MANAGER, '--dir', …, '--import', url]`。Node 只解析脚本路径**之前**的开关，其后的全部进 `process.argv` 交给脚本——管理器把 `--import` 当成自己的陌生参数忽略，预加载从未执行，于是断言收到 200（一次**真**的 QQ 检索请求）而不是预期的 502。这类失效**不会报错**：进程照常起、照常监听，只有结果不对。规避：①凡用 `--import`/`--experimental-*`/`--env-file` 等 Node 开关做夹具，把它放在 spawn 参数数组的**最前面**；②"注入型"用例必须先验注入本身生效——本驱动的做法是让被注入的那条路径**不可能**给出成功结果（fetch 必抛 ⇒ 只能是 502），一旦看到 200 就说明桩没挂上；③验证夹具号称"不出网"时，失败输出里若出现真实平台域名（本轮是 `y.gtimg.cn`），即可当场确认出过网，据此在证据里如实登记那次请求及其影响面（只写进临时 `--cache`，真实缓存与 `media/` 未受影响）。
- **目录归属判断不能靠拼分隔符比前缀，必须走统一的跨平台口径（2026-09-27 删除轮抓出）**：`managedCoverPath` 用 `path === resolve(COVER_DIR) + '\\' + rest` 这类判断决定"这张封面是不是本工具放进 `covers/` 的、可以回收"。在 Windows 上碰巧成立，在 POSIX 口径（`path.win32`/`path.posix` 混用、CI、未来迁到 WSL/Linux 跑工具）下反斜杠永远不出现，判断恒为假——表现不是报错，而是**"独立封面明明在盘上却认不出来"**：删除只清 catalog、图片永远留在库里变成孤儿，用户完全看不出异常。规避：①目录包含关系一律用同一个 `insideDir(root, target)`（`resolve` 后比 `relative()` 不含 `..` 且非绝对），不要让某一路径自己拼分隔符；②凡是"只处理我放进去的东西"这类安全边界，必须在夹具里造一条**边界外**的用例（本轮是手写的 `cover: 'stray.png'` 落在库根）——否则判断写反了也测不出来。
- **删除一类资源时，"写库"与"动文件"的先后决定故障形态，共享资源必须按引用计数（2026-09-27 删除轮）**：曲库删除有两种失败态，严重性差一个量级：先移文件后写库 ⇒ 失败时"catalog 还引用着一份已经不存在的 MP3"，`loadCatalog` 启动即失败，**整个后端起不来**；先写库后移文件 ⇒ 失败时只剩"条目没了、文件还在"，是磁盘垃圾，不是可用性事故。所以顺序固定为：①先整库 `loadCatalog` 自检（库本来就是坏的回 **409**，一个文件都不许动、也不建空回收批次）→②移除条目并过 `writeAndValidate`（失败 **422** 逐字节回滚）→③**才**移文件。409/422/500 要分开登记语义（409=库本来就坏、422=这次写改坏了已回滚、500=非预期），界面据此决定是否留在可重试状态。另一半：多条目可以指向同一个文件（本轮夹具里两首共用 `.mp3`、两首共用封面、两首共用 `.lrc`），无脑移走会把另一首**当场变成坏条目**；删除前必须对**每一类**文件做引用计数（realpath 归一后比对，不能只比字符串），只回收独占文件，共用则留原地并在答复里点名"谁还在引用"。引用计数很容易只给"看起来会共享的那一类"实现（起初只有歌词有），漏掉的正是最贵的音频与封面——所以测试夹具要给三类各造一组共享关系，逐类断言。

## 9. 音频链路与播放取证（2026-09-23）

### 9.1 渲染欠载型漂移：省电降频让播放位置以 ~0.86x 落后（卡顿音的真正来源）
- 现象：三个会话（diag-20260923-113108 / 013040 / 004645）完全一致——播放位置每 5 秒落后 670–740ms、期间零 BUFFERING 抖动、零暂停、零焦点事件；客户端按 500ms 阈值每 5 秒 seek 一次，贯穿全程（单会话 24 分钟 272 次慢恢复纠正）；切歌（自动/手动）初始缓冲 ~3 秒 + 1–3 次连环 seek 才出声。
- 取证：拉设备 `files/diagnostics/diag-*.jsonl`，按"纠正事件→恢复耗时"统计定位风暴；对照 sync 样本 offset（±6ms/30 分钟，排除校时振荡）与 tgt 推进速率（1.001x，排除服务端）；`dumpsys media.audio_flinger` 显示混音器 `empty=491`、fifo underrun n=7647；`settings get global low_power` 返回 1（sticky=1，多日常开）。注意 `dumpsys media_session` 里的 PLAYING 可能是其他应用（当时是 B 站 tv.danmaku.bili），取证前先核对 package。
- 根因：省电降频/后台负载使音频渲染线程周期性饿死（underrun）——load 侧有数据所以永不进 BUFFERING，但渲染头停顿、位置变慢；500ms 阈值把这种慢化变成 seek 风暴，seek 又丢缓冲+重新起流，叠加切歌初始缓冲即用户报告的"自动切换后卡住/进度条在动没声音"。
- 规避：①分级纠正（500ms–2.5s 连续变速追赶，>2.5s 才 seek，见 modules/04）；②SmoothRenderers 把 AudioTrack 缓冲加大到 ~0.7 秒吸收调度抖动；③每秒一次漂移自检；④**做听感相关测试前先确认手机省电模式已关**（`adb shell settings get global low_power` 应为 0，充电可能自动退出省电使现场状态与预期不符）。

### 9.2 播放类验收必须包含"听感连续性"，状态断言会漏掉卡顿
- 现象：此前多轮真机验证（通知栏/焦点/UI 批次）都断言 PLAYING、进度走动、version 推进——全部"通过"，而进度走动恰是 seek 风暴造成的假象；用户实际听到的全程是每 5 秒一次的卡顿。
- 规避：播放验收至少覆盖：①`dumpsys media_session` 连续两次采样位置推进速率 ≈1x；②diag 中 correction 分布（正常播放不应周期性出现 seek）；③真人听感抽查一段。进度"在动"不能作为播放健康的证据。

### 9.3 采样"5 秒差值"不等于 5 秒：`sleep` + `dumpsys` 往返会把速率算成 1.2x（2026-09-23）
- 现象：驱动里 `sleep(5)` 后连续打印 media_session 位置，差值约 6021ms、6055ms，比值 ≈1.2x，看着像"播放被加速了 20%"（甚至超出 ±12% 变速上限），容易误判成变速失控。
- 根因：每次采样本身要跑一次 `dumpsys media_session`（无线 adb 下 0.5–1s），相邻两条记录的真实墙钟间隔是 6s 而不是 5s；用固定的 5 作分母必然偏大。
- 规避：速率只能用**同源时间戳**算——①诊断 JSONL 的 `wallClockMs`/`playerPositionMs`（1s 粒度）；②采样循环里记录每条的 `time.time()` 差值。报告里不要直接引用"每 5 秒 6 秒位移"这类比值。

### 9.4 media3 `ForwardingSimpleBasePlayer` 透传底层可用命令：通知栏上一首/下一首行为由 `getState()` 决定，不由 handleSeek 决定（2026-09-24 后台切歌 bug）
- 现象：媒体通知没有「下一首」按钮；点「上一首」不是切上一首而是回到当前曲目开头（ExoPlayer 的 rewind 语义）。
- 根因：`ForwardingSimpleBasePlayer` 默认把 `getState()`（含 `availableCommands`）透传给被转发的单条目 ExoPlayer——单条目播放器没有 COMMAND_SEEK_TO_NEXT，COMMAND_SEEK_TO_PREVIOUS 由 ExoPlayer 自己实现为回到条目开头，根本到不了转发器的 `handleSeek`。
- 规避：转发器要接管切歌必须**覆写 `getState()` 用 `State.buildUpon()` 追加 COMMAND_SEEK_TO_NEXT/PREVIOUS**，再在 `handleSeek(mediaItemIndex, positionMs, seekCommand)` 里按 seekCommand 分支路由。判断"通知栏会显示什么按钮"先看 State 的 availableCommands，不要假设转发器拦截一切。media3 没有 `State.copy()`，`buildUpon()` 是公开复制路径。

### 9.5 `kotlin.math.floorMod` 不存在：负数安全回绕用 `java.lang.Math.floorMod`（2026-09-24 编译期踩坑）
- 现象：写 `import kotlin.math.floorMod` 直接编译失败 `Unresolved reference 'floorMod'`（IDE 自动补全也不会提示它）。
- 根因：Kotlin 标准库只有 `Int.floorMod(other)` **扩展函数**（`a.floorMod(b)` 写法，kotlin.math 包下无同名顶层函数）；java.lang.Math.floorMod(a, b) 是静态方法可直接 `Math.floorMod(a, b)`。
- 规避：环形回绕（上一首/索引 -1 回末尾）用 `Math.floorMod(index + direction, size)`；不要顺手写 `kotlin.math.floorMod`，也不要用 Kotlin `%`（对负数保留负号，`(-1) % 5 == -1` 会越界）。

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

### 8.6 阿里云大陆机房未备案域名：按域名跨端口拦截，"服务器好的、外面不通"（2026-09-23 实测，含结论更正）

- 现象：TLS 配置全部正确（nginx 443 ssl + LE 证书，服务器本机 `curl https://127.0.0.1` 与 `--resolve` 指定 SNI 均返回 200），但公网 HTTPS 握手失败（Windows curl 报 error 35 "failed to receive handshake"——TCP 能建立、TLS 握手被中断）；公网 HTTP 80 返回 403，且该 403 **不是 nginx 发的**（服务器本机带 Host 头复测同请求为 301）。
- 根因：ECS 位于大陆地域（元数据 `100.100.100.200/latest/meta-data/instance/region-id` = cn-guangzhou），域名未做 ICP 备案，阿里云在机房入口做**域名级拦截：按 Host/SNI 判定、跨任意端口生效**。拦截页特征：80 明文响应头 `Server: Beaver`、标题 "Non-compliance ICP Filing"、正文含 `aliyun.com/beian/beian-block` 链接；TLS 连接（443/8443）表现为握手被中断。
- **结论更正（同日晚对照实验）**：`http://域名:3000` → 403、`http://IP:3000` → 200、`https://IP:8443` → 200。即"非标端口不受影响"的说法**错误**——此前 3000 能通只是因为一直用 IP 访问；只要 URL 里出现未备案域名，任何端口都被拦。**诊断此问题必须做域名 vs IP 对照**（同端口各测一次），只看单一通路会得出错误结论。
- **试用实例无法备案**：阿里云帮助中心原文"免费试用ECS服务器并不满足可备案服务器要求"（试用为按量付费形态；备案服务码要求包年包月 ≥3 个月 + 公网带宽）。**LE 也不给裸 IP 签证书**（certbot 4.0.0：*will not issue certificates for a bare IP address*）。故大陆试用机 + 自定义域名 = 无解，除非迁移或转正式实例。
- 规避：①先拿 `Server: Beaver`/error 35 + 地域元数据定性，不要怀疑 nginx/证书/安全组；②可用路线：IP 明文直连（过渡）、私有 CA 自签 + App 内置信任（需改 App 重发 APK）、迁中国香港地域（免备案、域名+正式证书可用）、转正式包年包月实例后备案；③**备案拦截同样会挡 Let's Encrypt 的 HTTP-01 续期验证（80 被拦），证书续期会失败**——需改 DNS-01 或等备案；④大陆地域试用免费流量仅 20GB/月（192kbps 下 15 人 1 小时 ≈ 1.3GB），且试用额度按小时消耗，注意剩余额度与到期。
- 本轮顺带修复（与备案无关、本就偏离模板）：conf.d/listen-together.conf 用 certbot 自动生成版，X-Forwarded-For 用了可伪造的 `$proxy_add_x_forwarded_for` 且缺 `proxy_buffering off`/`client_max_body_size 8k`；已按 deploy/nginx.conf 模板替换域名后重装（备份在服务器 /root/nginx-backup-<时间戳>/），并移除与 sites-enabled/api.example.com 重复的 server_name（"conflicting server name, ignored" 警告来源）。

### 8.7 PowerShell 生成的 SHA256SUMS 是 CRLF：`grep '$'` 本地通过、服务器静默返回空（2026-09-23 升级演练实测）

- 现象：升级演练中，服务器执行 `grep 'tar\.gz$' SHA256SUMS-20260923-2157.txt | sha256sum -c -` 报 `sha256sum: 'standard input': no properly formatted checksum lines found`，看起来像清单本身坏了；而本机同一条命令（Git Bash / MSYS grep）正常筛出 1 行，本地核对显示"通过"——**同一条命令、同一份文件，本地通过、服务器失败**。
- 根因：`Out-File` / `Add-Content` 写的是 **CRLF**（`od -c` 直证首行末尾 `g z \r \n`，35/35 行全带 CR）。**GNU grep 的 `$` 锚点只匹配 `\n` 之前，不匹配 CR**，故 `grep '…$'` 命中 0 行，管道交给 sha256sum 的是**空输入**；MSYS grep 会自动吞掉行尾 CR，所以本地永远看不出问题。**关键细节：`sha256sum -c` 本身容忍 CRLF**——同一份 CRLF 清单里，tarball 那一行在服务器上直接校验就报 `OK`；失败纯粹来自 grep 这一环，其余 `FAILED open or read` 只是因为文件当时还没解包。别把两者混为一谈，否则会误判成"下载损坏"（陷阱 8.2 的近亲）。
- 规避：①**清单行尾固定 LF** —— `scripts/package-deploy.ps1` 已改为 `[System.IO.File]::WriteAllText($sumsFile, ($lines -join "`n") + "`n", [System.Text.Encoding]::ASCII)`（2026-09-23 修正；复跑实测 CR 字节数 0、服务器 `grep 'tar\.gz$'` 命中 1 行）；②拿到 CRLF 清单时先 `tr -d '\r' < 清单 > 清单.lf` 再按行过滤；③**尽量别用 `$` 锚点过滤清单**：不带锚点的 `grep 'tar\.gz'`、`sed -n '/tar\.gz$/p'`，或干脆在解包目录整份 `sha256sum -c SHA256SUMS-*.txt`（sha256sum 自己能处理 CR）都更稳。
- 同类：这是陷阱 7「Windows 原生程序不认 /d/ 路径」「MSYS 改写 adb shell 的 /sdcard 参数」的又一形态——**同一命令在 MSYS 与 GNU 环境下对同一份文件的解释不同**。凡遇到"本地通过、服务器失败"的静默差异，先把文件字节（`od -c` / `xxd` / `grep -c $'\r'`）拉出来看，再怀疑逻辑。

### 8.8 验收脚本硬编码演示曲库，曲库换成真实音频后必然失败（2026-09-23 升级演练实测）

- 现象：`scripts/m4-deploy-verify.sh` 原第 4 节写死抽查曲目 `demo-soft`，并断言"catalog 恰好 5 首"。云端曲库在 2026-09-23 中午整体换成 5 首**真实 MP3**（`he-bu-ke` / `chi-xin-jue-dui` / `dan-che` / `fu-shi-shan-xia` / `ju-hao`，`media/` 下已无 `demo-soft.mp3`）之后，脚本会在音频段 `stat` 失败或 404——现象与"这次部署坏了"完全一样，极易误判。
- 根因：验收脚本把**测试数据**（演示曲库的具体曲目）与**被测对象**（部署版本）耦合在一起；而曲库是跨版本持久层，会按业务需要独立更换（见 [deployment.md](deployment.md) 第 6 节），二者生命周期不同。
- 规避：①脚本改为从 `/opt/listen-together/media/catalog.json` **动态解析**抽查曲目（`TRACK_ID=<id>` 可覆盖）与条数，13 项语义不变；②**先在一份已知良好的版本上跑一次基线**，再对被测版本跑——否则升级后的失败无法区分"新版本缺陷"与"仪器自身坏了"。本次升级/回滚演练正是按"基线(旧版本) 13/0 → 升级后 13/0 → 回滚后 13/0"三步执行的。

### 8.9 探活字符串全等断言与新增字段耦合；新存量配额让连续重跑验收脚本第 4 次必失败（2026-09-24）

- 现象：①给 `/health` 追加 `rooms/onlineMembers/wsConnections` 后，`scripts/m4-deploy-verify.sh` 的第 1 项（`[ "$h" = '{"ok":true}' ]`）会直接判 FAIL——服务其实完全正常，是断言自己过期了；②同日新增"同一来源最多 3 个活跃房间"的存量配额后，**连续重跑**该脚本（基线→升级→回滚三段演练的常规做法）第 4 次会在建房步拿到 429，现象与"新版本建房坏了"一模一样。
- 根因：①断言把**协议的可扩展响应体**当成不可变字符串，任何字段追加都会误判；②配额按"内存里的活跃房间数"计，脚本收尾只让成员退出、房间要等 5 分钟空房回收才释放，而脚本本身不感知这个前置条件——典型的"被测对象演进后验收仪器未同步"（[陷阱 8.8](#88-验收脚本硬编码演示曲库曲库换成真实音频后必然失败2026-09-23-升级演练实测) 的同类）。
- 规避：①探活/契约断言一律**按字段解析**（`node -e` 解析 JSON 后断言 `ok === true` 与各计数），不要字符串全等；②脚本在建房前先读 `/health` 的 `rooms` 做**前置检查**，达到 3 就带可执行提示提前失败（"等空房 5 分钟回收或重启服务后再跑"），而不是让 429 混进后面的功能抽查；③旧版本没有该字段时按 `SKIP` 处理、不计入 fail，保证"已知良好版本跑基线"仍然全绿，后续失败才能归因于被测版本；④脚本收尾要打印"房间仍占配额约 5 分钟"，提示操作者不要连续重跑。

### 8.10 云端曲库是启动时加载的内存态：改 catalog.json 必须重启服务；media-manage.sh 没有删除子命令（2026-09-24 移除 demo-load 实测）
- 现象：按试用反馈把 demo-load 从云端曲库移除后，不改进程直接调 `/api/rooms/:code/catalog`，返回的还是旧条目（含 demo-load）。
- 根因：服务端在**启动时一次性读入** media/catalog.json 到内存，运行期没有重载入口；曲库属于 media 持久层（跨部署保留），升级/回滚部署不动它，更不会触发重载。
- 规避：手动改曲库的正确顺序是——①先备份（整个 media 目录或至少 catalog.json + 被移音频，移出 media/ 而不是删除，避免部署脚本按 catalog 引用校验时文件缺失）；②改 catalog.json；③`systemctl restart listen-together`；④先调 catalog API 验证条目数，再跑 `m4-deploy-verify.sh`（脚本按 catalog.json 动态抽查）。media-manage.sh 只有 add/list，**没有 remove**——删除只能手动 node 改 JSON + 挪文件。曲库条数变化要让所有依赖"已知曲目集合"的验收（m4 脚本、LOAD-15 的 `--bitrate 192` 曲目）重新确认前提。

### 9.6 倍速缓存复位不等于播放器复位（2026-09-26）
- 现象：代码审计发现 load/大漂移 seek 只写 `catchupSpeed = 1.0f`，实际 PlaybackParameters 可仍是 0.88/1.12；之后暂停还根据缓存判断是否需要复位，漏掉真实倍速。
- 根因：播放器实际值与独立缓存两套状态失配；换媒体项和 seek 没有代替应用写回倍速。
- 规避：读取播放器实际 speed，复位必须写回 PlaybackParameters；纯策略测试覆盖追赶→换曲/seek/暂停/缓冲边界。当前为代码/单测证据，未新增真机听感结论。

### 9.7 seek 确认窗口用墙钟算流逝时长：系统对时跳变会让容忍窗口失真（2026-09-26 审计发现）
- 现象：代码审计发现 `RoomPlayerState` 的 seek 确认用 `System.currentTimeMillis()` 差值度量"发起以来的流逝"，窗口 = 流逝 + 1500ms。
- 根因：墙钟可被系统对时/NTP 突然前跳或回拨，窗口随之瞬间膨胀或收缩；度量时间流逝必须用单调时钟（项目既有原则，见 9.3 同类）。
- 规避：确认窗口改用 `SystemClock.elapsedRealtime`（`nowMs` 注入保持可测），并把确认逻辑抽成纯函数 `seekConfirmed` 直接单测（含 elapsed 为负的防御）；全局排查后主源码不再有 `System.currentTimeMillis()` 做流逝度量的残留。当前为代码/单测证据，真机 seek 听感留待统一测试。

### 3.8 失败 dump 重读旧树造成“播放态始终错误”的假证据（2026-09-26 复核）
- 现象：夜轮 label-lag.py 报 13 次“已暂停”，但留存 17/18/19 三张截图都显示“播放中”。
- 根因：脚本忽略 uiautomator dump 失败并重复读取同一路径旧 XML；因此不能据此断言 PlaybackView 通路有缺陷（3.1 的具体再现）。
- 规避：先删除旧转储、检查退出码与成功标志，失败标无效；动态页面优先截图，并核对采样所属包与时刻。本轮修复采样脚本并撤回过强归因，不把证据失效说成已真机修复播放器。

## 10. 部署操作（2026-09-27 歌词上云实测补充）

### 10.1 `npm ci` 报 `EACCES mkdir node_modules/...`：根因是 npm 缓存目录归属，不是包坏了
- 现象：服务器侧以 `listen` 账号 `npm ci` 失败，stderr 先刷一串 `npm warn tar TAR_ENTRY_ERROR ENOENT: no such file or directory, open '…/node_modules/<各种包>/…'`（fastify、ajv、strtok3…五花八门），随后才是真正的错误 `npm error code EACCES / syscall mkdir / path /opt/listen-together/.npm`。**那串 ENOENT 只是缓存目录不可用后的连带噪声，指向的却是 node_modules 里的文件，极易误判成"包损坏/下载不完整"**。
- 根因：`/opt/listen-together/.npm` 被 root 拥有（早期以 root 跑过 npm 留下的），`listen` 账号既不能写缓存也不能写日志；npm 在缓存不可写时对每个条目都报一次解包失败。
- 规避：①`chown -R listen:listen /opt/listen-together/.npm`（或删掉让它重建）；②部署命令显式指定项目外缓存，避免踩到历史污染：`sudo -u listen env npm_config_cache=/tmp/lt-npm-cache npm ci …`；③**判读顺序**：先找 `npm error` 开头的行，再看 warnings——`TAR_ENTRY_ERROR` 这类批量 ENOENT 通常是次生噪声；④失败重跑前先 `rm -rf node_modules`，别在半成品上续装。
- 附带（同一轮踩到）：脚本里带中文的 `echo` 经 PowerShell → `ssh "bash -s"` 管道传输会被串码，**连引号都可能被吃掉**，bash 报 `syntax error near unexpected token '('`。需要执行带中文的脚本时**先 scp 到服务器再 `bash` 执行**（服务器是 UTF-8 环境），或把脚本输出写成纯 ASCII；这与陷阱 1.9 同源，但后果更重（不只是报错，是脚本文本本身被改坏）。

### 10.2 管理器发布审查发现的落盘与跨平台问题（2026-09-28）

- 上传目录改成audio/后catalog仍写旧路径，上传全部校验失败；必须以真实上传端到端断言落盘与引用一致，不能只测手写夹具。
- 删曲做了引用计数，替换/移除封面却漏掉，导致共享曲库损坏；所有清理入口复用同一引用检查，按真实路径归一。
- async请求共享catalog与固定.tmp文件，多标签页会丢更新；单进程串行覆盖整个读改写校验流程，同时禁止外部并发写库。旧对象重新序列化不是逐字节回滚，要保留原Buffer，并报告恢复失败。
- Python在Windows用write_text默认换行会产生CRLF，上传bash脚本报pipefail\r无效；写shell文件用write_bytes明确LF，上传前检查字节。首次失败在set语句，未发生部署变更；转换后成功。

### 10.3 匹配异步返回可能把上一首候选画到下一首（2026-09-28代码审查）

- 现象：select只清空已有候选，正在等待网络的旧sync返回后仍无条件renderSync；切歌后文字候选可进入错误歌曲的编辑区。
- 根因：请求没有绑定曲目与请求代次，仅清空DOM不能取消未完成的响应。
- 规避：单曲请求保存曲目ID和递增代次，返回时同时核验；select使旧代次失效。资源应用另外用服务端票据绑定曲目、编目快照和有效期。Chrome夹具延迟响应后切歌，确认旧结果不会出现。

### 10.4 `data += chunk` 逐块独立解码 Buffer：跨块汉字整体变 U+FFFD（2026-09-28 真机抓到）

- 现象：真机播放《有何不可》歌词第 4 行「起」字渲染为 U+FFFD，而第 26 行同一句完好；云端 23 个 `.lrc` 中 2 文件 3 行坏，本地原件全净，09-27 的上云 tar 包内已含坏字节（tar/scp 字节安全，损坏在抓取阶段就发生）。
- 根因：`scripts/fetch-lrc.mjs` 的 `https.get` 回调里 `let data = ''; res.on('data', c => data += c)`——`data` 事件给的是 **Buffer**，`+=` 把每块独立 `toString('utf8')`；一个大 JSON 响应被切成多块后，恰好横跨块边界的多字节字符两半都各自非法，解码成 U+FFFD。只坏个别行、同文件其他行完好，极具迷惑性（部署当时只抽查第 1 行中文，漏检）。
- 规避：①流式收文本必须先 `res.setEncoding('utf8')` 再拼字符串，或收集 Buffer 后 `Buffer.concat` 再统一解码，或直接用 `fetch().text()`（分块多字节由运行时处理）；②中文文本资产上云/入库前，把 `grep -c $'\xef\xbf\xbd'`（U+FFFD 扫描）列入核对步骤——本轮全库 23 文件一扫即锁定坏件范围；③抽查中文内容不能只看第一行，坏字节是随块边界分布的，抽「首行」抽不到（本轮教训：部署记录里"中文原样"的结论只对被抽的那一行成立）。

### 10.5 HTML歌词嵌套容器与CRLF替换漏项（2026-09-28 Hi歌曲接入）
- 现象：搜索/封面正常，歌词却为null；新增端到端测试又发现Hi歌词分支和回收接口未实际进入管理器。
- 根因：通用div正则先吞掉外层lyrics-container，内层lyric-line没参与匹配；多行字符串替换按LF写，而原文件为CRLF，replace没命中也不报错。
- 规避：HTML适配只定位已观察到的叶子class/id，不执行脚本；离线夹具保留实际嵌套结构，并做真实站点只读抽查。编辑前统一换行表示，关键替换校验命中，随后检查git diff并跑真实管理器端到端，而不只做语法检查。
- 附：本机Node 24执行 `node --test scripts/lib` 会把目录当模块入口而报MODULE_NOT_FOUND；脚本门禁应使用 `scripts/check.ps1 -Scope scripts`（内部显式glob `scripts/**/*.test.mjs`），不能照搬此前Linux目录入口命令。

### 10.6 管理页已更新但来源仍是旧三源（2026-09-29 实测）
- 现象：出现 Hi歌曲外链，来源却只有 QQ/网易/MusicBrainz，默认 QQ。
- 根因：HTML 每次请求从磁盘读取，Node 的 ESM 来源注册表只在进程启动时加载；启动器无版本检测，复用了旧服务。
- 规避：更新后核对实际 /api/sources 的 serviceVersion/default/sources；只重启已确认端口与命令行的管理器进程。页面显示旧服务提示，启动器拒绝静默复用旧版。测试通过还要对用户正在使用的服务做一次只读抽查。

### 10.5 给 spawn 子进程序列化 fetch 桩：函数体里不能引用外层闭包变量（2026-09-29 Hi音频轮实测）

- 现象：管理器端点离线测试把 `mockFetch` 用 `mockFetch.toString()` 写进 `--import` 预加载文件，子进程里 fetch 桩一跑就抛 `player is not defined`，端点回 500——表象是"网络/服务端失败"，真实原因是测试自身坏桩，与陷阱 10.4 的"看似网络问题"同族。
- 根因：`toString()` 只序列化函数体本身，不携带闭包；mockFetch 里引用的 `player`/`b64` 辅助函数在子进程不存在。
- 规避：①注入桩必须自包含——所有辅助逻辑内联进桩函数体，或全部经 `process.env` 传参；②桩的失败要可辨识：端点侧捕获后回 502/带来源 message，测试断言失败时**打印响应体**（`assert.equal(x,200,JSON.stringify(x))`），本轮靠它一眼定位；③给子进程桩写用例后，先单独跑一次并核对"桩至少被调用过"（calls 文件/计数），防"桩没挂上但断言恰好过"。
- 同轮附带：`syncTrack` 返回的判定字段叫 `metadataAccepted`（身份+阈值合并口径），不是各源 result 里的 `identityAccepted`——消费方按错字段名会让守卫恒真/恒假（本轮恒假），错位字段名要靠断言（422 !== 200）暴露，读代码看不出来。

### 10.7 列表改增量更新时，早退分支会漏掉收尾（2026-09-29 管理器页面重构实测）

- 现象：把"每次输入都整表重建"改成节点缓存后，筛选不出结果时面板上仍留着旧行——新写的空态提示被压在下面，用户看到的是"筛了没反应、旧结果还在"。老驱动的 `querySelectorAll('.track-item').length === 0` 当场抓住。
- 根因：`renderList` 里"筛不出东西就 return"的早退分支排在"把被筛掉的行从面板摘下来"之前。全量重建时 `innerHTML=''` 顺带清了场，拆成增量更新后，那个清场动作变成显式步骤，而早退把它跳过了。
- 规避：①增量/缓存类改写先写收尾（回收失效节点、摘掉被筛掉的）再写早退分支，早退前先确认收尾已执行；②凡是"提前 return"的渲染函数，把清场当成不可跳过的前置；③验证要专门覆盖**空结果**这一路——正常路径全绿时最容易漏的就是它。
- 同族提醒：`appendChild` 对已存在的节点是**移动**不是重建（可当增量排序用），但对仍在面板里的旧节点不生效——"从面板摘下来"这一步不能省，否则旧行会冒充筛选结果。

### 10.8 页面用严格相等比服务端版本号：服务端更新反而误报"旧版本"（2026-09-29 实测截图发现）

- 现象：管理器页面顶部常驻"管理服务仍是旧版本"横幅，并指引"关闭旧进程重新运行 start-metadata.cmd"——而服务端其实已经更新到最新，用户照做也解不掉横幅。
- 根因：页面把期望版本硬编码成字符串并用 `===` 比较；09-29 服务端加 aac 转码时把 `serviceVersion` 升了一版，页面常量没跟着动，于是"服务端比页面新"被判成"不兼容"。双方独立发版时，严格相等必然在某一侧先失配。
- 规避：①版本判定要比**下界**（版本号是日期串时可直接比大小）：服务端不比页面旧即视为兼容，只有服务端更旧才提示重启；②页面与服务端各有版本号时，任一侧发版都要确认另一侧的判定不会反向误报，夹具里要同时准备"更新/更旧"两个版本做双向断言；③这类横幅是给用户的指引文案，误报的代价是让用户做无用操作，发现后按真缺陷登记而不是当噪音忽略。
