# 10 测试、诊断与验收

## 当前资产与覆盖
server/test：7项测试组，覆盖房间权限/生命周期、HTTP/Range、15个WS、真实MP3解析和坏清单。
android/app/src/test：6 项 ClockEstimator、13 项 RoomClient 会话竞态、5 项同步数学、4 项本地播放策略、4 项播放失败分类、4 项时间格式化、6 项 UI 状态语义回归，共 42 项（2026-09-23）。
诊断：debug 构建 DiagnosticsLog 已实现（连接/校时/播放事件 JSONL，单文件约20MB、实例创建起60分钟窗口，超限停止写入，不自动轮转，不含令牌）；等待双机实测采集。
smoke-test.mjs：对运行后端执行HTTP、两个WS及真实Range验证。
check-doc-links.mjs：扫描项目 Markdown 的本地链接；跳过外部 URL、锚点和不参与文档验证的构建/依赖目录。
fault-proxy.mjs / fault-proxy-selftest.mjs：故障注入代理与其自测（延迟、断线、恢复、音频 401 注入，共 10 项）。
load15.mjs：15 路负载脚本（playback 码率模型 + throughput 容量模型），见 [LOAD-15 记录](../test-results/2026-09-22-load15/README.md)。
demo 曲库：demo-soft/demo-high/demo-long（40 分钟）+ demo-load（11 分钟 192kbps，负载与码率模型专用）。
PHQ110真机报告覆盖单机出声、暂停/跳转/切歌、后台、短时息屏和媒体会话暂停。完整证据见 [记录](../archive/playback-test-2026-09-21.md)。
2026-09-22 补：通知栏播放/暂停按钮真实点击（点后服务端 command pause）与 Dozing 息屏播放，见 [M3 记录](../test-results/2026-09-22-m3-notification-device/README.md)。
2026-09-22 补：蓝牙耳机断开→本机暂停、重连不自动恢复、明确播放后追赶；音频 404（改名长测试音并拖到未缓冲区）→ERROR_CODE_IO_BAD_HTTP_STATUS→暂停→恢复文件后手动重试续播，见 [M3 记录](../test-results/2026-09-22-m3-bluetooth-audio-error/README.md)。新增 demo-long（40 分钟）测试音用于长时播放与错误注入。

## 下一阶段测试分层
1. 纯单元：房间可控时钟、ClockEstimator、状态转移、错误输入；不调用公网。
2. 集成：HTTP/WS/文件流、迟到回调、退出与重连竞态；用本地可控代理注入故障。
3. 安卓UI/服务：页面重建、Controller释放、前后台、播放器中断；保留真实设备结果。
4. 双机：房主/成员角色互换，两台真实播放器；模拟客户端只作观察。
5. 负载：15路消息与15路真实音频分别测；云端再测TLS、代理和出网带宽。

## 双机执行步骤
- 记录两台设备型号、Android版本、APK hash、网络、音频输出方式和后端版本。
- 使用相同码率的合成节拍测试文件；启动前确认两端曲目/时长一致。
- 播放10分钟，设备日志每秒记录同步诊断字段；前10秒可作为预热，报告明确说明。
- 对齐服务端估算时间比较进度，计算样本数、P50/P95/最大偏差、缓冲次数及不可比比例。
- 用同一次录音收集两台设备可识别的相同节拍，至少20个事件；尽量等距摆放并记录录音条件。
- 记录各声道/声源偏移与测量误差。不能分辨两声源或只有一台设备时，不出具音频同步通过结论。
- 测试房主暂停/跳转/切歌、中途加入、成员本地暂停/恢复，角色互换再执行。

## 故障与长期场景
本地代理按场景注入延迟和连接切断，避免修改系统级网络影响用户其他应用。
2026-09-21 起可用：scripts/fault-proxy.mjs（管理路径 /__fault/{status,delay,cut,clear}，WS 按帧边界延迟、断线窗口拒绝新连接）；scripts/fault-proxy-selftest.mjs 提供无手机自测。
2026-09-22 起可用：/__fault/audio401?seconds=N 仅对音频路由注入 401（其余透传，到期/清除恢复），真机 401 路径验证见 [M3-AUTH 记录](../test-results/2026-09-22-m3-auth/README.md)；load15.mjs 完成 15 路 10 分钟本地记录见 [LOAD-15 记录](../test-results/2026-09-22-load15/README.md)。
已在真机验证：300ms 延迟注入（RTT 307→644ms，保持 Ready）、12 秒受控断线（EOF 检测≈1s→退避被拒→窗口后自动恢复）、超 60 秒离线触发服务端宽限到期→404→Expired。证据见 [故障注入记录](../test-results/2026-09-21-m1-fault-proxy/README.md)。
注意：USB 重插会清空 adb reverse 规则，测试前需重新执行。
场景：RTT稳定约200ms/500ms、10秒/30秒断线、超过服务端60秒宽限、服务器重启、401/404、缺失MP3。
重连宽限以服务器offlineAt为准；每条记录写“注入→检测→恢复→追上”的时间。
60分钟播放包含至少30分钟息屏；检查进程存活、播放器状态、缓冲、音频中断与资源增长。
15路音频记录持续时长、收到字节、HTTP错误、CPU/内存/文件句柄和出网带宽；不以连接数代替吞吐。

## 诊断与证据
Debug诊断JSONL已实现（限60分钟或20MB，用户主动测试时采集）；令牌/Authorization不落盘。采集文件位于 APP 私有目录 diagnostics/，测试后导出。
证据分为自动断言、UI操作、媒体会话、用户听感/录音、服务器广播，不相互冒充。
动态UI刷新可能使uiautomator无法idle；失败时标记采样无效，不能读取旧XML当新结果。
每次结果写docs/test-results/<日期>-<场景>/，包括README、版本/命令、必要脱敏数据和限制；大体积原始音频不默认提交Git。
现有测试报告保留历史，verification.md只汇总最近已确认结论。

## 验收与注释
阶段门槛以 [主计划](../next-development-plan.md) 为准。代码改动必须有与缺陷相对应的回归，不添加只复述实现的测试。
测试核心辅助函数注释故障注入时钟、采样误差、为什么需要等待条件，以及finally清理测试成员/连接/进程。
2026-09-21：建档；ClockEstimator 单测、debug 诊断日志与会话竞态假传输层回归已实现；第二设备、双机采集和故障矩阵尚待执行。

## 2026-09-22 推进补充
**2026-09-24 更新**：验收报告字段规范见 [开发规范](../development-standards.md)；M3-LONG 执行要点见 [路线图第 4 节](../next-development-plan.md)（60 分钟播放需 ≥65 分钟测试音、全程外部采样、不能中途重启拼接连续播放结论——demo-hour 70 分钟已备）。15 路云端公网重测已通过（2026-09-23 晚，见 [load15-cloud](../test-results/2026-09-23-load15-cloud/README.md)）；M3-LONG 真机执行仍挂起。

2026-09-23：新增 PlaybackViewTest，覆盖播放意图与实际播放区分、音频错误可见性、本机暂停、旧曲目隔离及入房错误；UI 目视场景见 [UI 交付记录](../test-results/2026-09-23-ui-refresh/README.md)，当前无连接设备，待执行。
