# 一起听歌 · 当前交付与验收记录

项目：D:\ListenTogether
更新日期：2026-09-24
定位：**进度唯一事实来源**。当前状态看「状态一览」，待办看「尚待验收」；每轮交付以追加「本轮新增」小节的方式登记，测试细节由 docs/test-results/<日期-场景>/ 承载，更早的历史轮次已压缩为「交付历史索引」。

## 当前状态一览（2026-09-24 收尾确认）

| 阶段 | 状态 | 说明 |
|---|---|---|
| M0 诊断与可观测性 | ✅ 完成 | 客户端诊断 JSONL（无令牌、20MB/60 分钟上限）+ 诊断分析脚本 |
| M1 会话与断线稳定 | ✅ 完成 | SessionContext/状态机/代次隔离；真机复测 + 延迟/断线/过期故障注入 |
| M2 双机同步 | ⏸ 挂起 | 缺第二台手机（外部条件触发，不能用观察客户端代替） |
| M3 稳定性 | ✅ 基本完成 | 通知栏实际点击/短时息屏/蓝牙断开/音频焦点/401 全过；M3-LONG 按用户指示挂起 |
| M4 云端部署 | ✅ 完成 | 四项部署门槛全部关闭（见下） |
| 0.2.0 收尾 | 进行中 | 转入试用反馈驱动的修复循环 |

M4 四项部署门槛（2026-09-23 晚全部关闭）：

1. 首次部署 + 13 项服务端验证 + SSH 隧道联调 9/9（2026-09-22）。
2. 真机公网 E2E 建房→播放全链路（W2，APK 36BD3A5B…，公网校时 RTT 中位 65ms）。
3. 升级/回滚演练双向通过（W3，两次 health 第 2 秒 200、13 项抽查三次各 13/0）。
4. LOAD-15 云端公网重测（W4，15 路×600s 全 206 零失败、2.847Mbps=本地基线 99.1%）。

关键锚点：

- 当前 APK 锚 **36BD3A5B3ACA74EE45CCEE952F6EB8C042BB0A18D40123601398ADF626DD0CCE**（45 项单测；W1 真机验收与 W2 公网 E2E 均以此版本；真机验收前必须回拉 base.apk 复算）。
- 云端：release **20260922-2159** 在产（20260923-2157 留作升级候选）；入口 `http://8.166.126.136:3000`。TLS 路线 A 已决策：**维持 IP 明文**（试用 ECS 无法备案、备案拦截按域名跨任意端口生效、Let's Encrypt 不签裸 IP），正式化留待转包年包月备案或迁香港。
- 云端曲库 6 首 = 5 首真实 MP3（192k）+ demo-load 负载测试音（有意保留）。
- 剩余待办与恢复条件：M2 双机（缺设备）/ M3-LONG（≥70 分钟窗口）/ TLS 正式化（用户决策）/ 补测项（蜂窝公网、弱网注入、真实令牌作废、升级失败注入），详见 [路线图与验收标准](next-development-plan.md)。

## 本轮新增（文档结构优化，2026-09-24）

- **verification.md 重建**：33 个按时间平铺的历史小节压缩为「交付历史索引」与「APK 版本历史」两张表；每轮完整证据仍在 docs/test-results/ 与归档文档中，索引行给出链接。修正过时表述（如「本轮尚未部署到云端」）。
- **计划文档收敛**：execution-plan.md 删除——M3-LONG 执行要点并入 [路线图](next-development-plan.md)，验收报告字段规范并入 [开发规范](development-standards.md)；learning.md（关键代码阅读顺序）并入 [模块索引](modules/README.md)。
- **一次性文档归档**：handover-2026-09-23.md（W1/W2 交接单，使命完结）与 playback-test-2026-09-21.md（早期播放测试）移入 [docs/archive/](archive/)，内容未删改。
- **parallel-development-plan.md 压缩**：W1–W4 已完成工作流的任务定义删除，保留完成摘要与证据链接；W5–W7、C1–C8 协调规则保留。
- 本轮为纯文档重构：未改产品代码、未重建 APK（锚 36BD3A5B… 不变）；`scripts/check-doc-links.mjs` 全量通过。

