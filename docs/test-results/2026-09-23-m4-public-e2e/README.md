# W2 · M4 真机公网 E2E（2026-09-23 晚）

## 一、标识

| 项 | 内容 |
|---|---|
| 任务编号 | W2（真机轨道；对应 verification「公网验证」项与 M4 部署门槛第 3 步的「从公网网络真机播放验证」） |
| 日期 | 2026-09-23 22:28–22:35（GMT+8） |
| 操作者 | AI 会话执行全部 adb/UI 操作与数据采集 |
| 结论 | **通过**（建房→选歌→播放→暂停→拖动→切歌→退出全链路；边界见第五节） |
| 前置 | W1 已通过（[记录](../2026-09-23-w1-recheck/README.md)），且**使用同一个 APK**，满足并行方案 C4「版本锚定」 |
| 云端时间片 | **已声明占用**（并行方案 C1）：本窗口内**未**重启 / 升级 / 回滚 / 变更曲库，仅做只读状态查询 |

全程**未改动任何产品代码**，未重新构建 APK。

## 二、环境

| 项 | 实测值 |
|---|---|
| APK | `36BD3A5B3ACA74EE45CCEE952F6EB8C042BB0A18D40123601398ADF626DD0CCE`（与 W1 同一制品，设备端 base.apk 回拉复算一致） |
| 云端入口 | `http://8.166.126.136:3000`（明文，TLS 路线 A 决策，见 [verification](../../verification.md)） |
| 后端版本 | release `20260922-2159`（`/opt/listen-together/current-version.txt`） |
| 服务状态 | `systemctl` ActiveState=active / SubState=running；ActiveEnterTimestamp=2026-09-23 12:05:26 CST；**NRestarts=0**（本窗口未重启） |
| 监听 | `0.0.0.0:3000`（pid 4191） |
| 云端资源 | `free -m`：total 1735 / used 533 / available 1202 MB（轻载，无 OOM 迹象） |
| 可达性 | PC 侧 `curl http://8.166.126.136:3000/health` = `{"ok":true}`；**设备端** `adb shell curl .../health` = `{"ok":true}` |
| 曲库 | 云端 5 首真实 MP3（192kbps）：有何不可 4:01 / 痴心绝对 4:22 / 单车 3:28 / 富士山下 4:19 / 句号（视口内只渲染到前 4 首） |
| 设备 | OPPO PHQ110 / Android 14；无线 adb（调试端口 38131） |
| 网络 | 手机经 Wi-Fi（热点出口）访问公网，全链路真实公网 RTT |
| 音频输出 | 手机本机输出；未使用耳机/蓝牙 |
| 地址切换方式 | 直接写 `ConnectionStore`（SharedPreferences `connection.xml` 的 `baseUrl`）后冷启动，**不使用 Compose 输入框自动化**（陷阱 3.4） |

## 三、操作

前置：W1 全部通过；确认云端 active 且无重启计划；声明占用云服务时间片。

```
# 1) 公网可达性（两端各测一次）
curl -s -m 8 http://8.166.126.136:3000/health                      # PC 侧
adb -s <serial> shell curl -s -m 8 http://8.166.126.136:3000/health # 设备侧
# 2) 把手机地址从 127.0.0.1:3000 切到公网（写存储层 + 冷启动）
adb -s <serial> shell "run-as com.listentogether.app sh -c 'echo <base64(xml)> | base64 -d > shared_prefs/connection.xml'"
adb -s <serial> shell am force-stop com.listentogether.app; am start -n com.listentogether.app/.MainActivity
# 3) 全链路 UI 驱动（w1_driver.py 的 e2e / e2e2 / w2shot 阶段；每步用当次 dump 的坐标）
# 4) 导出设备诊断
adb -s <serial> shell run-as com.listentogether.app cat files/diagnostics/diag-*.jsonl
```

被测链路（每步均落到设备诊断 + media_session 采样）：

| 步 | 动作 | 结果 |
|---|---|---|
| 1 | 创建房间 | 房间 **83888A9C**，1 人一起听 / 已连接，房间 version 2 |
| 2 | 选歌（有何不可 4:01）并播放 | `PlayerState PLAYING`，pos=8854ms，buffered=**87353ms（整首已缓冲）**，speed=1.00 |
| 3 | 持续播放采样 | 3 × 5s 采样全 PLAYING，位置单调推进 |
| 4 | 暂停（点 FAB，走服务端 command pause） | `PAUSED`，pos 冻结在 24800ms，speed=0.0 |
| 5 | 拖动进度条（暂停态，`input swipe 300 860 700 860 700`） | pos **24800 → 161423ms**（目标 2:41），落点生效 |
| 6 | 切歌（选「痴心绝对」） | 客户端 `command select` → 自动继续播放；诊断 trackId `he-bu-ke` → `chi-xin-jue-dui` |
| 7 | 退出房间（顶栏图标 → 确认对话框「退出房间？」→ 确认） | 回到入房页（EditText 数 1，文本含「此刻，一起听 / 创建房间 / 加入房间 / 怎么称呼你」） |
| 8 | 复测单曲链路（第二次建房，验证可重复性） | 房间 **4EC9D5D1**，播放「单车」，随后同样显式退出 |

设备诊断里的命令时间线（相对进程起点，`diag/diag-public-fullchain.jsonl`）：

