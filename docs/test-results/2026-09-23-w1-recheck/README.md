# W1 · 卡顿修复真机验收（2026-09-23 晚）

## 一、标识

| 项 | 内容 |
|---|---|
| 任务编号 | W1（真机轨道；对应 T1「卡顿修复真机验收 5 项清单」） |
| 日期 | 2026-09-23 22:00–22:35（GMT+8） |
| 操作者 | AI 会话执行全部 adb/UI 操作与数据采集；**听感一项由用户本人确认** |
| 结论 | **通过**（5 项清单全部覆盖；边界见第五节） |
| 上游依据 | [交接单第五节](../../handover-2026-09-23.md)、[并行方案 W1](../../parallel-development-plan.md)、[陷阱 9.1/9.2](../../development-pitfalls.md) |

本轮**未改动任何产品代码**，也未重新构建 APK；全部证据来自对既有制品的真机驱动与采集。

### 一个重要偏差（已纠正）

交接单与任务书称 36BD3A5B… 已装机，**实测不成立**：驱动开始时设备上安装的是
`169018AE746164D274E9C843AC8985A1DD27B647D6BF28DFA05110B705FB6845`（安装时间 2026-09-23 11:31），
而 36BD3A5B 只存在于本机 `android/app/build/outputs/apk/debug/app-debug.apk`（构建时间 18:43）。
若直接按现状验收，结论会错误地挂在旧 APK 上。已用 `adb install -r` 安装 36BD3A5B，
并**回拉设备端 base.apk 复算 SHA256** 确认锚定：

```
adb install -r android/app/build/outputs/apk/debug/app-debug.apk   -> Success
pm path + adb pull + Get-FileHash -> 36BD3A5B3ACA74EE45CCEE952F6EB8C042BB0A18D40123601398ADF626DD0CCE
```

## 二、环境

| 项 | 实测值 |
|---|---|
| APK | `36BD3A5B3ACA74EE45CCEE952F6EB8C042BB0A18D40123601398ADF626DD0CCE`（设备端 base.apk 回拉复算，非本机文件推断） |
| 设备 | OPPO PHQ110 / Android 14；1080×2412，**density 480dpi（1dp=3px）** |
| adb 通道 | 无线调试，`adb-fbddbe8-WFMDTR._adb-tls-connect._tcp`；调试端口批次内轮换 41959 → 38131（陷阱 2.7/2.8） |
| 后端 | **本地演示后端** `node dist/index.js`，`MEDIA_DIR=demo-media`、`HOST=127.0.0.1`、`PORT=3000`；设备经 `adb reverse tcp:3000` 访问；`http://127.0.0.1:3000/health` = `{"ok":true}`（PC 侧与设备端 curl 双确认） |
| 曲库 | demo-media/catalog.json 合成测试音 5 首（30s / 45s / 40min 220Hz 32kbps / 70min / 11min）；**本轮长播放用 40 分钟测试音**，非真实音乐 |
| 网络 | 手机与 PC 同处热点网段（192.168.43.x）；无线 adb 链路 |
| 音频输出 | 手机本机输出；未使用耳机/蓝牙（测试中未单独核对音频路由，属未覆盖项） |
| 电池策略 | 第 1/4/5 项：省电关闭（`low_power=0`、`sticky=0`）；第 2 项：省电开启（`low_power=1`、`sticky=1`，经 `cmd power set-mode 1`） |
| 屏幕 | `svc power stayon true`；`screen_off_timeout=1800000`（**测量前的既有值，未改动**）；`mWakefulness=Awake` |
| 后端版本 | 与仓库 HEAD 一致的本地构建（`server/src` 无未提交改动） |

## 三、操作

驱动脚本 `w1_driver.py`（本目录内，可复跑）把「连接 → reverse → UI 操作 → 采样 → 导出诊断」
放在**同一个进程内**完成，原因是沙箱每次工具调用都会回收 adb server：`kill-server` 会顺带清掉
`adb reverse`，设备端立刻 EOF 重连，首页插入「连接断开，正在重试」横幅后整个布局**下移约 324px**，
复用上一进程的坐标必然点错控件（本轮首次尝试即栽在这里，已回填陷阱 3.5）。

统一前置命令（每个阶段开头）：

```
adb kill-server; adb start-server            # 等待 mDNS 自动重连（约 2–15s；慢时用 adb mdns services 取端口后显式 connect）
adb -s <serial> reverse tcp:3000 tcp:3000
adb -s <serial> shell curl -s http://127.0.0.1:3000/health     # 设备端自检，返回 {"ok":true}
adb -s <serial> shell am force-stop com.listentogether.app; am start -n com.listentogether.app/.MainActivity
```