## 本轮新增（收尾汇总：全量回归 + 文档一致性 + 入口快照，2026-09-24）

> 收尾会话：不改产品代码、不动服务器；对 W1–W4 并行交付做统一回归、一致性核对与入口同步。

- **全量回归通过**（scripts/check.ps1 -Scope all）：后端 tsc 0 错误 + **7/7 测试**；安卓 testDebugUnitTest（输入未变 UP-TO-DATE，**45 项**）+ assembleDebug + lintDebug 通过（BUILD SUCCESSFUL 52s，**Lint 0 错误 0 警告**）；Markdown 本地链接检查通过。
- **APK hash 不变声明**：本轮未改产品代码、未重建 APK，锚定 36BD3A5B…；全量检索核对无并行会话引入新 hash。
- **文档一致性核对与最小合并**：「尚待验收」清单勾选与正文逐条核对一致；唯一矛盾——LOAD-15 条目（2026-09-22 行）尾巴"云端 TLS/公网重测仍属 M4 门槛"已被云端通过推翻，已就地更正。
- **入口快照同步**：AGENTS.md 快照更新为"2026-09-24 收尾确认"；parallel-development-plan.md W1/W2 标注完成（W3/W4 此前已标），T1/T2 清零；同文两处过时口径一并更正（LOAD-15 云端流量 2.2GB 估算→实测 ≈235MB/轮；"36BD3A5B 未真机验收"→已验收）。
- **工作区清理**：交接单第七节临时产物已删除（tmp-diag-*.jsonl ×4、services-dump.txt、flinger-a.txt、storm-window.txt、sync-offsets.txt，共 8 个）。
- 本轮边界：纯收尾交付——未执行真机/云端测试，未改任何产品代码、脚本与服务器状态。

## 交付历史索引（0.2.0 开发以来，新→旧）

