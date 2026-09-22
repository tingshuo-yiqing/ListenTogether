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
2. USB 调试连接真机，或启动 Android 模拟器，运行 app。
3. APP 首页填写服务器根地址，不要添加 /api：
   - 模拟器访问本机：http://10.0.2.2:3000。
   - 同一 Wi-Fi 的真机：http://电脑局域网IP:3000；Windows 防火墙仅对私人网络/测试设备放行 3000。
   - 阿里云测试机：http://公网IP:3000；只适用于 debug 小范围测试，安全组限定来源。
4. 输入昵称创建房间，将 8 位邀请码告诉好友；好友填写同一服务器地址后加入。
5. 房主选歌并点击播放。成员可本地暂停、恢复跟听。退出房间会释放身份。

也可在 android 目录运行：
```powershell
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest
```
成功后的 APK 路径为 android/app/build/outputs/apk/debug/app-debug.apk。
没有 Android SDK 或依赖下载失败时不会生成 APK；详见 docs/verification.md。

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

- [下一阶段开发方案](docs/next-development-plan.md)：先完善双机同步和稳定性，再部署云端。
- [模块文档索引](docs/modules/README.md)：10 个模块的职责、流程、接口、异常、验收和注释清单。
- [开发与注释规范](docs/development-standards.md)：文档、核心注释与回归测试共同作为交付要求。
- [开发陷阱清单](docs/development-pitfalls.md)：实际踩过的坑与规避方法，动手前通读，避免重复犯错。

- docs/protocol.md：接口、消息、时间公式及权限
- docs/deployment.md：Ubuntu / systemd / Nginx / TLS
- docs/learning.md：关键代码阅读顺序与注释说明
- docs/verification.md：已完成验证、环境阻塞和真机检查表
- [真机播放测试过程与结果](docs/playback-test-2026-09-21.md)：操作步骤、实测证据、遇到的问题和未覆盖项

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

APP 地址填写 `http://127.0.0.1:3000`，创建房间后可播放两段测试音。
多台设备时用 `-Serial 设备序列号` 指定，每台手机都要做 USB 转发。
详情见 `docs/usb-testing.md`；可用 `node scripts/smoke-test.mjs` 检查正在运行的演示后端。