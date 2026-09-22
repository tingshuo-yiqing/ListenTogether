# AGENTS · 开发会话指南

本项目用 AI 辅助持续开发。任何新会话（包括中断后恢复）从本文开始，按顺序读少量文档即可继续，无需重读整个项目。

## 恢复开发的标准入口（按序阅读，总计约 600 行）

1. `docs/verification.md` —— **进度唯一事实来源**。"本轮完成/本轮新增"是最近交付，"尚待验收"是待办清单。
2. `docs/next-development-plan.md` —— M0-M4 路线图、当前任务顺序、验收标准。
3. `docs/modules/README.md` —— 模块索引；改动哪个模块就读对应 `docs/modules/<编号>.md`（含已实现/待开发分界）。
4. `docs/development-pitfalls.md` —— **开发陷阱清单**：实际踩过的坑与规避方法（编码、adb、UI 自动化、Compose、协程测试）。动手前通读，踩到新坑必须回填。

历史证据按需查：`docs/test-results/<日期-场景>/README.md`、`docs/playback-test-2026-09-21.md`。

## 当前进度快照（2026-09-22，以 verification.md 为准）

- 已完成：M0 诊断 + M1 主体（SessionContext、ConnectionStatus 状态机、会话边界可测试化、ClockEstimator、JSONL 诊断）；真机复测通过；M1 收尾故障注入完成（fault-proxy.mjs + 自测 + 真机延迟/断线/宽限过期场景，见 docs/test-results/2026-09-21-m1-*）。安卓单测 25 项；M3 通知栏、短时息屏、蓝牙断开与音频 404 恢复已有真机证据。
- 挂起：M2 双机同步（缺第二台手机，明确挂起，不得用观察客户端代替）。
- 已完成：M3-FOCUS 音频焦点（其他媒体抢占 + 真实来电）真机通过；M3-AUTH 注入代理 + 真机 401 路径通过；LOAD-15 本地 10 分钟记录通过（15 路、2.873Mbps、零失败）。记录见 docs/test-results/2026-09-22-m3-focus、-m3-auth、-load15。
- 修复：localPause 诊断盲区（边沿记录）、周期校时覆盖暂停提示（RoomClient + 回归测试）；单测 26 项、Lint 0。最新 APK 832FB65E…——**401 横幅持久性复验已通过**（2026-09-22 晚，无线通道，401 文案 5/5、已同步 0/5、续播恢复；见 docs/test-results/2026-09-22-m3-auth-recheck）。
- 无线调试通道已打通（2026-09-22 晚，`scripts/connect-wireless.ps1`）：无线 adb 下 `adb reverse` 可用，实测设备端 `curl http://127.0.0.1:3000/health` 返回 `{"ok":true}`，可绕开抖动的 USB 链路；832FB65E 横幅复验自此具备执行条件（尚未执行）。手机当前地址 192.168.43.15（2026-09-22 20:46 无线重连成功，配对记录已在，后续重连无需配对码）。**端口极不稳定且 OPPO 息屏会冻结 adbd**（端口通但握手 offline，陷阱清单 2.8）：先人工亮屏，再 `adb mdns services` 或扫描 30000-60000 找当前端口，随后重跑 connect-wireless.ps1。详见陷阱清单 2.7。
- 挂起：M2 双机（缺第二台手机）；M3-LONG 长时/息屏（按用户指示，另见陷阱清单 2.4–2.6）；真实令牌作废（后端无入口）。
- 已完成：**M4 首次部署（2026-09-22 深夜）**——2G swap + Node v24.9.0（二进制 /opt/node24→/usr/bin）+ listen 账号 + releases/20260922-2159（tarball 与 35 文件 SHA256 全校验）+ systemd 服务 active+enabled（绑定 127.0.0.1:3000）；服务端验证 13/13（scripts/m4-deploy-verify.sh）+ SSH 隧道受控联调 9/9（scripts/tunnel-verify.mjs，本机 13000→云端 3000）。记录见 docs/test-results/2026-09-22-m4-first-deploy。M4 只读盘点见 -m4-inventory。
- 下一步（M4 剩余）：公网验证（0.0.0.0 绑定+安全组放行，或 TLS 反代后从两种公网网络真机验证；域名/TLS 待用户提供）→ 15 路云端重测 → 升级/回滚演练。UI 5DA5082A 目视验证与 M3-LONG 仍挂起；M2 双机阻塞（缺第二台手机）。

## 常用命令（Windows PowerShell）

```powershell
# 后端（演示曲库）
cd D:\ListenTogether; .\scripts\start-demo.ps1        # 前台窗口，Ctrl+C 停止
# 健康检查
Invoke-WebRequest http://127.0.0.1:3000/health

# 安卓构建 + 单测 + Lint
cd D:\ListenTogether\android
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:lintDebug

# 真机联调（PHQ110；USB 或无线，多设备/多 transport 时加 -Serial）
cd D:\ListenTogether; .\scripts\install-debug.ps1     # 装 APK + USB 转发 + 启动 APP
# 无线调试（免 USB，USB 抖动时首选；配对→连接→reverse 必须一次做完，见陷阱清单 2.7）
cd D:\ListenTogether; .\scripts\connect-wireless.ps1 -DebugHost <IP:调试端口> -Port 3000,3001 -Install -Verify
# 手机端诊断日志：adb shell run-as com.listentogether.app ls files/diagnostics/
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
```

## 环境备忘

- 构建：JDK 17、Android SDK Platform 35、Build Tools 35.0.0、Gradle 8.11.1（wrapper 自动下载）。
- 后端：Node.js 24 / TypeScript / Fastify；依赖用 `npm ci`；演示后端用 demo-media 合成曲库。
- 真机：PHQ110（OPPO），地址填 `http://127.0.0.1:3000`（依赖 adb reverse）；后端重启会丢失房间（内存态）。
- 后台运行的演示后端日志在 `demo-backend.log`。
- 负载/注入脚本：`node scripts/load15.mjs --model playback --duration 600 --bitrate 192`（成员必须持 WS，勿删该逻辑）；`node scripts/fault-proxy.mjs --port 3001` + `/__fault/{delay,cut,audio401,clear}`。
- 长时后台任务用 `Invoke-CimMethod Win32_Process Create` 启动（工具超时会杀子进程树，见陷阱清单第 6 节）；注意 WorkBuddy 会话内 CIM 进程创建可能被安全策略拦截，SSH 隧道等长任务可改用后台任务方式挂起、收尾 TaskStop。
- 交付 APK 的 SHA256 每轮记入 verification.md，历史 hash 保留在同一节。
- 云端：`ssh aliyun`（8.166.126.136，root，密钥登录）；部署基线 /opt/listen-together（releases/<id> + server 符号链接 + media 持久层），`systemctl status|restart listen-together`；升级/回滚命令见 docs/deployment.md 第 5 节；后端重启丢失内存房间。

## 开发规则（详见 docs/development-standards.md）

- 代码、单元测试、模块文档、verification.md 必须在同一次交付中同步更新；不得用"代码已写完"替代验收。
- 踩到新坑立即回填 docs/development-pitfalls.md（现象→根因→规避），同类问题不允许出现第二次。
- 代码与文档注释使用中文；核心接口写时钟域/单位/线程/失败行为；不加逐行翻译式注释。
- 行为约定以 README"行为约定"与 docs/protocol.md 为准：单进程、内存房间、服务端为播放唯一来源、明确点击播放才能解除本机暂停。
- 测试分层见 docs/modules/10-testing-observability.md：纯单测不访问公网；真机结论必须附操作步骤与实测数据。
- 双机相关验收在没有第二台手机时保持挂起并显式标注。