| 日期 | 交付 | 结果 / 关键数据 | 详细记录 |
|---|---|---|---|
| 09-24 | 文档结构优化 | 本轮（见上节） | — |
| 09-24 | 收尾汇总 | check.ps1 全过（后端 7/7+安卓 45+Lint 0+链接）；W1–W4 标注完成；清理临时产物 | commit 0a8724a |
| 09-23 晚 | W4 · LOAD-15 云端重测 | 15 路×600s 公网直连全 206 零失败、2.847Mbps=基线 99.1%；出网约 235MB/轮（旧估算 2.2GB 高一个数量级）；demo-load 上云保留 | [load15-cloud](test-results/2026-09-23-load15-cloud/README.md) |
| 09-23 晚 | W3 · 升级/回滚演练 | 升级到 20260923-2157 → 真实回滚到 20260922-2159 双向通过；PID 4191→14935→15175；13 项抽查三次各 13/0；restart 清空内存房间已实证；CRLF 清单与硬编码曲目两坑回填 | [m4-rollback-drill](test-results/2026-09-23-m4-rollback-drill/README.md) |
| 09-23 晚 | W1+W2 真机轨道 | W1：先纠正装机偏差（设备实为 169018AE→重装 36BD3A5B 回拉锚定）；关省电 180s 位置 1.001x 且 `seek=0`、开省电 `speed` 追赶 9 条、自动切歌零 seek、端点 14dp 圆点/5dp 轨道、暗色冷启动无白闪、听感用户确认。W2：同一 APK 公网七步全链路（version 2→9）、RTT 中位 65ms、第二房间复测通过 | [w1-recheck](test-results/2026-09-23-w1-recheck/README.md)、[m4-public-e2e](test-results/2026-09-23-m4-public-e2e/README.md) |
| 09-23 晚 | 并行开发推进方案 | 待办组织为 W1–W7 + C1–C8 冲突协调；真机轨道∥云端轨道 | [parallel-development-plan.md](parallel-development-plan.md) |
| 09-23 傍晚 | TLS/域名检查→路线 A | 备案拦截按域名（Host/SNI）跨任意端口生效（8443 对照实验推翻"非标端口可用"）；试用 ECS 无法备案；LE 不签裸 IP；用户决策维持 `http://8.166.126.136:3000` 明文 | [陷阱 8.6](development-pitfalls.md) |
| 09-23 傍晚 | 卡顿修复+进度条端点 | 根因=省电降频致渲染 underrun→每 5 秒 seek 风暴（0.86x 漂移）；分级纠正（500ms–2.5s 变速追赶、>2.5s 才 seek）+SmoothRenderers 0.7s 缓冲+每秒自检；进度条 14dp 圆点手柄；单测 45；APK 36BD3A5B | [交接单（归档）](archive/handover-2026-09-23.md)、[同步模块](modules/04-synchronization.md)、陷阱 9.1 |
| 09-23 中午 | 曲库工具链+全量转码 | add-media.ps1+media-manage.sh；云端 5 首 320k→192k（47.2→31.6MiB，-33%）；EAP=Stop 吞 stderr 警告坑回填 | [deployment.md 第 6 节](deployment.md) |
| 09-23 上午 | UI 优化真机验证 | 地址折叠/退出确认/返回 Toast 等目视通过（APK 169018AE）；Toast 不进 dump 等坑回填 | [ui-optimize](test-results/2026-09-23-ui-optimize/README.md) |
| 09-23 凌晨 | UI 系统评审+优化批次 | 2 致命/8 重要/7 建议分级清单，落地 12 项；APK 169018AE；单测 42 | [ui-refresh](test-results/2026-09-23-ui-refresh/README.md) |
| 09-23 凌晨 | 公网超时定位 | VS Code Remote 常驻会话三次触发全局 OOM→整机冻结（全端口超时的真面目）；服务本身 NRestarts=0；严禁服务器跑重负载 | [陷阱 8.5](development-pitfalls.md) |
| 09-23 | 简洁 UI 重构 | 首页 Tab/单主按钮/轻量歌单；APK 59773A08；本地 reverse 真机通过（公网因 OOM 超时未测） | [ui-refresh](test-results/2026-09-23-ui-refresh/README.md) |
| 09-22 深夜 | 图标+公网链路 | 图标 BE545EEF 装机；真机 curl 公网 200 首个数据点；E2E 自动化 6 连败暂停（陷阱 3.4） | [m4-public-test](test-results/2026-09-22-m4-public-test/README.md) |
| 09-22 深夜 | 公网开启+真实曲库 | HOST 0.0.0.0（安全组放行后真机可达）；云端曲库换 5 首真实 MP3 | — |
| 09-22 深夜 | M4 首次部署 | Node 24/listen 账号/releases+符号链接；服务端 13/13+SSH 隧道 9/9；个人音频误打包纠偏 | [m4-first-deploy](test-results/2026-09-22-m4-first-deploy/README.md) |
| 09-22 晚 | M3-AUTH 横幅复验通过 | 832FB65E 回拉一致；401 文案 5/5、"已同步"0/5（校时不覆盖暂停修复成立）；挂起项关闭 | [m3-auth-recheck](test-results/2026-09-22-m3-auth-recheck/README.md) |
| 09-22 晚 | M4 盘点+部署准备 | SSH 打通（authorized_keys 未写入所致）；服务器 1.7Gi 无 swap、Node 未装；package-deploy.ps1 实跑 | [m4-inventory](test-results/2026-09-22-m4-inventory/README.md) |
| 09-22 | 无线调试通道打通 | connect-wireless.ps1 一体化 connect+reverse+自检；无线 reverse 完全可用实锤 | 陷阱 2.7 |
| 09-22 | 架构文档+UI 交互修补 | [architecture.md](architecture.md)（分层/依赖/数据流/不变式）；imePadding/Snackbar/退出快捷键/滑块禁用说明；APK 5DA5082A | — |
| 09-22 | M3-LONG 物料+检查入口 | check.ps1/check-doc-links.mjs；demo-hour 70 分钟测试音+m3long-sample.ps1（真机执行仍挂起）；单测 32 | — |
| 09-22 | M3-FOCUS 音频焦点 | 抢占/来电本机暂停 ≤300ms、无自动恢复、明确点击续播；localPause 边沿诊断修复 | [m3-focus](test-results/2026-09-22-m3-focus/README.md) |
| 09-22 | M3-AUTH+LOAD-15 本地 | audio401 注入自测 10 项；真机 401 四次即停（8CF98CE1）；15 路本地 600s 2.873Mbps；负载成员必须持 WS 坑回填 | [m3-auth](test-results/2026-09-22-m3-auth/README.md)、[load15](test-results/2026-09-22-load15/README.md) |
| 09-22 | M3 稳定性批次 | 通知栏实际点击走服务端 pause；息屏 75s；蓝牙断开本机暂停；404→暂停→恢复续播 | [m3-notification-device](test-results/2026-09-22-m3-notification-device/README.md)、[m3-bluetooth-audio-error](test-results/2026-09-22-m3-bluetooth-audio-error/README.md) |
| 09-21 | 界面重构+拖动修复 | M3 Google 蓝 UI；乐观预览修复拖动回跳；开发陷阱清单建档 | [播放测试（归档）](archive/playback-test-2026-09-21.md) |
| 09-21 | M1 真机复测+故障注入 | 重连→404→Expired 全链路；300ms 延迟保持 Ready；12s 断线自动恢复；超宽限真实 Expired | [m1-session-device](test-results/2026-09-21-m1-session-device/README.md)、[m1-fault-proxy](test-results/2026-09-21-m1-fault-proxy/README.md) |
| 09-21 | M1 会话加固 | SessionContext/状态机/ClockEstimator/诊断 JSONL/可注入传输层；单测 21 | 同上 |
| 09-21 前 | 0.2.0 基线 | SDK35/JDK17 构建打通；音频焦点误恢复修复；应用图标；demo-media；build/start/install/smoke 脚本 | git 历史 |