地址与昵称的填写：`ConnectionStore` 即 SharedPreferences `connection.xml` 的 `baseUrl`，直接写存储层
（`run-as ... sh -c 'echo <base64> | base64 -d > shared_prefs/connection.xml'`），**不做 Compose 文本框自动化**
——实测 `input text "http://127.0.0.1:3000"` 只落进第一个字符 `h`（后续报错 `Expected URL scheme 'http' or 'https' but no scheme was found for h`），
属陷阱 3.4 的延续，已回填。昵称用 ASCII `W1`（2 字符不会丢字），`input keyevent 111` 收键盘后按新 dump 的坐标点主按钮。

各步实际动作：

| 项 | 动作 |
|---|---|
| 1 无线通道 | 亮屏状态下 `kill-server/start-server` → 等 mDNS 重连 → `reverse` → 设备端 curl health |
| 2 关省电播放 | 确认 `low_power=0` → 重启 App → 建房 → 选「合成长测试音 · 40 分钟」→ 点 FAB 播放 → 每 15s 采样 media_session 共 180s → `run-as ... cat files/diagnostics/diag-*.jsonl` 导出 |
| 3 开省电复测 | `cmd power set-mode 1` → 确认 `low_power=1 sticky=1` → 重启 App → 建房 → 同曲同流程 180s → 导出 → `cmd power set-mode 0` 复原 |
| 4 自动切歌 | 建房 → 选「合成测试音 A · 30 秒」→ 播放 → 每 5s 采样 130s（跨 A→B→40 分钟曲两次自然切歌）→ 导出 |
| 5 UI 目视 | 40 分钟曲播放中截图（亮）→ `input swipe 300 860 800 860 700` 拖动 → 截图；`cmd uimode night yes` → 冷启动重做同样两步 → 截图；`screenrecord` 失败后改用连拍取证冷启动（见边界） → 复原 `cmd uimode night no` |

## 四、数据

### 4.1 关省电（第 1/2 项判据）— 通过

窗口 205.4s，播放记录 300 条（`diag/diag-close-lowpower-off.jsonl`）：

| 指标 | 实测 | 期望 |
|---|---|---|
| media_session 180s 位置推进 | **1.001x**（166232ms / 166s，13 次采样全 PLAYING） | ≈1x |
| `correction` 分布 | 空 292 / buffering 6 / load 2 | 无周期性 seek |
| **`correction="seek"` 条数** | **0** | 修复前为「每 5 秒一次」（交接单：单会话 24 分钟 272 次） |
| `correction="speed"` 条数 | 0 | 未触发漂移阈值 |
| 播放中 buffering=true | 6 条（集中在起播装载） | 仅初始缓冲 |
| 逐条位置推进速率中位 | 999.0 ms/s | ≈1000 |
| `\|driftMs\|` 中位 / 最大 | 415ms / 426ms | 稳定低于 500ms 触发线 |
| audio_flinger `empty=` 计数 | 596 → 598（205s 内 +2） | 修复前 `empty=491`（24 分钟） |
| audio_flinger `underruns=`（numTracks 行） | 54 → 54（不变） | — |

### 4.2 开省电（第 3 项判据）— 通过

窗口 205.2s，播放记录 311 条（`diag/diag-open-lowpower-on.jsonl`），`low_power=1 sticky=1`：

| 指标 | 实测 | 期望 |
|---|---|---|
| media_session 180s 位置推进 | **1.004x**（166682ms / 166s） | ≈1x |
| **`correction="speed"` 条数** | **9** | 出现变速追赶 |
| **`correction="seek"` 条数** | **0** | **无每 5 秒 seek 风暴**（核心判据） |
| media_session `speed` 字段 | 起播两采样 **1.04**，随后回到 1.00 | 变速追赶生效的直证（Media3 把 playbackParameters 反映到 PlaybackState） |
| 逐条速率分位 | p10 960.9 / 中位 1000.0 / p90 1034.1 ms/s | 变速区间 ±4%~+3.4%，符合 ±12% 上限设计 |
| buffering=true | 11 条 | 略高于关省电（合理） |
| `\|driftMs\|` 中位 / 最大 | 198ms / 15988ms（后者为一次切歌装载，见 4.4） | — |

### 4.3 自动切歌（第 4 项判据）— 通过

窗口 157.3s，播放记录 239 条（`diag/diag-autoadvance.jsonl`），三段曲目自然衔接：

