# AGENTS · 开发会话指南

本项目用 AI 辅助持续开发。任何新会话（包括中断后恢复）从本文开始，按顺序读少量文档即可继续，无需重读整个项目。

## 恢复开发的标准入口（按序阅读，总计约 600 行）

1. `docs/verification.md` —— **进度唯一事实来源**。"本轮完成/本轮新增"是最近交付，"尚待验收"是待办清单。
2. `docs/next-development-plan.md` —— M0-M4 路线图、首批任务清单、验收标准。
3. `docs/modules/README.md` —— 模块索引；改动哪个模块就读对应 `docs/modules/<编号>.md`（含已实现/待开发分界）。
4. `docs/development-pitfalls.md` —— **开发陷阱清单**：实际踩过的坑与规避方法（编码、adb、UI 自动化、Compose、协程测试）。动手前通读，踩到新坑必须回填。

历史证据按需查：`docs/test-results/<日期-场景>/README.md`、`docs/playback-test-2026-09-21.md`。

## 当前进度快照（2026-09-21，以 verification.md 为准）

- 已完成：M0 诊断 + M1 主体（SessionContext、ConnectionStatus 状态机、会话边界可测试化、ClockEstimator、JSONL 诊断）；真机复测通过；M1 收尾故障注入完成（fault-proxy.mjs + 自测 + 真机延迟/断线/宽限过期场景，见 docs/test-results/2026-09-21-m1-*）。单测 21 项。
- 挂起：M2 双机同步（缺第二台手机，明确挂起，不得用观察客户端代替）。
- 下一步候选：长时间锁屏/耳机/通知栏真机项（M3 稳定性矩阵）、M4 云端准备。

## 常用命令（Windows PowerShell）

```powershell
# 后端（演示曲库）
cd D:\ListenTogether; .\scripts\start-demo.ps1        # 前台窗口，Ctrl+C 停止
# 健康检查
Invoke-WebRequest http://127.0.0.1:3000/health

# 安卓构建 + 单测 + Lint
cd D:\ListenTogether\android
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:lintDebug

# 真机联调（PHQ110，USB 调试；多设备加 -Serial）
cd D:\ListenTogether; .\scripts\install-debug.ps1     # 装 APK + USB 转发 + 启动 APP
# 手机端诊断日志：adb shell run-as com.listentogether.app ls files/diagnostics/
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
```

## 环境备忘

- 构建：JDK 17、Android SDK Platform 35、Build Tools 35.0.0、Gradle 8.11.1（wrapper 自动下载）。
- 后端：Node.js 24 / TypeScript / Fastify；依赖用 `npm ci`；演示后端用 demo-media 合成曲库。
- 真机：PHQ110（OPPO），地址填 `http://127.0.0.1:3000`（依赖 adb reverse）；后端重启会丢失房间（内存态）。
- 后台运行的演示后端日志在 `demo-backend.log`。
- 交付 APK 的 SHA256 每轮记入 verification.md，历史 hash 保留在同一节。

## 开发规则（详见 docs/development-standards.md）

- 代码、单元测试、模块文档、verification.md 必须在同一次交付中同步更新；不得用"代码已写完"替代验收。
- 踩到新坑立即回填 docs/development-pitfalls.md（现象→根因→规避），同类问题不允许出现第二次。
- 代码与文档注释使用中文；核心接口写时钟域/单位/线程/失败行为；不加逐行翻译式注释。
- 行为约定以 README"行为约定"与 docs/protocol.md 为准：单进程、内存房间、服务端为播放唯一来源、明确点击播放才能解除本机暂停。
- 测试分层见 docs/modules/10-testing-observability.md：纯单测不访问公网；真机结论必须附操作步骤与实测数据。
- 双机相关验收在没有第二台手机时保持挂起并显式标注。