## APK 版本历史（新→旧）

| SHA256 | 日期 | 内容 | 单测 | 真机状态 |
|---|---|---|---|---|
| 36BD3A5B3ACA74EE45CCEE952F6EB8C042BB0A18D40123601398ADF626DD0CCE | 09-23 | 分级纠正+SmoothRenderers+进度条圆点 | 45 | **当前锚**：W1 验收+W2 公网 E2E 通过 |
| 169018AE746164D274E9C843AC8985A1DD27B647D6BF28DFA05110B705FB6845 | 09-23 | UI 评审优化 12 项 | 42 | UI 优化真机验证通过（后被覆盖） |
| 59773A08ACB9A4FBFF815C8FEDF3680B55FC7FA4EDA992FC6DC664EFB7119EED | 09-23 | 简洁 UI 重构 | 42 | 无线本地 reverse 目视通过 |
| BE545EEFE1C3260A8F4E00C88D8C4C14A62F1A442E7D717978107E79B4E60924 | 09-22 | 图标去紫→Google 蓝 | 36 | 装机 Success（桌面目视未做） |
| 5DA5082AA630A10AE324172FFA4B46F9D073A2AB4BDD07F6082EEA4C67D9119F | 09-22 | UI 交互修补 4 项 | 36 | 未真机目视（并入后续批次） |
| 832FB65EA4B606EB1C3EBFCE0EEAA887C585097D30219C1B11ED3884F907D09B | 09-22 | 校时不覆盖暂停提示 | 26 | 401 横幅复验通过（5/5） |
| 8CF98CE13507090BC45746B8E1F766CB87839B8B1EE57728E91096F15795BACA | 09-22 | M3 焦点+localPause 边沿诊断 | 25 | M3-AUTH 真机 401 首验通过 |
| 74BB193C670A9DB0F73FE8F2B5E7BCCFD62ECFD77DB07F7833E02FF541F5BBAF | 09-22 | 播放失败分类 | 25 | 蓝牙/404 恢复真机 |
| D30EE0EE455C6F16102592896EF11236F74907416A8E6A4546A9AE0D877940FB | 09-22 | 通知栏/息屏 | — | 通知栏点击+息屏真机 |
| 9AD0BD1DBEF839D6966AF5F0DF5DD47F3CF0EC16A454D772ED7C75E039DB2B22 | 09-21 | 界面重构 | — | 播放/暂停回归 |
| 139EC36C38A729351833DE01526B9904A2D5483E7E93F44826CE8628D059D839 | 09-21 | M1 会话加固 | 21 | M1 真机复测 |
| 228BB0B0A1CA2B169523D51FA14A477625F3E938A60E9FA99929B5004BB62939 | 09-21 | 上一轮基线 | — | — |

