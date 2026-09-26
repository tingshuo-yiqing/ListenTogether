# 2026-09-25 0.3.0 批次 A 真机验收（房间动态流 + 伪封面 + 跟随滚动 + 头像 emoji）

| 字段 | 内容 |
|---|---|
| 标识 | 0.3.0 批次 A「一起听体验轮」真机验收；2026-09-25；AI 会话（操作者：本机 + PHQ110）；**结论：通过（1 项需人工手感确认、1 项长时项未覆盖）** |
| 环境 | APK `D882D18632E04E28887DD8D87181410CE1115098838E6C8729B5B9A77D2E4767`（装机后 `pm path` 拉回 base.apk 复核 SHA256 逐位一致）；设备 PHQ110 / Android 14 / USB（fbddbe8，transport 3）；后端**云端** `http://8.166.126.136:3000`（release 20260924-0937，曲库 23 首真实音乐；手机沿用已记住地址，未走 adb reverse）；网络 5G/Wi-Fi 混合（诊断 RTT 中位 56–380ms）；音频输出手机扬声器；系统省电未干预（未改电池策略） |
| 操作 | 见下表逐项；成员进出用新增的 `scripts/member-sim.mjs` 模拟（服务端"离线 60 秒清扫"要求成员必须持 WS）；房间码取自设备诊断 JSONL（不在界面显示） |
| 数据 | 截图 6 张（本目录 PNG）；UI 文本用 `uiautomator dump` 逐条比对；播放/同步事实以设备诊断 JSONL（`files/diagnostics/diag-20260925-*.jsonl`）与 `dumpsys media_session` 为准 |
| 边界 | ⑤ 触感无客观证据（见下）；10 分钟摘要淡出未在本轮窗口内覆盖；单设备（无第二台真实手机），"两机同步误差"仍属 M2 挂起项 |
| 清理 | 测试房间随手机退出后空置 5 分钟由服务端回收；脚本成员全部 `leave` 或进程结束（无残留令牌）；临时截图与日志在系统 TEMP，未写入仓库；系统夜间模式已还原（`cmd uimode night no`） |

## 验收项与证据

