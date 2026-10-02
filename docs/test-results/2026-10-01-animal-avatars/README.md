# 随机动物头像、重叠排列与双主题（2026-10-01）

本轮按用户提供的熊猫参考图生成并接入 15 种可爱动物头像。入房由服务端随机分配，同房成员互不重复；成员摘要改为轻微重叠；主题只保留浅色、深色并保存选择。代码、门禁与 PHQ110 目视验收通过；v2 完整设备矩阵、双真机及云端发布延续原待办。

## 实现与素材

- 动物池：熊猫、猫、柯基、兔子、狐狸、小熊、考拉、企鹅、水獭、小熊猫、仓鼠、小鹿、刺猬、海豹、小老虎。
- 使用内置 image_gen，完整提示词及生成源文件路径见 [prompts.json](prompts.json)。原 PNG 留在本机 `.workbuddy/animal-avatar-originals/`，通过 ffmpeg Lanczos 缩放为 256×256 无损 WebP，项目资源见 [drawable-nodpi](../../../android/app/src/main/res/drawable-nodpi/)。15 个素材共约 827 KiB；哈希及字节数见 [assets.json](assets.json)。离线显示，无网络头像服务依赖。
- `server/src/rooms/avatars.ts` 从未占用池用 `crypto.randomInt` 均匀随机抽取，最大成员数与池大小均为 15。离线宽限内仍占用；同身份重连、房主转移保持头像；主动离房或宽限清扫释放。重新加入是新身份，重新抽取，可能再次抽中原头像。房间之间独立分配。
- 成员快照下发 `avatarId`，聊天记录保存发送时的 `senderAvatarId`；发送者离开、槽位被复用后，历史消息头像仍保持。两个字段在 v2 schema 中为兼容此前本地版本而可选；本轮服务端始终下发。安卓遇到缺失、未知 ID 使用原昵称字素占位。
- 房间摘要最多显示 3 个头像，40dp 外圈、相邻重叠 12dp，主题底色描边保证轮廓清晰；成员面板与聊天引用同一套动物资源。
- 主题菜单只有「浅色 / 深色」，默认浅色；旧保存值 `System` 迁移为浅色。手动选择保存，冷启动恢复；不再读取系统主题。

动手前只读参考了 [DiceBear 开源仓库](https://github.com/dicebear/dicebear) 的头像标识思路。本项目选择服务端分配固定 ID、客户端显示本地素材，以保证不同设备看到同一成员头像，并实现房间内排重；未复制代码或引入该库。

## 本轮门禁

| 检查 | 结果 | 证据 |
|---|---|---|
| 服务端 TypeScript build + 全量单测 | 70/70 通过（新增 7 项头像回归） | [server-test.log](server-test.log) |
| 安卓强制重跑单测 | 177 项 / 23 套件，失败、错误、跳过均 0（新增 4 项） | [android-check.log](android-check.log)、[JUnit](junit/) |
| assembleDebug、lintDebug | 构建通过，Lint 0 | [build-results.json](build-results.json)、[Lint XML](lint-results-debug.xml) |
| 资源/协议一致性 | 15 个 ID、schema 枚举、安卓映射及资源完全对应 | `server/test/avatars.test.ts` |
| 安装及回拉核对 | PHQ110 覆盖安装成功，设备 APK 与构建逐字节同 SHA256 | [device-results.json](device-results.json) |
| 文档与补丁检查 | Markdown 本地链接、git diff --check 通过 | verification 及模块说明同步 |

当前 APK：21,516,433 字节，SHA256 `89e90eeb34a8ac9d797938011120af406a0d02ffe9ac4bcf7c31a4e8565d51c5`；[构建输出](../../../android/app/build/outputs/apk/debug/app-debug.apk)。脚本业务代码未改，51 项脚本门禁沿用此前 ACC 记录，本轮未重跑。

服务端定向检查覆盖同昵称满房 15 个唯一头像/第 16 人拒绝、离线保留与重连、房主转移、主动离房及 60 秒清扫释放、独立房间、历史头像、真实 HTTP 加房和双 WS 看到相同头像及聊天广播/快照。客户端检查覆盖同昵称不同头像、缺字段及未知 ID 回退、离房后的聊天头像及旧聊天兼容。

首次服务端全量检查 69/70：独立成员 schema 校验丢失根 `$defs`，修正测试为带根定义的 `$ref` 校验后 70/70。保留 [首次失败](server-test-initial-failed.log)，规避方式已登记 [陷阱 10.15](../../development-pitfalls.md)。未为绕过失败放宽头像枚举。

## PHQ110 实测

设备为无线 PHQ110（`192.168.43.15:41293`），版本均为上述 `89e90eeb…`。一个真机房主、两个持 WS 的脚本成员参与；没有第二台真机，不将本轮截图算作双机同步验收。

| 操作与结果 | 浅色证据 | 深色证据 |
|---|---|---|
| 首页主题菜单只显示两项；选择深色后强制停止、冷启动，仍为深色 | [两项菜单](home-theme-menu.png) | [冷启动保留](dark-after-restart.png) |
| 创建房间，脚本小王、小李加入；考拉/柯基/狐狸不同，摘要轻微重叠 | [房间摘要](room-light.png) | [房间摘要](room-dark.png) |
| 打开成员面板，各成员动物头像与摘要一致 | [成员面板](members-light.png) | [成员面板](members-dark.png) |
| 两个脚本成员发送聊天，气泡旁头像与成员身份一致 | [聊天](chat-light.png) | [聊天](chat-dark.png) |
| 脚本成员经认证 DELETE 离房；保留手机房主和浅色选择，供继续调试 | [收尾房间](final-room-light.png) | — |

所有上述截图已人工查看。复测工具为 [device-check.py](tools/device-check.py) 和 [peers.mjs](tools/peers.mjs)，步骤及检查结果见 [device-check.log](device-check.log)；UI XML 与截图一并留档。首次设备助手因 Windows PowerShell 5 后端日志是 UTF-16 BOM 而读取失败，见 [首次日志](device-check-initial.err.log)；改为识别 BOM 后用 `--resume` 在同一房间续测，沿用且检查首次已生成的主题证据，没有重建房间隐藏失败。对应编码坑已在既有陷阱 1.7 记录。

## 环境与边界

构建后两次确认本机后端零房间/零 WS，再替换本机服务进程用于头像真机测试。真实 45 首曲库只读，未修改任何媒体或编目。收尾保留本机后端和手机房主调试，两个脚本成员已离房，空队列未播放。后端日志见 [backend.log](backend.log) / [backend.err.log](backend.err.log)。

未部署云端、未提交 Git、未调整播放同步参数。云端仍 v1 `20260928-1815`，本轮 v2 APK 连接旧云端仍为 Incompatible；本轮未重测音频同步、性能、真实弱网、权限矩阵、旧 APK 426 或双真机。此前 IME/耳机/空曲等设备证据继续按 [ACC 修复报告](../2026-10-01-queue-chat-fixes/README.md) 各自版本归档。

复跑命令（项目根目录；安卓命令在 `android` 目录执行）：

```powershell
npm --prefix server run build
npm --prefix server test
./gradlew.bat :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
node scripts/check-doc-links.mjs
```