## 尚待真机与云端验收

- [x] 手机实际创建房间、选歌、播放、暂停、拖动进度；用户确认有声音。
- [x] 断线重连状态机：服务器死亡→退避重连→404 过期→退出重新入房（2026-09-21 真机故障注入）。
- [x] 受控断线恢复与延迟注入：12 秒断线自动恢复、300ms 延迟校时稳定（2026-09-21）。
- [ ] 两台安卓手机同时听歌并测量同步误差，不能把 WebSocket 测试当作实际音频同步验证（M2，缺第二台手机挂起）。
- [x] 后台与短暂息屏继续播放，系统媒体会话暂停控制。
- [x] 通知栏按钮实际点击（2026-09-22 真机）。
- [x] 耳机拔出等价路径：蓝牙断开触发本机暂停、重连不自动恢复（2026-09-22）。
- [x] 音频错误重试：404→暂停→恢复文件后手动重试续播（2026-09-22）。
- [x] M3-FOCUS：其他媒体持久抢占与真实来电中断（2026-09-22）；去电、拒接、VoIP 抢占未测。
- [ ] M3-LONG：60 分钟连续播放，含至少 30 分钟息屏；demo-hour 70 分钟测试音与采样脚本已备，按用户指示挂起。
- [x] M3-AUTH：注入 401 真机路径 + 横幅持久性复验均通过；真实令牌作废场景无入口，保持标注。
- [x] LOAD-15：本地 600s 通过（2.873Mbps）；云端公网重测通过（2.847Mbps=99.1%，2026-09-23 晚）；throughput 模型未在云端执行（流量预算取舍，如实标注）。
- [ ] 成员端本地暂停不影响其他人、房主转移、中途加入（需第二台手机）。
- [x] 云端首次部署 + 13 项服务端验证 + SSH 隧道联调（2026-09-22）。
- [x] 公网验证：真机经 `http://8.166.126.136:3000` 完成建房→播放全链路（2026-09-23 晚，APK 36BD3A5B…）。**部分覆盖**：仅 Wi-Fi 出口；蜂窝未测（无线调试依赖 Wi-Fi，切蜂窝断 adb，需 USB 或第二台手机补）。
- [x] W1 卡顿修复真机验收（2026-09-23 晚，关/开省电、自动切歌、端点像素、暗色冷启动、听感确认全过）。
- [ ] 公网弱网/丢包/抖动条件下的真机表现（未测；fault-proxy 注入此前只在本地用过）。
- [x] 版本回滚演练：升级 + 真实回滚双向通过（2026-09-23 晚，13 项抽查三次各 13/0）；两次 restart 各清空一次内存房间已实证。升级失败注入未做（如实标注）。
- [x] 15 路实际音频带宽云端重测（2026-09-23 晚）。**M4 四项部署门槛至此全部关闭**。

## 环境与联调速查