| # | 场景 | 操作（实测动作） | 结果 | 证据 |
|---|------|------|------|------|
| ② | 头像选择器 + 24 字上限 | 选 🐼、输入 24 字符 `AliceLongName1234567890`、创建房间 | 入房成功（**未触发服务端 400**）。服务端快照里的昵称是 `🐼 AliceLongName12345678`（前缀 2 码元 + 空格 1 + 昵称 21 = 24 码元，`composeNickname` 按码点截断生效） | 01-avatar-picker.png；member-sim 输出的 `state.members` |
| ④ | 头像 emoji 落位 | 展开成员区 | 头像位是 🐼，文字行是 `AliceLongName12345678`（**emoji 不重复**）；成员行「房主 · 在线」文字并存 | 02-room-emoji-avatar.png、03-dynamics-timeline.png |
| ④ | 偏好持久化 | 重装 APK + 重启进程，回到入房页 | 头像选择保留：第 4 个圆片（熊猫，bounds x=612）`checked=true`，其余 false | dump 属性 `chip bounds=[612,1137][756,1281] checked=true` |
| ① | 动态：加入 | `member-sim join 42E5B776 脚本小王 --hold 18` | 折叠行「2 人一起听 / 已连接 · 脚本小王 加入了房间」；头像堆叠出现 `脚` + `🐼` | 服务端 `state` 输出 + dump |
| ① | 动态：掉线 | 脚本成员 hold 到期退出（不发 DELETE） | 「1 人一起听 / 已连接 · 脚本小王 掉线了」 | dump |
| ① | 动态：回来 | `member-sim resume 42E5B776 <token> --hold 16` | 「2 人一起听 / 已连接 · 脚本小王 回来了」——**首次加入时没有多播"回来了"**（`everOnline` 修复的实证） | 服务端 `state` + dump |
| ① | 动态：离开 | `member-sim leave`（在线主动退出） | 「1 人一起听 / 已连接 · 脚本小王 离开了房间」 | dump |
| ① | 抑制规则：离线 60 秒被移除 | 脚本成员 hold 4 秒掉线，静置 75 秒后复查 | 摘要仍为「已连接 · 超时成员 掉线了」，**没有补报"离开了房间"**；成员头像从堆叠中移除 | dump（ui11b/ui12）+ 12-after-back.png |
| ① | 动态时间线 | 展开成员区 | 6 条按时间倒序：`离开了房间（刚刚）/ 加入了房间（1 分钟前）/ 切到了《富士山下》（2 分钟前）/ 开始播放（2 分钟前）/ 切到了《单车》（3 分钟前）/ 切到了《痴心绝对》（3 分钟前）`；相对时间分档正确 | 03-dynamics-timeline.png |
| ① | 当前曲动效 | 播放中查看歌单 | 当前曲行首显示 3 根跳动竖条（`PlayingIndicator`），MiniPlayer 显示「播放中」 | 03-dynamics-timeline.png |
| ② | 伪封面 | 房间页 / 展开页 | MiniPlayer 左侧方形缩略图（首字素「富」）+ Sheet 内 180dp 封面居中，同一首歌颜色恒定 | 03-dynamics-timeline.png、04-sheet-light.png |
| ② | 展开页布局（**修复后复验**） | 点 MiniPlayer 打开展开页 | 一屏内完整可见：当前歌曲/状态行、封面、标题居中、上一下一首 + 64dp 播放键、**进度滑条**、0:00 / 4:01、同步说明，无裁切 | 04-sheet-light.png |
| ② | 返回键收起 | 展开页内按系统返回 | Sheet 收起回到房间页（列表与 MiniPlayer 状态不变） | dump ui15 |
| ③ | 歌单跟随（需要滚） | 列表滚到底部（当前曲 `有何不可` 离开视野）→ 展开页点「下一首」 | 列表自动滚到新当前曲：`痴心绝对` 出现在顶部并标「当前 · 4:22」 | 06-follow-scroll.png、dump ui17 |
| ③ | 跟随不打扰 | 当前曲已在屏内时再点「下一首」 | 列表**不跳动**（顶部行仍是 `痴心绝对`），仅「当前」标记移到 `单车` | dump ui18 |
| ③ | **曲终自动推进也跟随** | 让房间连续播放约 16 分钟（服务端 tick 自动换曲多次） | 每次自动换曲后列表都滚到新当前曲；最后一次停在 `红豆`（行首动效条 + MiniPlayer「播放中」） | 25-fade.png |
| ① | 相对时间长期老化 | 静置观察 13–14 分钟后复查时间线 | 标签正确老化为 `6 / 10 / 12 / 13 / 14 分钟前`，30 秒刷新在整个窗口内持续生效；时间线保留最近 8 条 | dump ui26 |
| — | **成员 ≥3 的头像堆叠 `+N` 收尾**（补充轮） | 6 个 `member-sim` 成员同时在线（共 7 人） | 堆叠显示 5 个头像（🐧 + 4×「朋」各自主题色 + 在线点）与 `+2` 圆片；`7 人一起听`；长文本摘要在行内正确省略（`已连接 · 朋友6 …`） | 08-avatar-stack-plusN.png、dump ui32 |
| ⑥ | 暗色与动态取色 | `cmd uimode night yes` → 截图 → 还原 | 主题切到紫色系；伪封面改为柔和紫 + 浅紫卡首字，进度/时间/说明清晰可读；当前曲行文字清晰 | 05-sheet-dark.png |
| ⑤ | 触感反馈 | 点播放键、切歌、拖动滑条 | **无法出客观结论**：`dumpsys vibrator_manager` 的 `Previous vibrations for usage TOUCH` 不记录 `performHapticFeedback`（应用包名一条都没有）；点击本身确认生效（`dumpsys media_session` 出现 `state=PLAYING`、诊断 `localPause=false` 且位置推进），但"有没有震动/轻重是否合适"仍需人手确认 | 见"边界" |
| — | 装机一致性 | `pm path` → `adb pull base.apk` → SHA256 | 装机 hash 与交付锚一致（W1 轮出现过的"装机偏差"未复现） | 命令输出 |

## 服务端侧独立证据（`ssh aliyun` + journalctl，2026-09-25）

手机走的是云端入口，因此服务端事件日志可与界面行为逐条对账（字段只有房间码/成员 ID/来源 IP，无令牌与昵称）：

```text
15:40:44  room.created  code=42E5B776 hostId=2438e3dc…      # 手机建房（第一个测试房间）
15:42:02  member.joined code=42E5B776 memberId=4458565d…     # 脚本小王加入
15:43:58  member.joined code=42E5B776 memberId=aae9de99…     # 超时成员加入（hold 4 秒后掉线）
15:45:02  member.removed code=42E5B776 memberId=aae9de99… reason=offline-timeout
          ↑ 服务端在离线 60 秒后移除该成员；同一时刻手机摘要仍是"掉线了"、没有补报"离开了房间"
15:47:42  room.created  code=44881039 hostId=886e7be6…      # 装 D882D186 后重新建房（HostAlice）
15:48:16  member.removed code=42E5B776 memberId=2438e3dc… reason=offline-timeout
15:50:43  member.joined code=44881039 memberId=52f03af4…     # 脚本小李加入
15:52:17  room.deleted  code=42E5B776 reason=empty-timeout   # 空置 5 分钟后自动回收
```

