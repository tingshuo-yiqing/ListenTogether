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

### 2.10 `screenrecord` 在 PHQ110 段错误，录屏不可用（2026-09-23 实测）
- 现象：`adb shell screenrecord --time-limit 3 /sdcard/rec.mp4` 返回 **rc=139**（128+11=SIGSEGV）、stdout/stderr 全空、文件不存在；`--size 480x800`、换 `/data/local/tmp` 同样失败。
- 根因：本机 ColorOS 的 screenrecord 二进制/编解码路径崩溃，非参数问题；不要反复换参数试。
- 规避：需要逐帧/过程证据时改用**连续 screencap 连拍**（设备端落盘、最后批量 pull，间隔约 0.55s），事后用 ffmpeg `scale=1:1 -pix_fmt gray` 逐帧取均值做亮度判据（示例见 docs/test-results/2026-09-23-w1-recheck/tools/coldstart_flash_probe.py）。连拍分辨率受 screencap 编码耗时限制，比 flash 更短的现象可能漏采，报告里要如实标注。

### 2.11 ColorOS 输入法对 uiautomator 不可见：`keyevent 111` 收不起，底部区域 tap 被吞（2026-09-24 实测）
- 现象：真机自动化中创建按钮（y≈1287）可正常点击，加入按钮（y≈1695-1953）`input tap` 多次无响应——无 busy、无错误横幅、无导航；dump 只有应用自身节点、看不到输入法窗口；被吞的 tap 会在当时聚焦的输入框追加字符（昵称 B1→B1B1），证明 tap 实际落在输入法上。
- 根因：ColorOS 定制输入法不进入无障碍转储（dump 看不到它），且 **`keyevent 111`（ESC）在 ColorOS 上不收起输入法**；输入法覆盖约 y≥1500 的底部区域。此前只点过 y<1500 的按钮所以未暴露，陷阱 3.2 的"111 收起键盘"在本机不成立。
- 规避：文本输入完成后用 **`input keyevent 4`（BACK）收起输入法**——字段聚焦时 BACK 只收 IME 不退出页面；若 IME 已收起 BACK 会退出页面，dump 复核无 EditText 就重启 App 兜底，收起后再 dump 取坐标。连带三个坑：①播放/滚动中的 LazyColumn 只组合可见行，目标行不在视口时 dump 里根本没有该节点——先滚动查找，选中后滚回播放卡核验「当前歌曲」；②服务端空房 5 分钟回收后客户端可能仍停留在房间页（僵尸会话，UI 操作全部无效）——自动化前先看 `/health` 的 rooms 计数，残留会话一律退出重进；③`input text` 对非空字段是**追加**不是覆盖，填充前先循环 DEL 清空。
- 实证：UI 批次验收驱动加入 keyevent 4 后，手填 join 与确认卡 join 立即恢复；对照数据见 docs/test-results/2026-09-24-ui-batch-acceptance/。

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

### 3.5 adb server 回收清掉 reverse → 应用掉线横幅把布局整体推下去，旧坐标必然点错控件（2026-09-23 实测）
- 现象：一段"点曲目行 + 点播放"打完，`dumpsys media_session` 里状态纹丝不动（仍 PAUSED、pos=0、updated 不变），诊断随后刷出 `EOFException`。看上去像"播放按钮点了没反应"。
- 根因：沙箱每次工具调用回收 adb server → `adb reverse` 规则随之消失 → 设备端 `127.0.0.1:3000` 没有转发者，应用立刻 EOF 进入"连接断开，正在重试"；**首页插入该横幅后整个内容区下移约 324px**，于是上一进程 dump 出来的坐标（曲目行 y≈1973、FAB y≈1181）在这一轮分别落到别的行和进度条上，等于点空/误点。同一进程内先 dump 再点则是准的。
- 规避：**一个测试阶段一个进程**——`kill-server/start-server → 等设备就绪 → reverse → 设备端 curl health → force-stop/start 应用 → 建房 → dump 取坐标 → 操作 → 采样 → 导出诊断` 全部写在同一个脚本/同一次调用里；任何一步要用坐标都必须**在同一进程内、连接恢复成 Ready 之后**重新 dump。播放中不要 dump（SeekBar 动画会让 uiautomator 拿不到 idle，陷阱 3.1），改为在暂停态一次取齐坐标、播放中只用 media_session 判断。可复跑示例见 docs/test-results/2026-09-23-w1-recheck/w1_driver.py。

### 3.6 Compose 输入框：`input text` 长串只落首字符；改地址一律走存储层（2026-09-23 实测，补充 3.4）
- 现象：`adb shell input text "http://127.0.0.1:3000"` 之后应用报 `Expected URL scheme 'http' or 'https' but no scheme was found for h`——地址框里只有 `h`。两个字符的昵称（`W1`）则正常。
- 根因：`input text` 以极快节奏注入按键事件，Compose 的 IME 连接丢事件，字符越长丢得越多（不是转义问题，空格/斜杠都不涉及）。
- 规避：**地址这类长串不要用 UI 输入**。`ConnectionStore` 就是 SharedPreferences `connection.xml` 的 `baseUrl`，直接写存储层最稳：
  `adb shell "run-as com.listentogether.app sh -c 'echo <base64(xml)> | base64 -d > shared_prefs/connection.xml'"`（写后 `cat` 复核；`rm` 该文件可让地址框恢复空值并自动展开）。
  对比 3.4：`sed -i` 在 run-as 下静默失败，**重定向 `>` 可用**。昵称用短 ASCII 串 + `input keyevent 111` 收键盘即可。

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

