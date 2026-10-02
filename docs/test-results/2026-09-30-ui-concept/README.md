# 2026-09-30 · 温暖轻盈 UI 设计原型

本目录仅记录 [离线原型](../../ui-prototype/index.html) 的浏览器验证。设计规格见 [逐屏规格](../../ListenTogether-ui-design.md)。不替代 Android 设备验收，也不关闭点歌队列 / 聊天 v2 的 [既有独立验收缺陷](../2026-09-30-queue-chat-acceptance/README.md)。

## 本轮范围

- 创建 / 加入、队列、点歌、聊天、播放器五个页面与多屏设计总览。
- 浅色、深色、两倍字号、小屏、横屏与减弱动效。
- 房主 / 成员权限、空队列、重连、不兼容、聊天失败与重试的离线交互。
- 现有曲库仅提供 9 张封面样本，未修改曲库文件或服务器。

## 可复跑检查

```powershell
node docs/test-results/2026-09-30-ui-concept/browser-check.mjs --preset all
```

使用 Node 24 内置 WebSocket 与 Chrome DevTools Protocol；独立 headless Chrome 仅监听本机 9398，已占用端口时拒绝接管，并在成功或失败后关闭自身浏览器。无需新增依赖，不操作已运行的产品服务或真机。

结果由 `browser-results.json` 和 PNG 截图保存；实际通过数量及限制在完成后登记于下方。

## 验证状态

**离线原型浏览器检查 21/21 通过**；浏览器 `Chrome/154.0.8037.58`，0 未捕捉异常。原型源码哈希在本轮检查前后保持一致，详见 [browser-results.json](browser-results.json)。

- 11 组业务交互检查：首页输入与扫描确认、创建空房、房主队列排序 / 移除、成员待播配额、检索 / 分页、未读 / 历史滚动、首曲暂停、草稿 / 失败原身份重试、本机暂停隔离、播放器控制、异常恢复入口。
- 桌面 1440×1080、手机 375×812、横屏 812×375、浅 / 深色、真实 2 倍字号（页签 16→32px）和减弱动效；五个手机页面另行截图。
- 普通 / 两倍字号 / 横屏播放器主控制均完整在视口内；封面实测分别 240×240、94.58×94.58、142×142px。横屏迷你播放器可见，已检查的可见应用控件均 ≥48×48px。
- [对比度结果](contrast-results.json) **32/32 配色对通过**：正常文字 / 头像 ≥4.5:1，输入边界 ≥3:1。复跑：`python docs/test-results/2026-09-30-ui-concept/contrast-check.py`。
- Markdown 本地链接、脚本语法与 `git diff --check` 通过。交付包含 21 张截图，未重新构建 APK 或重跑服务端 / Android 门禁。

首轮截图发现小屏播放键遮挡、总览重叠；后续修复字阶比例、横屏成员 / 关闭按钮命中尺寸、大字号封面压扁，最终复跑全部通过。这些问题与规避方式已登记于 [陷阱 4.10](../../development-pitfalls.md#410-网页-ui-原型无水平溢出不等于播放控件可见字号开关不等于真实两倍2026-09-30)。

| 查看内容 | 证据 |
|---|---|
| 五屏设计总览 | [overview.png](overview.png) |
| 主界面 / 深色 | [desktop.png](desktop.png) / [dark.png](dark.png) |
| 手机五屏 | [首页](mobile-home.png) / [队列](mobile-queue.png) / [点歌](mobile-search.png) / [聊天](mobile-chat.png) / [播放器](mobile-player.png) |
| 两倍字号 | [队列](large.png) / [播放器](large-player.png) |
| 横屏 | [队列](landscape.png) / [播放器](landscape-player.png) |
| 发送失败 | [desktop-chat-failed.png](desktop-chat-failed.png) |


## 后续真实验收

Android 实施后仍需检查系统输入法、TalkBack、系统字号、通知栏、歌词跟随、服务端确认与重连恢复、双真机聊天和 R8 包滚动性能。浏览器原型没有媒体播放器或网络会话，不能据其得出这些项目已通过的结论。