| 段 | trackId | 时段 | 新段内 seek / speed / buffering |
|---|---|---|---|
| 0 | demo-soft（30s） | 0.0–45.2s | — |
| 1 | demo-high（45s） | 45.4–90.6s | **0 / 0 / 2** |
| 2 | demo-long（40min） | 90.6–157.3s | **0 / 0 / 2** |

- 全程 `correction="seek"` = **0**（含两次切歌）——即「不再连环 seek」。
- media_session 5s 粒度采样中状态**始终 PLAYING**，从未进入 BUFFERING：切歌前后的可观测空档
  ≤ 一个采样周期（5s）；`0:00→推进` 在切歌后同一个 5s 窗口内出现（t=+26s 采样 pos=26ms、t=+31s 采样 pos=6184ms）。
  初始缓冲仍存在（每段 2 条 buffering 记录），符合交接单预期「初始缓冲仍在，但无连环 seek」。
- 段内位置推进速率中位 1000.0 ms/s；跨段总位移无意义（位置在切歌时归零），故报告只取段内速率。

### 4.4 播放中被重新选曲的额外观测（非计划输入，如实记录）

开省电阶段诊断在 22:14:58 / 22:15:00（期间 +32.0s、+33.6s）出现**两条非本驱动发出的 `command select`**，
房间 version 4→5→6，客户端从 pos=16032ms 被拉到 tgt≈44ms，形成一次 `drift=-15988ms`：
客户端走 **load→buffering→speed(559ms/773ms) 追赶**，**没有 seek**，随后回到原速正常播放。
两次 select 与驱动的任何一次点按都对不上（驱动在采样循环内不发送任何输入），因此归因为**设备被物理触屏**
之类的计划外输入。它不污染结论，反而提供了「播放中被切歌」的真实观测：**大跨度变化走 load/speed 而不是 seek 风暴**。

### 4.5 进度条端点与拖动（第 5 项判据）— 通过

像素测量方法见 `tools/thumb_scan.py`（ffmpeg 解 PNG 为 raw rgb24 后逐列统计彩色游程长度），
截图 1080×2412、density 480dpi（1dp=3px）：

| 项 | 实测（像素） | 折算 | 设计值 |
|---|---|---|---|
| 手柄（彩色游程最大列） | 42 × 42 px 圆形，12 列同宽 | **14.0 dp** | 14dp 圆点 |
| 轨道厚度 | 15 px（767 列） | **5.0 dp** | 5dp 细轨道 |
| 亮色 | `screenshots/zoom-light-slider.png`、`light-40min-playing.png` | 圆点 + 细轨道，**无竖直长条** | — |
| 暗色 | `screenshots/zoom-dark-slider.png`、`dark-40min-playing.png` | 同上（几何完全一致，仅取色随主题） | — |

拖动（`input swipe 300 860 800 860 700`，40 分钟曲目）：

| 主题 | 拖动前位置 | 拖动后位置 | 落点解释 |
|---|---|---|---|
| 亮 | 11.83s | **1891.9s（31:31）** | 滑条 x=800 对应 78.8%，与实测 78.8% 一致 |
| 暗 | 11.76s | **1908.9s（31:49）** | 同上；且紧随其后 media_session `speed=1.04` 一拍（seek 后的变速收敛） |

对应诊断（`diag/diag-uitheme-drag.jsonl`，41.2s 窗口）：`seek=1`、`speed=7`、`buffering=8`。
**一次拖动恰好一次 seek**，是设计内的合法 seek（大跨度拖动），与修复前的每 5 秒周期性 seek 性质不同。

### 4.6 暗色冷启动无白闪 — 通过

`screenrecord` 在本机 segfault（见边界），改用连拍取证（`tools/coldstart_flash_probe.py`，采样间隔约 0.55s）：

| 帧 | 相对 `am start` | 全屏灰度均值 | 内容（目视） |
|---|---|---|---|
| flash0 | +0.87s | 48 | `screenshots/coldstart-dark-splash.png`：**深色启动窗口 + 应用图标**（即 Compose 绘制前的 window background） |
| flash1 | +1.52s | 48 | 同上 |
| flash2 | +2.31s | 48 | 同上 |
| flash3 | +3.07s | 10 | `screenshots/coldstart-dark-form.png`：暗色入房页 |
| flash4–8 | +3.58–5.94s | 10 | 暗色入房页 |

- 无任何高亮帧（阈值：均值>200 或 >230 亮像素占比>40%）。
- 机制层面一致：`values-night/themes.xml` 把 `Theme.ListenTogether` 覆写为 `android:Theme.Material.NoActionBar`（暗底），
  values 版本为 `Theme.Material.Light.NoActionBar`；即启动窗口主题随夜间模式切换，冷启动第一帧就是暗色。