### 4.5 长截屏开关与实际依赖版本不一致（2026-09-24）
- 现象：用户反馈 ColorOS 不支持长截屏，但旧网页建议的 ComposeFeatureFlag_LongScreenshotsEnabled 在本项目依赖中已不存在。
- 根因与规避：本地 BOM 2025.04.01 对应 Compose UI 1.8.0，核对 sources.jar 的 AndroidComposeView/ScrollCapture 可见 API 31+ 默认接入。先查真实依赖源码，不能盲加旧实验开关或把 OEM 未识别归因于框架缺失；设备离线时保持原生入口待验，新增应用内长图导出作为兜底。
- 同轮构建问题：`rememberSaveable(stateSaver=...)` 的状态可空而 `listSaver` 原类型非空，编译报 MutableState 类型不匹配；Saver 的 Original 类型必须与状态一致（本轮为 PlaylistImage?），空值保存为空列表。

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
- **非交互 PowerShell 5.1 的 Invoke-WebRequest 直接失败（2026-09-23）**：报"Windows PowerShell 处于非交互模式。朗读和提示功能不可用"，与目标 URL 无关。规避：HTTP 健康检查改用 `[System.Net.HttpWebRequest]::CreateHttp($u)` + GetResponse/StreamReader；会话内 PowerShell stdout 不回显时按 152 条惯例写日志文件再 Read。
- **Git Bash 会把 adb shell 的 /sdcard/... 参数改写成 Windows 路径（2026-09-23）**：`adb shell uiautomator dump /sdcard/ui.xml` 实际收到 `C:/Users/.../PortableGit/.../sdcard/ui.xml`，dump "成功"却找不到文件，pull 报 failed to stat。规避：命令前加 `export MSYS2_ARG_CONV_EXCL="*" MSYS_NO_PATHCONV=1`，或改用 PowerShell 工具执行 adb。这是陷阱 7 "Windows 原生程序不识别 /d/ 路径"的镜像形态：MSYS 对**看起来像路径的参数**都会转换，进设备 shell 的参数同样中招。
- **AI 会话中断/网络重试后，"失败"的编辑可能实际已应用（2026-09-23）**：一次会话中断续接后，同一批文件出现 import 重复、`SmoothRenderers` 类重复定义、"未找到匹配串"实为早已改过。规避：中断恢复后先 Read 关键文件再继续编辑；提交前跑一次构建，编译器的 Redeclaration 错误是重复编辑的最好探测器；见到"已在文件里"的修改不要慌，先核对内容是否正是意图所需。
- **Windows 下 `fs.symlink` 的文件类型静默退化成普通文件（2026-09-24，本机实测）**：写"曲库拒绝库外符号链接"的回归用例时，`fs.symlinkSync(绝对目标, 链接路径)`（type 缺省或 `'file'`）**既没抛错也没建出链接**——`lstat().isSymbolicLink` 为 `false`、`isFile()` 为 `true`、`nlink=1`、`readlinkSync` 报 `EINVAL`，`realpathSync` 直接返回链接自己的路径（不解析目标）。后果具有欺骗性：被测的 `realpath + startsWith` 防护在本机会**放过**这类文件，看起来像"防线失效"，实际是链接压根没建出来（生产是 Linux，realpath 会正常解析）。规避：①需要符号链接证据时用**目录链接**——`fs.symlink(target, path, 'junction')`（Windows 走 junction 不需要管理员权限，POSIX 忽略 type，实为目录符号链接），实测 `realpathSync` 能解析到真实目标，逃逸用例据此编写；②判定"链接是否真的建立"必须看 `lstat().isSymbolicLink`，不要只看 `symlink()` 没报错；③这类"同一 API 跨平台语义不同且静默降级"的问题，最终结论要落在目标平台（Linux）上，本机只能证明"防护对已解析出的库外路径生效"。
- **会话沙箱内 scp 被拦：`scp: pipe: Unknown error` exit 255（2026-09-23 LOAD-15 云端轮实测）**：PowerShell 工具沙箱内运行 `add-media.ps1`，转码/ffprobe/scp 前置全过，唯独 scp 上传报 `pipe: Unknown error`（exit 255）；同一会话中 Bash 通道（沙箱外执行）的 scp/ssh 全部正常。规避：①在此环境跑涉及 scp 的脚本前，先用最小 scp 命令探通道，失败即换 Bash 通道；②`add-media.ps1` 中断后的**续传路径**：转码产物在 `%TEMP%\lt-media\up-<id>.mp3`，手动完成 `scp 上传 → manifest（UTF-8 无 BOM，`id\t标题`）→ `media-manage.sh install <id> <临时名> <manifest>` → `-Restart` 段的 systemctl restart + health 轮询 → `media-manage.sh verify`；不要从头重跑浪费一轮转码。属陷阱 7"沙箱辅助进程初始化"的同族形态。

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
