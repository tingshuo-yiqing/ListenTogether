# 一起听歌 · ListenTogether

安卓好友听歌原型：昵称入房、8 位邀请码、最多 15 人、房主控制、手动 MP3 曲库、断线重连。
代码中的关键同步、权限和生命周期说明使用中文。

## 目录与环境

- android：Kotlin / Compose / Media3 原生客户端，最低 Android 8.0。
- server：Node.js 24 / TypeScript / Fastify / WebSocket 单进程后端。
- media：管理员维护的 MP3 和 catalog.json，不提供第三方歌曲。
- deploy、scripts、docs：部署模板、开发命令、协议与验收记录。
- 安卓构建：JDK 17、Android SDK Platform 35、Build Tools 35.0.0；Wrapper 自动下载 Gradle 8.11.1。
- Node 依赖使用 package-lock.json；请使用 npm ci，避免随意升级。

## Windows 启动后端

在 PowerShell 中：

```powershell
cd D:\ListenTogether\server
npm.cmd ci
npm.cmd run build
npm.cmd test
$env:HOST = "0.0.0.0"
npm.cmd start
```

开发模式可用 npm.cmd run dev。默认不开 HOST 时只监听 127.0.0.1。
浏览器打开 http://127.0.0.1:3000/health 应得到 {"ok":true}。
服务器必须从 server 目录启动，或用 MEDIA_DIR 明确指定曲库路径。

空曲库可以测试入房；播放前按 media/README.md 添加自有或获授权的歌曲并重启后端。

## Android Studio 与真机联调

1. 用 Android Studio 打开 D:\ListenTogether\android，选择 JDK 17，安装 SDK 35，并等待 Gradle 同步。
2. 用 USB 调试连接真机（USB 口/线不稳时见下方"无线连接真机"），或启动 Android 模拟器，运行 app。
3. APP 首页填写服务器根地址，不要添加 /api：
   - 模拟器访问本机：http://10.0.2.2:3000。
   - 同一 Wi-Fi 的真机：http://电脑局域网IP:3000；Windows 防火墙仅对私人网络/测试设备放行 3000。
   - 阿里云测试机：http://公网IP:3000；只适用于 debug 小范围测试，安全组限定来源。
4. 输入昵称创建房间，将 8 位邀请码告诉好友；好友填写同一服务器地址后加入。
5. 房主选歌并点击播放。成员可本地暂停、恢复跟听。退出房间会释放身份。

### 无线连接真机（免 USB）

USB 口或线材不稳、设备在 device/offline 间抖动时，改用无线 adb。项目靠 `adb reverse` 把手机的 `127.0.0.1:3000` 转发到电脑后端，**这一机制在无线下同样有效**（已实测：手机端 `curl http://127.0.0.1:3000/health` 返回 `{"ok":true}`），APP 内地址仍填 `http://127.0.0.1:3000`，无需改后端 `HOST` 或防火墙。

```powershell
# 首次：手机「开发者选项 → 无线调试 → 使用配对码配对设备」，记下弹窗的配对端口与 6 位配对码
cd D:\ListenTogether
.\scripts\connect-wireless.ps1 -PairHost 192.168.43.15:37303 -PairCode 935250 `
  -DebugHost 192.168.43.15:41959 -Install

