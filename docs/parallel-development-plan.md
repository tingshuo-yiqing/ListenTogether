# 并行开发推进方案

制定日期：2026-09-23；2026-09-24 随收尾压缩（W1–W4 已完成，任务定义删除、保留完成摘要）。性质：**推进方案，不是测试报告**；执行结果只登记在 [verification.md](verification.md)，验收标准见 [路线图](next-development-plan.md)。本文回答：现在有什么可做、哪些能并行、冲突怎么协调。

---

## 1. 2026-09-24 历史状态快照（模块 × 状态）

以下表格保留当时编排背景；当前曲库、部署版本、APK 与测试数量一律见 [verification.md](verification.md)，不要用于当前验收。

| 模块（见[架构文档](architecture.md)） | 当前状态 | 关键证据 |
|---|---|---|
| 01 Android UI | 已实现；简洁 UI + 优化批次 + 进度条端点真机验证通过 | [ui-optimize](test-results/2026-09-23-ui-optimize/README.md)、[w1-recheck](test-results/2026-09-23-w1-recheck/README.md) |
| 02 网络与会话 | 已实现并真机验证（状态机/代次隔离/重连/401） | m1 / m3-auth-recheck 记录 |
| 03 播放服务 | 分级纠正 + SmoothRenderers 真机验收通过（W1） | [w1-recheck](test-results/2026-09-23-w1-recheck/README.md) |
| 04 同步算法 | SyncMath 分级纠正落地；`speed` 变速追赶真机实测确认 | SyncMathTest、[w1-recheck](test-results/2026-09-23-w1-recheck/README.md) |
| 05/06/07 后端房间/HTTP/WS | 已实现并稳定 | 首次部署 13/13 |
| 08 曲库与音频 | 云端 6 首（5 首真实 192k + demo-load）；工具链就绪 | [deployment.md](deployment.md) 第 6 节 |
| 09 构建/部署 | 云端单实例运行中（release 20260922-2159）；升级/回滚演练双向通过 | [m4-rollback-drill](test-results/2026-09-23-m4-rollback-drill/README.md) |
| 10 测试与诊断 | 45 项安卓单测 / 7 项后端测试 / Lint 0 | verification.md |

待办全景：

| 编号 | 事项 | 状态 |
|---|---|---|
| T1–T4 | 卡顿真机验收 / 公网 E2E / 升级回滚演练 / 15 路云端重测 | **全部完成**（2026-09-23 晚，M4 四门槛关闭） |
| T5 | M2 双机同步 | **阻塞**：缺第二台手机 |
| T6 | M3-LONG | **已完成**（2026-09-24：真实音乐顺播 70 分钟 + 息屏 30 分钟 + 多人进出，见 [long-multiplayer](test-results/2026-09-24-long-multiplayer/README.md)） |
| T7 | UI 遗留目视项（分享面板/非房主 Snackbar/通知权限延迟/大字体/平板限宽） | 随下次真机批次顺带 |
| T8 | TLS/域名正式化 | **路线 A 已决策**：试用期维持 IP 明文；转正式实例或迁香港时再解决 |

## 2. 共享资源与硬约束（并行可行性的物理边界）

| 资源 | 约束 | 出处 |
|---|---|---|
| 真机 PHQ110（唯一） | 真机任务互斥；无线 adb 需亮屏 + 单命令块完成 connect/reverse | 陷阱 2.7、2.8 |
| 云端 ECS（1.7Gi+2G swap，内存态） | 重启即清空房间；**严禁同机跑 VS Code Remote/重负载**；重测与升级不能同时进行 | 陷阱 8.5、2.3 |
| 公网出网流量 | 大陆地域免费 20GiB/月；LOAD-15 实测 ≈235MB/轮 | verification.md |
| APK 版本 | 改码即换锚，真机/公网结论必须与 hash 绑定（该历史轮锚 36BD3A5B；当前锚见 verification） | verification.md |
| 共享文档 | verification.md、AGENTS.md、模块文档、陷阱清单被所有工作流写入 | 开发规范 |

## 3. 已完成工作流摘要（W1–W4，2026-09-23 晚）

