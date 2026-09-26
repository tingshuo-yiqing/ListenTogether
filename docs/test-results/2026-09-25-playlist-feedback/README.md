# 歌单滚动与界面精简（2026-09-25 晚）

## 范围与结果

用户确认仅上下滑动歌单迟滞，进度条问题已解决。本轮保持 seek 与音频同步逻辑，移除头像选择、房间动态和歌曲首字封面，新增固定表头的独立歌单面板。

- 当前曲播放条从逐帧修改 Box.height 改为固定尺寸 Canvas 重绘；自动跟随在用户滚动中跳过；房间页移除收键盘手势监听。
- 首页不加载旧头像偏好，手动 emoji 昵称兼容；成员列表保留，动态派生订阅与时间线删除；MiniPlayer/Sheet 无首字封面。
- 歌单圆角面板、固定标题/数量、序号行、当前曲高亮；成员展开上限 180dp、独立滚动；底部播放器常驻。

## 本轮实际验证

- Gradle：`:app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug --console=plain`，退出码 0，BUILD SUCCESSFUL。
- 单测 XML 合计：tests=86、failures=0、errors=0、skipped=0；测试任务本轮实际执行。相比批次 A 的 100 项，删除 13 项动态和 1 项首字封面专属测试。
- Lint：初次分析执行，报告任务 UP-TO-DATE；删除旧 XML/HTML/TXT 后单跑 `:app:lintReportDebug`，重新生成 XML，issues=0。不能引用旧报告时间作证。
- `scripts/check.ps1 -Scope docs`：本地 Markdown 链接通过。
- APK SHA256：`80CF7629C3BB7416CC82F4728F5A9F6CA240269948D4D6D26CE1D13E2B92625E`。
- 构建日志：[build.out.log](build.out.log)、[build.err.log](build.err.log)；报告生成日志：[lint.out.log](lint.out.log)、[lint.err.log](lint.err.log)。

## 无线真机补验（2026-09-25 21:54–21:59）

用户开启无线调试后连接 PHQ110，`adb install -r` 返回 Success；回拉 `pm path` 的 base.apk，SHA256 与上方 80CF7629… 逐位一致。省电设置 `low_power=0`；沿用已保存的服务器地址，测试昵称 F3，曲库 23 首。

已实测：

- 首页无头像选择，入房昵称 F3 未附加旧 emoji；见 [首页](home.png)。
- 固定歌单标题/数量、成员区与底部播放器，歌曲独立滚动；滚动前后见 [初始歌单](room.png)、[滚动后](scrolled.png)。
- MiniPlayer 与展开页无歌曲首字封面，展开页歌曲名/上一首/播放暂停/下一首/进度/时间均可见；见 [展开页](sheet.png)。
- 成员展开只显示当前成员与连接状态，无房间动态时间线；见 [成员展开](members.png)。
- 测试结束已暂停播放，保留应用供用户体验。

滚动测量（debug APK，均在播放状态下先重置 gfxinfo）：

| 操作 | 帧数 | Janky frames | P50 / P90 / P95 |
|---|---:|---:|---|
| 8 次连续往返，x=540、y=1850↔850、每次 550ms | 242 | 66（27.27%） | 25 / 48 / 53ms |
| 4 次带停顿往返，x=540、y=1800↔1200、每次 450ms、间隔 1s | 142 | 19（13.38%） | 17 / 31 / 36ms |

原始数据：[连续滑动](scroll-gfxinfo.txt)、[带停顿滑动](scroll-paced-gfxinfo.txt)。**仍有掉帧，滚动性能项保持待优化，不能宣称卡顿彻底修复。** 没有在同一条件重装旧 APK 做 A/B，不能由不同手势或历史统计计算提升比例。截图和状态正常不代表真人听感或滑动手感通过。

## 剩余复验步骤

后续可复验（1–2 和基础滚动布局已覆盖，性能与边界仍待补）：

1. 覆盖安装新 APK，确认首页无头像选择，昵称不会追加旧头像。
2. 入房检查无动态摘要/时间线，成员展开仍显示当前状态；MiniPlayer 和展开页无首字封面。
3. 在播放中连续快滑和慢滑歌单，确认歌单标题、成员摘要与底部播放器固定，仅曲目区滚动；记录 gfxinfo 与人工手感，对照原版。
4. 滚动期间触发切歌，确认不抢滚动；空闲时切换到屏外歌曲，确认正常跟随。
5. 检查成员展开、空歌单、小屏/大字号、深色模式，复验展开页主控与进度条可见。

本轮未修改服务器、协议、云端部署；未提交 git。