- 顺带确认了图标（splash 帧里的蓝底双音符）与暗色主题取色正常。

### 4.7 听感（第 1/3 项判据，用户主观）

用户确认：**三轮播放（关省电 40 分钟测试音约 3 分钟 / 开省电同曲约 3 分钟 / 公网真实歌曲约 2.5 分钟）都连续，无卡顿。**
（本轮未做录音留证；如后续需要可加录音，见边界。）

## 五、边界（未覆盖项与问题）

1. **M2 双机未触及**：本轮全程单机单房间，成员间同步误差无法测量（缺第二台手机，维持挂起）。也没有做「成员端本机暂停不影响他人 / 房主转移 / 中途加入」。
2. **M3-LONG 未触及**：无 60 分钟+30 分钟息屏窗口；40 分钟测试音单段最长只连续播了 205s（诊断窗口 60 分钟限制不是本轮瓶颈）。
3. **省电复现方式**：用 `cmd power set-mode 1` 打开系统 low power（`low_power=1 sticky=1`），不是从设置界面开启；
   OPPO 厂商级「省电/超级省电」可能有更强的调度策略，本轮未覆盖。另：`settings put global low_power 1` 与
   `settings put system screen_off_timeout` 在本机均被 SecurityException 拒绝（陷阱 2.9）。
4. **长播放用合成测试音**：220Hz 单声道 32kbps 正弦波（tone，非音乐）。真实音乐的连续播放只在 W2 的公网阶段覆盖了约 2.5 分钟。
5. **白闪取证分辨率**：`screenrecord` 在本机 segfault（rc=139，无文件产出），改用连拍，间隔约 0.55s；
   比该间隔更短的白闪可能漏采。结论由「无高亮帧 + 启动窗口主题在 night 下为暗色」两条互证，但**不是逐帧证据**。
6. **听感为单次主观确认**，未录音；音频输出路由（扬声器/耳机/蓝牙）未在测试中单独核对。
7. **一次计划外触屏**（4.4）：造成两条额外 `select` 与一次 16s 漂移，已如实记录并解释为外部输入；未做重复实验排除其他可能。
8. **拖动为脚本化 swipe**，非人手拖拽；「拖动手感」只由落点比例 + 单次合法 seek 客观支撑，未采集手指跟手感评价。
9. 诊断只覆盖单次进程窗口（每阶段 App 重启一次），跨阶段拼接的「连续播放」不成立，故未做跨阶段时长声明。

## 六、清理

| 项 | 状态 |
|---|---|
| 本地演示后端 | 已停止（后台任务终结） |
| 设备端临时文件 | 已删 `/sdcard/ui*.xml`、`/sdcard/flash*.png`、`/sdcard/shot*.png` 等 |
| 应用连接地址 | 已恢复为原始值 `http://8.166.126.136:3000`（W1 用 127.0.0.1 隧道只是临时替换） |
| 省电 | `cmd power set-mode 0`，`low_power=0`；电池状态 `dumpsys battery reset` |
| 夜间模式 | 恢复 `no`（与测试前一致） |
| 屏幕超时 / stayon | `screen_off_timeout` 未改动；`svc power stayon true` 保留（不影响功能，下次会话可自行设置） |
| 临时房间 | 各阶段房间随 App 重启/退出结束；最后一个公网房间已用「退出房间」显式退出 |
| 产品代码 | **未改动**；APK 未重建（hash 仍 36BD3A5B…） |
| 设备诊断文件 | 保留在设备 `files/diagnostics/`（属用户设备数据，未删除） |

## 七、证据文件

- `run.log`：全部阶段的驱动日志（含每条采样、每次命令与失败信息）。*核查补充（2026-09-23 晚）：首轮归档时该文件被 `.gitignore` 的 `*.log` 规则静默排除而缺席，`.gitignore` 例外规则生效后已补录进库。*
- `diag/diag-close-lowpower-off.jsonl`（关省电，205s）、`diag/diag-open-lowpower-on.jsonl`（开省电，205s）、
  `diag/diag-autoadvance.jsonl`（自动切歌，157s）、`diag/diag-uitheme-drag.jsonl`（亮/暗拖动，41s）
- `screenshots/`：亮/暗播放与拖动后截图、进度条放大图、暗色冷启动两帧
- `w1_driver.py` / `tools/thumb_scan.py` / `tools/coldstart_flash_probe.py`：可复跑的驱动与取证脚本