| 工作流 | 结果 | 记录 |
|---|---|---|
| W1 真机验收批次 | 关省电 180s 位置 1.001x 且 `seek=0`；开省电 `speed` 追赶 9 条；自动切歌零 seek；端点 14dp 圆点/5dp 轨道；暗色冷启动无白闪；听感用户确认。执行前纠正装机偏差（169018AE→重装 36BD3A5B 回拉锚定） | [w1-recheck](test-results/2026-09-23-w1-recheck/README.md) |
| W2 公网 E2E | 同一 APK 经 `http://8.166.126.136:3000` 七步全链路（version 2→9）；RTT 中位 65ms；第二房间复测通过 | [m4-public-e2e](test-results/2026-09-23-m4-public-e2e/README.md) |
| W3 升级/回滚演练（两段式） | 升级到 20260923-2157 → 真实回滚到 20260922-2159；两次 health 第 2 秒 200；13 项抽查三次各 13/0；restart 清房间实证；新 release 留作升级候选 | [m4-rollback-drill](test-results/2026-09-23-m4-rollback-drill/README.md) |
| W4 LOAD-15 云端重测 | 15 路×600s 全 206 零失败、2.847Mbps=基线 99.1%；demo-load 上云保留；C1 时间片已释放 | [load15-cloud](test-results/2026-09-23-load15-cloud/README.md) |

依赖结构复盘：真机轨道（W1→W2）与云端轨道（W3→W4）唯一耦合是云端服务稳定性而非代码；W2 必须先于 W4（公网链路先证明，重测数据才可归因），W3 建议先于 W4（先确认回滚可靠，再固化基线）。该结构已走完，M4 收官。

## 4. 待执行工作流（外部条件触发）

### W5 · M2 双机同步（阻塞）

- 恢复条件：第二台真实安卓手机到位。恢复时先补测量方案再执行（`speed` 纠正进入 95%≤500ms 指标的统计口径），验收标准见[路线图第 3 节](next-development-plan.md)。挂起期间不调整同步参数。

### W6 · M3-LONG（**2026-09-24 已完成**）

- 以"真实音乐顺播 70 分钟 + 息屏 30 分钟 + 多人动态进出"组合形式完成（非合成测试音方案），记录见 [long-multiplayer](test-results/2026-09-24-long-multiplayer/README.md)。

### W7 · 长期对策与收尾（P2，条件触发）

- 渲染欠载长期对策（省电提示 UI / offload 评估）——若立项属 Android 代码改动，须重新走"构建 → 单测 → 新 hash → 真机"锚定流程。
- TLS 正式化（转包年包月备案 / 迁香港）；小项：8443 安全组规则可关闭（不影响功能）；strings.xml 抽取单独立项。
- 文档轨道：任何工作流结束时同步 verification/AGENTS/模块文档 + `check-doc-links.mjs` + git 提交（push 用 `git -c http.proxy=http://127.0.0.1:7890 push origin main`）。

## 5. 冲突协调规则（下次并行会话前必读）

| # | 冲突 | 风险 | 协调规则 |
|---|---|---|---|
| C1 | 多会话同时操作云端服务 | 重启清房间打断 E2E；重测中途升级直接失败 | **云端服务所有权时间片**：开始前声明占用，结束（含 health 复核）后释放；切换间隔 ≥5 分钟观察期 |
| C2 | 真机单台 | 真机任务互斥 | 合并为"批次"执行（一次连接完成多项），减少无线通道重连次数（端口每次轮换） |
| C3 | verification.md / AGENTS.md 多写者 | 并行会话互相覆盖进度记录 | 单写者原则：进度文档只在收尾时一次性写入；中间发现记录进各自 test-results，最后汇总 |
| C4 | APK hash 漂移 | 测试结果无法归因（代码 vs 网络） | **版本锚定**：全程 pin 当前锚；改码后所有真机结论重新关联新 hash |
| C5 | 云端曲库变更需重启（时长缓存） | 与 C1 叠加 | 曲库上传并入同一云端占用时间片内（上传→重启→确认→开测） |
| C6 | 流量 20GiB/月 | 重测流量预算 | 先 60 秒短试跑确认全 206，再跑完整轮；预留失败重跑一次的预算 |
| C7 | ECS 内存 OOM（陷阱 8.5） | 全端口超时误判为"服务挂了" | 执行期间 ssh 仅限 `free -m`/`journalctl -n` 轻量观察；任何会话不得在服务器起 IDE/构建/转码 |
| C8 | 后端重启丢房间（内存态） | 用户正在试用的房间被清 | 涉及 restart 的动作避开用户实际使用时段，执行前确认无活跃房间 |

## 6. 维护约定

- 本文是**快照型方案**：工作流状态变化时由当轮会话更新对应条目并同步 verification.md；不在此处登记测试结果。
- 新任务出现时先判断：占不占用真机/云端时间片、是否产生新 APK hash、要不要动后端代码——三者分别触发 C2/C4/C1 协调规则。
- 单个任务的执行步骤与证据要求见[路线图](next-development-plan.md)与[开发规范](development-standards.md)；两者与本文冲突时以操作与证据要求为准。