用途：①"离线 60 秒移除"这条服务端事实与客户端"不补报离开"的抑制规则**互相印证**；②房间回收（`empty-timeout`）得到实证，测试房间不残留；③证明本轮真机确实打在云端 release 上（不是本地演示后端）。

## 本轮真机发现并修复的缺陷

**展开页默认停在"半屏"，主控制项在屏幕外**（影响场景 ②，属本轮新功能引入的回归）

- 现象：`ModalBottomSheet` 默认 `skipPartiallyExpanded = false`，内容高于半屏时先停在半屏锚点。PHQ110 上实测：打开展开页后只能看到封面、标题与切歌/播放键，**进度滑条、时间与同步说明都在屏幕外**，需要再滚一次或上拖才能操作主控制项。触屏截图 07-sheet-before-fix.png（修复前）与 04-sheet-light.png（修复后）可直接对比。
- 修法：`ui/RoomPlayer.kt` 的 PlayerSheet 改用 `rememberModalBottomSheetState(skipPartiallyExpanded = true)`，直接展开到内容高度；小屏/大字体仍由内容列自身的 `verticalScroll` 兜底。
- 回归：单测 100 项 cleanTest 实跑全过、Lint issues=0；新 APK `D882D186…` 重新装机后复验场景 ②（见上表），并复测场景 ①（加入/离开/时间线）与 ③（跟随滚动）、⑥（暗色）。
- 备注：独立复核曾预判"内容高于半屏基本等同全展开"，**真机证明该预判不成立**——这也是本轮坚持跑真机而不是只看代码复核的理由。

## 边界与未覆盖项（如实标注）

1. **触感（⑤）无客观证据**：`dumpsys vibrator_manager` 只保留 ALARM/TOUCH/NOTIFICATION 三类历史，且本机不会记录 `performHapticFeedback`（应用包名零条，含点击前后对比）。已确认点击生效，但震动本身与"轻触感 vs 长按级"的主观轻重**待人工确认**；"用 dumpsys 验证触感不可行"已回填陷阱清单。
2. **10 分钟摘要淡出未覆盖**：已实测到"时间线标签长期老化正确"（复查时显示 `6/10/12/13/14 分钟前`，30 秒刷新有效、时间线保留最近 8 条），但折叠摘要的淡出仍**没有观测到**——观察窗口内房间一直在播放，曲终自动换曲每几分钟就产生一条新的"切到了《X》"，摘要里的最新动态始终在 10 分钟内，因此达不到淡出条件。该规则目前只有 `isRecentActivity` 单测覆盖；要实测需静置 ≥10 分钟且不产生任何事件（暂停播放即可，本轮未再等一个窗口）。另：截图 25-fade.png 顺带证明**曲终自动推进（服务端 tick）后列表跟随滚动同样生效**。
3. **单设备**：成员进出/掉线/回来/离开用 `scripts/member-sim.mjs`（真实 HTTP + WS 成员）模拟，**不等于两台真实手机的体验**（触感、听感、双机同步误差仍属 M2/W5 挂起项）；本轮首次验证了 `AvatarStack` 的 2 人堆叠与离线成员保留。
4. **dump 在播放期不可靠**：播放中 `uiautomator dump` 多次返回过期层级（日志 `ERROR: could not get idle state`），一度让"切歌是否生效"看起来矛盾；改用截图 + 诊断 JSONL + `dumpsys media_session` 交叉确认。与陷阱 3.1 同源，本轮补记。
5. **未覆盖**：展开页在 2 倍系统字号下的小屏表现（本轮只验了默认字号）；成员数 ≥3 时的头像堆叠 `+N` 收尾；弱网下动态流的到达时序。

## 补充轮（2026-09-25 晚）：`+N` 堆叠已验证，两处待人工

- **成员 ≥3 的 `+N` 堆叠：通过**（7 人：手机 + 6 个 `member-sim`）——见上表与 08-avatar-stack-plusN.png。该项从"未覆盖"转为已验收。
- **2 倍字体下的小屏展开页：adbd 改不了字体**。`adb shell settings put system font_scale 1.3` 被系统拒绝：`SecurityException: com.android.shell was not granted this permission: android.permission.WRITE_SETTINGS`（与陷阱 2.9 同源：shell 写不了系统设置）。要实测只能人工在「设置 → 显示与亮度 → 字体大小」里调大后再截图，属可选补验。
- **触感轻重：待人工手感**（见上文边界①）。
- **10 分钟摘要淡出：仍未取到**。补充轮里房间 `F1B86AAD` 在 6 个成员退出后开始计时，但随后 **USB 通道掉线**（`adb devices` 为空、`adb reconnect` 无设备，与陷阱 2.2 的"间歇性消失"一致），复查窗口内无法取图；该规则仍只有 `isRecentActivity` 单测覆盖。