```
-0.7s  connection join        generation=1
-0.1s  connection socket-open generation=1
+9.9s  command select         房间 version 2 -> 3
+15.5s command play                          -> 4
+40.5s command pause                         -> 5
+45.6s command seek           pos 24804 -> tgt 161423, drift +136619ms  -> 6
+50.9s command select（切歌）  pos 161423 -> tgt 0,      drift -161423ms  -> 7
+57.4s command play                          -> 8
+146s  退出房间（DELETE）                     -> 9
```

## 四、数据

| 指标 | 实测 | 说明 |
|---|---|---|
| 公网校时 RTT | 全链路 30 样本，**中位 65ms / 最大 123ms** | 本地 W1 对照：18–19ms |
| 校时偏移稳定性 | `offsetMs` 极差 **27ms**（全链路）/ **13ms**（单曲会话） | 公网下无振荡 |
| 单曲会话 RTT | 9 样本，中位 **53ms** / 最大 119ms | 第二个房间 |
| 位置推进速率 | diag 逐条中位 **998.9 ms/s**（全链路）/ **992.5 ms/s**（单曲） | ≈1x |
| `\|driftMs\|` | 中位 164ms / 19ms；最大 161423ms | 最大值即拖动那一次（合法） |
| `correction` 分布（全链路 147s） | 空 217 / buffering 10 / **load 2** / **speed 3** / **seek 2** | seek 仅 2 条且间隔 5.35s：一次是大跨度拖动、一次是切歌装载归零，**非周期性** |
| 房间 version | 2 → 9（join/select/play/pause/seek/select/play/leave） | 与命令时间线一一对应 |
| 切歌后新段诊断 | `chi-xin-jue-dui` 段：**seek=0**、speed=3、buffering=2 | 与 W1 自动切歌结论一致 |
| 整首缓冲 | buffered=87353ms（= 文件全长 4:01） | 公网带宽足够一次性拉完短曲 |
| 媒体会话状态 | 每次采样均 `PLAYING`，未出现 BUFFERING | 切歌、拖动都未造成可观测空档 |
| 退出后状态 | 应用回到入房页；无残留房间 | 两房间均显式退出 |

现场截图：`screenshots/public-playing.png`（房间 4EC9D5D1、「单车」播放中、进度条在走；画面左缘被系统音量浮层遮住一条，不影响结论）。

## 五、边界（未覆盖项与问题）

1. **只覆盖一种公网网络**：无线调试本身跑在 Wi-Fi 上，切到蜂窝会立刻断掉 adb 链路，因此**无法**在保持可观测的前提下完成「两种公网网络」的第二条；verification 中该项的原始条件（两种网络）只满足了第一条（Wi-Fi 出口的真实公网路径）。蜂窝网络的真机验证需要 USB 有线调试或第二台手机的配合。
2. **明文 HTTP**：入口是 `http://8.166.126.136:3000`（路线 A 决策），本轮**未涉及 TLS/WSS**；也未做明文链路的窃听/篡改评估。
3. **单机单房间**：没有第二台手机，因此本记录**不产生任何 M2 双机同步数据点**，成员暂停/房主转移/中途加入同样未测。
4. **未注入公网弱网**：fault-proxy 的延迟/断线注入只在本地用过，公网丢包/抖动/弱网下的表现未测。
5. **未做云端负载与发布演练**：15 路云端重测（W4）与升级/回滚（W3）不在本工作流内，需要各自独占服务时间片。
6. **曲库覆盖不全**：视口内只渲染到 4 首（有何不可/痴心绝对/单车/富士山下），第 5 首「句号」未在本次视口内出现，未验证其可播。
7. **拖动为脚本化 swipe**（非人手），只验证了「落点比例正确 + 单次合法 seek」。
8. **采样间隔的口径**：驱动里 5s 的 `sleep` 加上 `dumpsys media_session` 往返约 0.5–1s，因此**逐点差值约 6s**，逐点比值（≈1.2x）不可直接当速率读；本报告只用诊断记录（1s 粒度）与采样循环实测墙钟推出的速率。
9. **未复验真实令牌作废**（后端无入口，沿用既有标注）。
10. 云服务唯一例外操作是一次**只读** SSH（`systemctl show` / `free -m` / `ss -lntp`），未产生任何重启或配置变更。

## 六、清理

| 项 | 状态 |
|---|---|
| 云端房间 | 83888A9C、4EC9D5D1 均已用「退出房间」显式退出，无残留 |
| 云端服务 | **未重启、未升级、未改曲库**；NRestarts 仍为 0；本窗口结束后**释放云服务时间片** |
| 手机地址 | 保留 `http://8.166.126.136:3000`（测试前的原始值，未改回） |
| 省电 / 夜间模式 | `low_power=0`、`uimode night no`（与测试前一致） |
| 本地演示后端 | 已停止 |
| 设备端临时文件 | 已删 `/sdcard/ui*.xml`、`/sdcard/*.png` 等 |
| 产品代码 / APK | 未改动、未重建 |

## 七、证据文件

- `run.log`：W2 阶段的驱动日志（22:28–22:35 全量，含每步采样与失败信息）
- `diag/diag-public-fullchain.jsonl`：全链路会话（147s、234 条播放记录、命令时间线）
- `diag/diag-public-single-song.jsonl`：第二个公网房间（40s、71 条，`seek=0`）
- `screenshots/public-playing.png`：公网房间真实歌曲播放现场
- `w1_driver.py`：可复跑的驱动（`e2e` / `e2e2` / `w2shot` 阶段）