# 之后每次重连（配对记录已在，可加 -Port 3000,3001 供故障注入、-Verify 做端到端自检）
.\scripts\connect-wireless.ps1 -DebugHost 192.168.43.15:41959 -Port 3000,3001 -Install -Verify
```

- `-DebugHost` 是「无线调试」页的「IP 地址和端口」，**与配对弹窗里的端口是两个不同端口**，且每次重开无线调试都会变。
- 脚本在一个进程内完成 connect + `adb reverse`（+ 安装启动 APK），并打印后续脚本该用的 `-Serial`。**必须一次做完**：adb server 一重启，无线连接和 reverse 会同时失效。
- 手机重启、切换 Wi-Fi、长时间息屏或 adb server 重启后，重跑脚本即可恢复。
- 首次配对若报 `protocol fault`，说明这台电脑此前已配对过，直接 `adb connect` 通常就能连上，不必反复重试。
- 若 `adb devices` 同时出现 `IP:端口` 与 `adb-...._adb-tls-connect._tcp` 两条（同一台手机的两个 transport），给 `install-debug.ps1` 传 `-Serial` 指定其一。

更多无线专属陷阱见 [开发陷阱清单](docs/development-pitfalls.md) 2.7。

也可在 android 目录运行：
```powershell
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest
```
成功后的 APK 路径为 android/app/build/outputs/apk/debug/app-debug.apk。
没有 Android SDK 或依赖下载失败时不会生成 APK；详见 docs/verification.md。

项目级检查可在根目录运行：scripts/check.ps1 默认依次执行后端、安卓和 Markdown 链接检查，也可使用 -Scope server、-Scope android 或 -Scope docs 单独执行。

## 行为约定

- 首版单进程、内存房间，不可运行多个实例或多个 worker。重启后需重新创建房间。
- 只有房主改变全房间状态，服务端再次检查权限。
- 房主断线有 60 秒宽限；超时转给最早加入的在线成员。主动退出立即转移。
- 普通成员离线身份同样保留 60 秒，之后须重新加入；无人在线 5 分钟清理房间。
- 通知栏操作与页面一致；成员暂停只影响自己，房主暂停影响所有人。
- 使用服务端时间校准；目标约 500ms，不用于同室多音箱无回声播放。
- 固定歌单顺序播放，最后一首结束停止；切歌保留当前播放/暂停状态。
- HTTP 仅 debug 允许。正式部署见 docs/deployment.md，使用 HTTPS/WSS。
- 不包含账号、聊天、APP 上传、音乐搜索或第三方音乐平台接口。

## 文档

- [系统架构设计](docs/architecture.md)：分层结构、模块职责与依赖、端到端数据流。
- [验收记录](docs/verification.md)：进度唯一事实来源——当前状态、APK 版本历史、交付历史索引与待办清单。
- [路线图与验收标准](docs/next-development-plan.md)：M0-M4 阶段定义、挂起项恢复条件、M2/M3-LONG 验收标准。
- [并行开发推进方案](docs/parallel-development-plan.md)：工作流划分、冲突协调规则（多会话并行时必读）。
- [模块文档索引](docs/modules/README.md)：10 个模块的职责、流程、接口、异常、验收、注释清单与关键代码阅读顺序。
- [开发与注释规范](docs/development-standards.md)：文档、核心注释、回归测试与验收报告字段共同作为交付要求。
- [开发陷阱清单](docs/development-pitfalls.md)：实际踩过的坑与规避方法，动手前通读，避免重复犯错。
- [协议规范](docs/protocol.md)：接口、消息、时间公式及权限。
- [部署手册](docs/deployment.md)：Ubuntu / systemd / Nginx / TLS / 版本回滚 / 曲库管理。
- 历史过程文档（使命完结的一次性记录）在 docs/archive/：播放测试（2026-09-21）、W1/W2 开发交接单（2026-09-23）。

## USB 一键联调

已提供独立合成测试曲库，无需先准备歌曲。Android SDK 配好后：

```powershell
cd D:\ListenTogether
.\scripts\build-android.ps1
.\scripts\start-demo.ps1
```

保持演示后端窗口运行，另开 PowerShell，手机开启 USB 调试并允许电脑连接后：

```powershell
cd D:\ListenTogether
.\scripts\install-debug.ps1
```

APP 地址填写 `http://127.0.0.1:3000`，创建房间后可播放 30 秒、45 秒与 40 分钟三段测试音。
多台设备时用 `-Serial 设备序列号` 指定，每台手机都要做 USB 转发。
详情见 `docs/usb-testing.md`；可用 `node scripts/smoke-test.mjs` 检查正在运行的演示后端。