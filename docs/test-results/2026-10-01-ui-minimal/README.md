# 精简 UI · 单文件离线原型验收

日期：2026-10-01（Asia/Shanghai）。交付：[单文件 HTML](../../ui-prototype/index.html)与[精简设计规格](../../ListenTogether-ui-design.md)。以用户提供的 `listen-together-minimal.html` 和明确要求调整；后续指示取消两倍字号与手机横屏，本轮仅默认字号竖屏、双主题和桌面评审工作台。

**结果：Chrome / CDP 24/24，通过；语义色对比 32/32，通过；12 张截图。** 结论仅针对浏览器内存中的交互原型，不代表 Android 或 v2 服务端缺陷已修复。未连接真实房间或播放音频。

## 实测与范围

- 房间右上只有退出图标，取消留房、确认后清除媒体与房间；三个图标页签有选中语义，当前曲仅迷你播放器展示，手机只从这里展开播放器。
- 成员面板直接提供二维码、复制和分享；二维码在同一面板展开。验证了入口和剪贴板失败后的可选文本回退，未执行实际系统分享。
- 待播行只留封面、歌名、歌手及允许的操作，菜单只有移除；成员只撤回自己的歌曲。点歌加号成功变勾号，随机一次只加一首；空房首曲入队保持暂停，耗尽后清除播放器。
- 真实 CDP 鼠标和触摸事件验证 380ms 长按、排序提交、边缘自动滚动、短按 / 移动不误触发、Escape / pointercancel / touchcancel / 角色与连接变化取消、无关 pointerId 不提交。Alt＋方向键可在行上排序，不增加菜单项。
- 展开页直接排列封面、歌名、歌手与示意歌词，无点击封面切换、回到开头或常驻权限说明。时间在指针操作 / 键盘操作滑条时出现，结束或失焦收起；成员只本机暂停，不更改共享播放。
- 聊天显示发送者、无逐条时间；pending / 失败 / 重试保留。失败文本保留，重试沿用 `requestId`、`clientMessageId`、`issuedAtMs`；草稿跨页保留，模拟实时消息窗口上限 100。
- 375×812、320×568 和暗色竖屏无水平溢出，封面方形、底部播放与进度控制可见，检查到的有效触控区域至少 48px。320×568 封面缩至 150px，目视确认当前歌词与控制同时可见；普通竖屏封面约 248px。多屏总览是 inert 的评审缩略图。
- 仅复制 HTML 到空目录，启用 Network offline 后仍可操作；封面均加载成功，无外部资源请求。HTML 内含一个 style、一个 script、9 张示意 SVG 封面与示例二维码，无 CSS / JS / 字体 / 图片目录依赖。
- 零未捕获异常，检查前后源码 hash 相同：`bb0fcb708f2317412ca8f535b687fff1aad3eafcac1613b8c34417066888bc2a`；HTML 125,324 字节。语法与 Markdown 本地链接另由交付检查验证。

语义色检查验证浅 / 深两主题的正文、次要文字、按钮、错误、警告、播放器、头像与必要边界配对；不等同完整 WCAG 或 Android TalkBack 验收。歌词取消了额外透明度，边缘渐隐仅作滚动提示。原生 IME、网络确认、排序冲突、歌词跟随、音频与设备手感须另测；系统字体历史待办保留。示意封面与原创歌词不代表真实歌曲资源。

## 复跑

```powershell
node docs/test-results/2026-10-01-ui-minimal/browser-check.mjs
python docs/test-results/2026-10-01-ui-minimal/contrast-check.py
```

Node 24 内置 WebSocket + 独立 Chrome，无新增 npm 依赖。默认调试端口 9399，若被占用则拒绝接管；可设置 `UI_CDP_PORT` 与 `UI_CHROME`。浏览器退出由 finally 收尾，结果写入 [browser-results.json](browser-results.json) 和 [contrast-results.json](contrast-results.json)。

验收脚本修正了两类测试时序问题：关闭操作需命中真实 button，不能把遮罩当按钮；读数渐入需等待 computed opacity 到目标值，失败时必须释放指针，防止后续检查级联。最终结果来自修正后的完整复跑。

## 截图

| 场景 | 证据 |
|---|---|
| 五视图总览 | [desktop-overview.png](desktop-overview.png) |
| 成员与邀请 | [desktop-members.png](desktop-members.png) |
| 点歌 / 展开页 | [desktop-search.png](desktop-search.png)、[desktop-player.png](desktop-player.png) |
| 默认竖屏 | [mobile-queue.png](mobile-queue.png)、[mobile-player.png](mobile-player.png) |
| 矮竖屏 | [small-queue.png](small-queue.png)、[small-player.png](small-player.png) |
| 暗色竖屏 | [dark-queue.png](dark-queue.png)、[dark-player.png](dark-player.png) |
| 触摸排序 / 聊天失败 | [mobile-drag.png](mobile-drag.png)、[mobile-chat-failed.png](mobile-chat-failed.png) |

长按边缘滚动参考 [SortableJS AutoScroll 说明](https://github.com/SortableJS/Sortable/blob/master/plugins/AutoScroll/README.md)的阈值与速度思路；本原型自行实现，不引入库或复制代码。