- 本地后端：`.\scripts\start-demo.ps1`（前台窗口）；健康检查 `http://127.0.0.1:3000/health`；后端重启清空内存房间。
- 真机 USB：`.\scripts\install-debug.ps1`（装 APK + reverse + 启动）；多设备加 `-Serial`。
- 真机无线：`.\scripts\connect-wireless.ps1 -DebugHost <IP:调试端口> -Port 3000,3001 -Install -Verify`；配对端口≠调试端口且每次轮换；连接/reverse 必须单命令块完成（陷阱 2.7/2.8）。
- 公网入口：手机直接填 `http://8.166.126.136:3000`，无需 adb。
- 云端运维：`ssh aliyun`；升级/回滚见 [deployment.md 第 5 节](deployment.md)，曲库管理见第 6 节（替换音频后必须重启，重启清房间）；**严禁在服务器跑 VS Code Remote/重负载**（陷阱 8.5）。
- 项目级检查：`.\scripts\check.ps1 -Scope all`（后端 tsc+测试、安卓单测+构建+Lint、文档链接）。
- 动手前必读：[开发陷阱清单](development-pitfalls.md)。

## 测试记录入口（docs/test-results/）

| 记录 | 内容 |
|---|---|
| [2026-09-21-m1-session-device](test-results/2026-09-21-m1-session-device/README.md) | M1 真机复测：状态机全链路、诊断 JSONL |
| [2026-09-21-m1-fault-proxy](test-results/2026-09-21-m1-fault-proxy/README.md) | M1 故障注入：延迟/断线/宽限过期 |
| [2026-09-22-m3-notification-device](test-results/2026-09-22-m3-notification-device/README.md) | 通知栏实际点击、息屏播放 |
| [2026-09-22-m3-bluetooth-audio-error](test-results/2026-09-22-m3-bluetooth-audio-error/README.md) | 蓝牙断开、音频 404 恢复 |
| [2026-09-22-m3-focus](test-results/2026-09-22-m3-focus/README.md) | 音频焦点抢占与来电中断 |
| [2026-09-22-m3-auth](test-results/2026-09-22-m3-auth/README.md) | 401 注入自测 + 真机首验 |
| [2026-09-22-m3-auth-recheck](test-results/2026-09-22-m3-auth-recheck/README.md) | 横幅持久性复验（832FB65E） |
| [2026-09-22-load15](test-results/2026-09-22-load15/README.md) | LOAD-15 本地基线 2.873Mbps |
| [2026-09-22-m4-inventory](test-results/2026-09-22-m4-inventory/README.md) | 云端只读盘点 |
| [2026-09-22-m4-first-deploy](test-results/2026-09-22-m4-first-deploy/README.md) | M4 首次部署 13/13 + 隧道 9/9 |
| [2026-09-22-m4-public-test](test-results/2026-09-22-m4-public-test/README.md) | 公网 E2E 自动化失败记录（陷阱 3.4） |
| [2026-09-23-ui-refresh](test-results/2026-09-23-ui-refresh/README.md) | 简洁 UI 交付记录 |
| [2026-09-23-ui-optimize](test-results/2026-09-23-ui-optimize/README.md) | UI 优化真机验证 |
| [2026-09-23-w1-recheck](test-results/2026-09-23-w1-recheck/README.md) | W1 卡顿修复真机验收 |
| [2026-09-23-m4-public-e2e](test-results/2026-09-23-m4-public-e2e/README.md) | W2 公网 E2E 通过 |
| [2026-09-23-m4-rollback-drill](test-results/2026-09-23-m4-rollback-drill/README.md) | W3 升级/回滚演练 |
| [2026-09-23-load15-cloud](test-results/2026-09-23-load15-cloud/README.md) | W4 云端 15 路重测 |

历史过程记录：[2026-09-21 播放测试](archive/playback-test-2026-09-21.md)（操作过程、状态采样与问题处理，已归档）；W1/W2 交接单 [handover-2026-09-23](archive/handover-2026-09-23.md)（卡顿根因完整分析，已归档）。
