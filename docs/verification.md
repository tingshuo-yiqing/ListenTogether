# 一起听歌 · 当前交付与验收记录

项目：D:\ListenTogether
更新日期：2026-09-26
定位：**进度唯一事实来源**。当前状态看「状态一览」，待办看「尚待验收」；每轮交付以追加「本轮新增」小节的方式登记，测试细节由 docs/test-results/<日期-场景>/ 承载，更早的历史轮次已压缩为「交付历史索引」。

## 本轮新增（工作区与文档清理，2026-09-26 晚，纯文档/工作区、无代码改动、无新 hash）

按用户指示清理过期、无用文件并收敛文档结构；未改任何产品代码与协议，APK 锚 **517A776B…** 不变。

- **工作区清理（均为 gitignore 覆盖、可由源码重建的产物，git 跟踪文件零删除）**：①删除根目录 21 个过期构建/门禁/注入日志（check-*、fix-1345-*、ui-*、load15-*、fault-proxy*、adb-wireless、demo-backend.err）与 `android/gradle.{exit.txt,stderr.log,stdout.log}`（活跃运行日志 `demo-backend.log` 保留）；②`deploy-artifacts/` 由 220MB 收敛至约 117MB——删除 09-22~09-24 四个旧 release tar.gz 及清单（云端 releases/ 仍在、可随时 `package-deploy.ps1` 重建）、两个过期 APK 副本、一次性取证脚本（check-playing/transfer-check/defense-check）与未引用的 diag-110118.jsonl/long-test-samples v1/package-seg1*/script-check 日志；保留在产 release **20260926-1822** 制品 + SHA256SUMS。③长时多人测试的 4 份被引用证据（diag-final jsonl + 3 份 log）从 deploy-artifacts 迁入 `docs/test-results/2026-09-24-long-multiplayer/evidence/` 并更新记录内路径。④经用户确认后删除 `transcoded-20260924/`（105MB 曲库转码产物——云端 `/opt/listen-together/media` 23 首在产、`media-originals/` 有备份，本机属纯冗余副本），`deploy-artifacts/` 最终收敛至 12MB（仅在产制品 + SHA256SUMS）；`demo-media/有何不可.mp3` 是本地唯一副本的个人音频（未被 catalog 引用，gitignore 明确不入库），保留不删。
- **文档收敛**：①[模块 01](modules/01-android-ui.md) 重写为「当前状态 + 变更记录」结构（177→约 60 行），房间动态流/伪封面/搜索/长图等已删除功能的多轮"覆盖式"叙述合并进现状节并标注已删除，历史详述指向本文与 test-results；②AGENTS.md「当前进度快照」中 09-23~09-26 凌晨的 13 条历史轮次 bullet 压缩为 1 条摘要（保留"已删文件不复存在""帧耗时只认 R8 口径"等防坑锚点）；③模块 10 安卓单测口径 91→**96**；模块 05 房主清扫修复标注**已上云**（20260926-1822）；④「尚待验收」三条过期挂账就地关闭（EC5FCF0A 代码基已随 517A776B 装机复测、房主清扫修复已部署、BCF3DE16 文案精简已随装机目视）。
- **门禁**：`check-doc-links.mjs` 全量通过；本轮无代码/测试/构建变更。新增未跟踪设计稿 `docs/track-metadata-design.md`（09-26 歌曲元数据扩展方案，未实施）与迁移后的 evidence/ 目录待随下次提交入库。

## 本轮新增（设备复测：517A776B 装机 + 云端真实曲库回归 + 过期重入闭环，2026-09-26 傍晚）

用户恢复提供真机（USB），指示「使用真实曲库进行测试。测完了后上云再同步到github」。本轮把上一节两处修复的回归面在真机测完，并按用户约束（**不得关闭热点、不得再开飞行模式**）调整了断网手段。

- **装机与一致性**：debug `517A776B…` 装机 PHQ110；`pm path` 回拉**首次不匹配**——`adb pull` 静默截断（4,587,520/23,049,926 字节，USB 抖动，只看末行掩盖报错），重连重拉后逐位一致。教训：装机核对必须同时看字节数与哈希。
- **真机通过项（云端旧后端 release 20260924-0937，23 首真实曲库）**：①冷启 `lastRoom` 预填不静默入房；②建房/播放全链路（`dumpsys media_session` PLAYING、位置 1.0x 前进）；③seek 回归——拖回开头/拖中间/快速连拖**全部确认、无假「进度跳转未确认」横幅**（单调时钟重构行为无回归，修复①闭环）；④展开页控制/下一首环形切歌/暂停恢复位置连续；⑤邀请二维码 zxing 独立反解（剥 `:3000`、无令牌）+ 用户相机扫码入房成功、播放状态保留；⑥`member-sim` 成员进出即时反映（2 人→1 人、在线点亮→灰点）；⑦过期横幅与「重新加入房间」**房主侧闭环**——断网 >60s 被清扫 → 横幅 → 重入成功、24 字符昵称原样（修复②闭环）；⑧24 码元昵称边界——表单输入即截断（`takeCodePoints(it,24)`），恰 24 字符建房与重入均被服务端接受，>24 无法从 UI 构造（纵深防御由单测覆盖）；⑨附带验证服务端清扫：房主被清扫后空房回收，旧码加入报「房间不存在或已过期」且表单内容保留。
- **断网手段修正（用户约束）**：飞行模式会连带关热点，本轮已停用；后续复现「断网 60s+ 清扫」改用 `svc data disable`（仅断蜂窝数据、热点保持开启）。按 HOME 保活/杀进程均无法触发该场景（音频前台服务保活、冷启无横幅），如实记录。
- **后端已上云（同日晚，release 20260926-1822）**：09-26 后端修复（清扫清空房主 + 首个上线成员立即接任）随打包上云，prev=20260924-0937 可回滚。打包 tsc 0 错误、42/42 解包校验、listen 构建干净；旧版基线与新版 `m4-deploy-verify.sh` 均 **14/14**；重启清空内存房间（用户已授权）。**专项验证**：HostA 掉线 75s 被清扫 → MemberB 加入即 `hostId=MemberB`（hostIsB: true，旧版悬空 hostId 行为已消除）。设备端对新后端的入房冒烟未做（第三次 USB 掉线，如实标注）。证据：[2026-09-26 云端部署](test-results/2026-09-26-cloud-deploy/README.md)。
- **未覆盖（如实标注）**：双人真机同屏（缺第二台，成员交互由 `member-sim` 覆盖）；触感人工手感、大字号、小屏、弱网注入、真实令牌作废、升级失败注入照旧挂起。证据与逐项步骤：[2026-09-26 设备复测](test-results/2026-09-26-device-retest/README.md)。

## 本轮新增（本地审计收尾：seek 确认单调时钟 + 重新加入昵称合成，2026-09-26 下午）

用户指示先修不用真机测试的问题、后统一测试。本轮为 09-26 遗留修复轮的同日补充：全链路代码审计后仅两处本地缺陷，无协议/行为约定改动，无设备、无云端操作。

- **seek 确认窗口改用单调时钟**（`ui/RoomPlayer.kt`）：确认窗口（发起以来流逝 + 1500ms）此前用 `System.currentTimeMillis()` 差值度量，系统对时跳变会让窗口失真；改 `SystemClock.elapsedRealtime`（`nowMs` 注入保持可测）。确认判定抽成纯函数 `seekConfirmed`（快照版本新于发起时刻 + 相对贴合，沿用 E-07 相对推进量口径），拖回开头等低目标不受绝对比较恒真缺陷影响。主源码已无 `System.currentTimeMillis()` 做流逝度量的残留。陷阱回填 **9.7**。
- **过期横幅「重新加入房间」补昵称合成**（`MainActivity.kt`）：`onRejoin` 此前透传原始输入昵称，绕过 `composeNickname`（≤24 码元，与服务端一致）；重新加入长昵称会被 400 拒绝。已改为 `composeNickname(null, input.name)`。
- **门禁（实跑）**：后端 tsc + **23/23**；Android `cleanTest` 后 **96 项实跑、0 失败/错误/跳过**、Lint **0**（报告先删再生）、Debug + R8 benchmark 构建通过（退出码 0，4m 3s）。新增 `SeekConfirmTest` 4 项。**计数口径更正**：上一轮登记的"91"按测试文件归类少计 1（`DisplayNameTest.kt` 文件内含两个测试类），真实基线 92，本轮 96 = 92 + 4。
- **当前交付锚（未装机）**：debug `517A776B05C30EEBF2E7A0E2B68FE315F959748F0C3C8057FC20B975B69D98A3`；benchmark `764D0FE19B27DEC71EA629115297CE1D74911DF1E782F775A2282F149239F1B8`（性能测试专用，不分发）。seek 真机听感与全部设备项留待统一测试。证据：[逐项清单与证据](test-results/2026-09-26-legacy-fixes/README.md)「补充小轮」节。

## 本轮新增（遗留问题逐项修复，2026-09-26）

- **邀请入口**：修正 `InviteCode.HINT`，明确扫码/手动输入房间码；补齐 8 位码尾部字母数字边界，错误长码不再被截短后误加入。旧邀请仍兼容。
- **房主生命周期**：全员超时清扫时清空旧 `hostId`；无现存房主时 connect 在首份在线快照前补位，避免到下一 tick 才有控制权限。60 秒宽限、最早在线成员与五分钟回收规则不变。**仅本地修复，未部署云端**（后已于同晚随 release 20260926-1822 上云，见「设备复测」节）。
- **倍速复位**：修复 load/大漂移 seek 只清缓存、不写回播放器的问题；删除重复缓存，暂停/换曲/seek 以实际 PlaybackParameters 复位。同步阈值未改。
- **证据修复**：旧 `label-lag.py` 忽略 dump 失败并可能重读旧 XML，三张原截图均显示「播放中」，撤回对 `PlaybackView` 的确定性归因；修复脚本并补离线回归。保持既有界面精简，无新真机结论。
- **文档修复**：纠正 M3-LONG 已完成却仍挂起、偏好持久化与同步滞回区描述；未来歌词/reaction 属新功能，设备/TLS 项仍按外部条件挂起。
- **门禁**：后端 tsc + **23/23**；Android cleanTest 后 **91/91**（失败/错误/跳过均 0）；采样脚本 **3/3**；Lint **0**（报告先删再生）；Debug + R8 benchmark 构建通过，Gradle 退出码 0；文档链接与 diff 检查通过。
- **当前交付锚**：debug `EC5FCF0A987D10087CE88CEC228CF4509CDCC5B4E6D06E0CC79662005A4C4870`；benchmark `F943E3CA4942B84E23169CF0927A07BE11D607329F27DA86B27225F894E2438B`（性能测试专用，不分发）。**均未装机**，不沿用旧包真机结论。详见 [逐项清单与证据](test-results/2026-09-26-legacy-fixes/README.md)。

## 本轮新增（夜轮装机验收 + 界面提示精简，2026-09-25 深夜 → 09-26 凌晨）

> 夜轮（入房恢复 / 二维码邀请 / `benchmark` 性能变体）代码此前只有构建记录、无门禁无装机。本轮补齐门禁与真机部分场景，并按用户指示删除低价值状态文案后收尾。**终稿未装机**（用户告知此后无法提供真机）。

- **门禁补跑与首轮失败**：`:app:lintDebug` 报 `PermissionImpliesUnsupportedChromeOsHardware`——夜轮为扫码加了 `CAMERA` 权限却没有 `<uses-feature android:name="android.hardware.camera" android:required="false"/>`，ChromeOS 上等于"权限允许但硬件不支持"。补该声明并清掉 2 条 `UseKtx`（二维码位图改 `androidx-core` 的 `createBitmap`/`set`）后重跑：**86 项单测 cleanTest 实跑 0 失败/0 错误/0 跳过、Lint issues=0（报告先删再生）**。另一次教训：后台包装器只 `tail` 日志会把 `BUILD FAILED` 误读成通过，采集 Gradle 结论必须把退出码写进日志（陷阱 1.7 补充）。
- **装机与一致性**：debug `9C480583…`、benchmark(R8) `08607981…`（2.4 MB vs debug 23 MB，`> Task :app:minifyBenchmarkWithR8` 已执行）均 `pm path` 拉回 base.apk，SHA256 与锚逐位一致；夜轮全部真机场景在这两包上完成。
- **真机通过项**（PHQ110 / Android 14 / 云端 `http://8.166.126.136:3000`）：①冷启不静默入房 + `lastRoom` 预填昵称与房间码；②`rememberSaveable`/`JoinInputSaver` 在强制重建（`cmd uimode night yes`）后表单不丢；③Expired 横幅「重新加入房间」用当前房间码换发新令牌并恢复入房；④房间被服务端回收后再入房 → 表单内联「房间不存在或已过期」且内容保留；⑤邀请二维码生成——对设备截图独立反解得四行文本，与 `InviteCode.encode` 行/字符逐位对应，`:3000` 已剥、无 32 位十六进制令牌；⑥benchmark 变体接受 HTTP、建房选歌播放全链路正常（`dumpsys media_session` PLAYING 且位置前进）。
- **滚动帧耗时同条件 A/B（本轮关键结论）**：播放中同一脚本同一曲目，R8 包快滑 777 帧掉 6 帧 **0.77%**、带 1s 停顿 616 帧掉 1 帧 **0.16%**（P50/P90/P95 = 10/13/14 与 11/15/16 ms）；同源码 debug 包为 **7.66% / 2.08%**（P95 34 / 25 ms）。**上一轮记在 debug 包上的 27.27% / 13.38% 不能外推到用户实际拿到的 R8 构建**——给用户的构建里歌单滑动掉帧已在 1% 量级、P95 在 60Hz 预算内；跨轮次的 debug 对比（27.27%→7.66%）因帧总数与滑动节奏不同，只算倾向性证据，不作"优化了 X%"宣称。
- **真机未覆盖（如实标注）**：相机扫码入房（需人工把手机对准屏幕）、双人同屏与成员展开 180dp 滚动（ColorOS 后台断网使同机两客户端无法同时在线，且 PC 侧访问公网被策略拦截、本机演示后端曲库为空）、空歌单、2 倍系统字号、小屏布局、emoji/代理对昵称真机目视（`adb input text` 打不进非 ASCII，仅单测覆盖）。证据、脚本与限制清单见 [night-acceptance](test-results/2026-09-25-night-acceptance/README.md)。
- **播放态文字显示疑点（09-26 复核已撤回过强归因）**：旧脚本未检查 dump 成功且可能重读旧 XML，13 次采样不能证明界面持续错误；17/18/19 三张留存截图均显示「播放中」。已修取证脚本，缺真机不能逐样本重验。删除状态文案的产品决定保持；不再断定 `PlaybackView` 通路有缺陷。详见 [遗留修复证据](test-results/2026-09-26-legacy-fixes/README.md)。
- **界面提示精简（用户指示）**：删除 `playbackLabel` 纯函数与 MiniPlayer 副标题、展开页「当前歌曲 + 状态」行、「播放与暂停同步给所有人 / 暂停只影响自己 · 进度由房主控制 / 连接就绪后即可播放」说明行；`PlaybackView` 随之只留 `mediaId`/`failed` 两个仍被消费的观测字段，`MiniPlayer`/`PlayerSheet` 去掉 `playback` 参数。保留的可见反馈：状态横幅（含重试/重新加入/退出入口）、歌单当前曲高亮 + `PlayingIndicator` 动效条、播放键图标。单测 86 → **84**（净删 2 项状态文案回归，`showStatusNotice` 的旧曲目/失败/本机暂停判定仍保留）。
- **终稿锚（未装机）**：debug `BCF3DE1630969684B05BB6552E26925F76E34C0039C78B212F950CA250027AFE`、benchmark `9E17F2916D1E4B3A3F3C21A51CEC476E6EDEF51886179081E5FC5E34A72C7302`；84 项单测实跑、Lint issues=0。夜轮此前登记的候选锚 `E984FF40…`/`A201AE4A…`（未跑门禁、未装机）被上面两代取代。
- **坑回填**：陷阱 **2.13**（同机两包测不了双人：ColorOS 后台断网 + 60 秒清扫必然触发；改走"单机 + `member-sim` + 本机后端"，同时这条链路是失效路径的免费复现器）、**2.14**（`isDebuggable=false` 的性能包 `run-as` 直接拒绝，取证只能 `dumpsys media_session`/截图/`gfxinfo`；`applicationIdSuffix` 使 `am start -n <id>/.MainActivity` 报不存在）、**3.7**（`input text` 打不进非 ASCII、URL 的 `://` 被两层引号吞掉；多行框清空要 `MOVE_HOME`+`FORWARD_DEL`，`MOVE_END` 只到行尾）、**2.9 补充**（`settings put system user_rotation` 同样被拒，验证 `rememberSaveable` 改用 `cmd uimode night yes|no` 强制重建 Activity）、**5.6**（`CAMERA` 权限缺 `<uses-feature required=false>` 被 Lint 阻断，加权限与跑 Lint 必须同轮）、**5.7**（`grep -c "<issue"` 把根标签 `<issues>` 数成 1 条）、**1.7 补充**（后台包装器必须回写 Gradle 退出码，否则 `BUILD FAILED` 被 `tail` 的 0 掩盖）。

## 本轮新增（歌单滚动与界面精简，2026-09-25 晚）

用户反馈已明确：「滑动延迟」仅指上下滑动歌单，进度条 Bug 已修复。本轮不修改进度条与播放同步逻辑。

- 删除首页头像选择及偏好读取/保存，取消自动拼入旧头像；删除房间动态摘要、时间线与派生订阅；删除 MiniPlayer/展开页的歌曲首字封面。保留当前成员、连接异常提示与播放控制。
- 歌单改为圆角面板：固定歌单标题/数量、中间曲目独立滚动、底部播放器常驻；序号替代重复音符，当前曲目高亮。成员展开有高度上限并可独立滚动。
- 已查出的滚动负担：当前曲动效每帧改变 Box 高度，触发组合/测量；改为固定尺寸 Canvas 内绘制。切歌跟随在用户滚动时让路，曲目索引不再依赖横幅/成员/标题数量；房间页去掉无用的收键盘手势。
- 验证：`:app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug` 构建通过，**86 项单测实跑，0 失败/错误/跳过**（删除动态 13 项、伪封面 1 项专属测试）；Lint 分析完成后删除旧报告并单独执行 `:app:lintReportDebug`，**新生成 XML issues=0**；文档链接检查通过。APK SHA256 **80CF7629C3BB7416CC82F4728F5A9F6CA240269948D4D6D26CE1D13E2B92625E**。证据见 [本轮记录](test-results/2026-09-25-playlist-feedback/README.md)。
- 真机补验（21:54–21:59）：用户开启无线调试后已覆盖安装 PHQ110，回拉 base.apk SHA256 与 **80CF7629…** 一致；首页无头像选择、固定歌单标题/底部播放器、独立滚动、无歌曲首字封面、成员展开无动态时间线均已截图确认。播放中连续 8 次滑动 janky **27.27%（66/242）**，带 1s 停顿的 4 次滑动 **13.38%（19/142）**；**仍有掉帧，性能项待优化，不宣称已彻底修复**。没有旧版同条件 A/B；小屏/大字号、滚动中切歌、人工手感尚未覆盖。测试结束已暂停播放。
- 历史说明：下方批次 A 记录保留作为证据；其中房间动态淡出、伪封面、头像选择的未覆盖项随功能删除作废。

## 本轮新增（入房可靠性、二维码邀请与滚动性能诊断，2026-09-25 夜）

- 修复项 1：上一轮快滑数据来自 debug 包（连续 27.27% janky、带停顿 13.38%），不能外推给用户构建。增加 R8 优化的 `benchmark` 变体，独立包名、debug 签名、仅该变体允许 HTTP 连接试用服务器；`isDebuggable=false`，R8 shrink/minify 已执行。APK SHA256 `A201AE4A07AB700590651DDCB331B18E0CCFBB6D72069FD1F8158D2523C68B8B`，安装命令使用 `adb install --no-streaming` 成功。**本轮未取得新版帧耗时**：设备前台当时是无关应用，停止了后续点击，避免干扰；本轮前的 debug 数据仅作问题基线，尚不能宣称滑动卡顿已彻底解决。正式 release 仍拒绝 HTTP。（帧耗时已由 09-25 深夜轮在同一条件下补测：R8 0.77%/0.16% vs debug 7.66%/2.08%，见上节与 [night-acceptance](test-results/2026-09-25-night-acceptance/README.md)。）
- 修复项 3：昵称输入用 `takeCodePoints`（24 UTF-16 码元上限，不截半个代理对）；`JoinInputSaver` 通过 `rememberSaveable` 保存表单与公开邀请字段，旋转/进程恢复不丢表单内容，令牌不保存。
- 修复项 4：最近成功加入的公开房间码与昵称存本机；不自动登录、不存成员令牌。进程重启时手动表单预填；会话 expired 增加「重新加入房间」，用当前房间码重新向服务器申请新凭证。按用户指示，加入入口暂停剪贴板粘贴，改用相机扫描邀请 QR；房间页顶栏生成相同口令 QR，手动输入码保留备用。
- 修复项 5：公网 TLS/令牌链路改造挂起到购买香港实例迁移时。当前阿里云大陆三个月试用实例沿用此前已确认的仅小范围 HTTP 试用决定；**APK release 继续拒绝 HTTP**，benchmark 变体是本机测试专用，不分发。
- 方向 6：第一版歌词建议为曲库 ID 绑定的 LRC 文件、本机播放器位置驱动逐行高亮、手动翻看时暂停自动跟随并提供「回到当前歌词」；先人工维护少量有授权来源歌词，不做第三方搜索/聊天室混入。详细方案见 [路线图的歌词一节](next-development-plan.md#歌词功能建议方案排在稳定性收尾之后)。歌词时间轴仍需独立验证真实位置、缓冲与 seek；旧播放态采样证据已被复核质疑，不能据此预判歌词必然失败。
- 双机同步（2）遵照用户要求继续挂起。
- `:app:assembleBenchmark` 构建成功（R8 已运行）；未执行单元测试，也未完成设备帧耗时采集。旧 `proguard-rules.pro` 文件缺失的构建警告已补空规则文件。

## 当前状态一览（2026-09-26）

| 阶段 | 状态 | 说明 |
|---|---|---|
| M0 诊断与可观测性 | ✅ 完成 | 客户端诊断 JSONL（无令牌、20MB/60 分钟上限）+ 诊断分析脚本 |
| M1 会话与断线稳定 | ✅ 完成 | SessionContext/状态机/代次隔离；真机复测 + 延迟/断线/过期故障注入 |
| M2 双机同步 | ⏸ 挂起 | 缺第二台手机（外部条件触发，不能用观察客户端代替） |
| M3 稳定性 | ✅ 完成 | 通知栏实际点击/短时息屏/蓝牙断开/音频焦点/401 全过；**M3-LONG 已完成（2026-09-24：真实音乐 70 分钟 + 息屏 30 分钟 + 多人进出，见本轮新增）** |
| M4 云端部署 | ✅ 完成 | 四项部署门槛全部关闭（见下） |
| 0.2.0 收尾 | 进行中 | 转入试用反馈驱动的修复循环；2026-09-24 后端防线 E-05/E-09/Q-3 **已上云**（release 20260924-0937） |
| 09-25 夜轮（入房恢复 + QR + 性能变体） | ✅ 门禁 + 6 项真机场景 / ⏸ 扫码与双人待补 | 86→84 项单测实跑、Lint 0；`9C480583` 与 R8 包 `08607981` 装机并回拉一致；预填/配置恢复/重新加入/回收失败/二维码反解/HTTP 放行全过；**R8 歌单滑动掉帧 0.16%–0.77%（debug 7.66%–2.08%）**；扫码入房、双人同屏、空歌单/大字号未覆盖；删状态文案后的终稿 `BCF3DE16` 未装机 |
| 09-25 晚试用反馈首轮 | ✅ 装机与基础布局 / ✅ 性能基准已补 | 歌单固定标题与独立滚动、播放动效仅重绘；移除头像选择/房间动态/歌曲首字封面；86 项单测与 Lint 0；PHQ110 已装机，布局通过；当时 debug 包 27.27%/13.38% 掉帧已由夜轮 A/B 澄清为 debug 口径，R8 实测 1% 量级 |
| 0.3.0 一起听体验（批次 A，历史） | ✅ 真机验收通过 | 房间动态流 + 伪封面 + 歌单跟随 + 触感/无障碍 + 头像 emoji；100 项单测实跑、Lint issues=0；**2026-09-25 下午 PHQ110 真机 6 项场景通过**（真机抓到并修复 1 处展开页半屏回归；触感标人工手感、10 分钟淡出未覆盖），见 [批次 A 真机记录](test-results/2026-09-25-device-batch-a/README.md) |

M4 四项部署门槛（2026-09-23 晚全部关闭）：

1. 首次部署 + 13 项服务端验证 + SSH 隧道联调 9/9（2026-09-22）。
2. 真机公网 E2E 建房→播放全链路（W2，APK 36BD3A5B…，公网校时 RTT 中位 65ms）。
3. 升级/回滚演练双向通过（W3，两次 health 第 2 秒 200、13 项抽查三次各 13/0）。
4. LOAD-15 云端公网重测（W4，15 路×600s 全 206 零失败、2.847Mbps=本地基线 99.1%）。

关键锚点：

- 当前交付锚 **517A776B05C30EEBF2E7A0E2B68FE315F959748F0C3C8057FC20B975B69D98A3**（09-26 补充小轮：seek 确认单调时钟 + 重新加入昵称合成；96 项单测实跑、Lint 0；**已装机 PHQ110 并完成本轮真机复测**，`pm path` 回拉一致）；benchmark 锚 **764D0FE19B27DEC71EA629115297CE1D74911DF1E782F775A2282F149239F1B8**（R8，未装机）。
- 上一轮交付锚 **EC5FCF0A987D10087CE88CEC228CF4509CDCC5B4E6D06E0CC79662005A4C4870**（遗留逐项修复轮；91→更正为 92 项单测口径、Lint 0；**未装机**）；benchmark **F943E3CA4942B84E23169CF0927A07BE11D607329F27DA86B27225F894E2438B**。
- 上上轮交付锚 **BCF3DE1630969684B05BB6552E26925F76E34C0039C78B212F950CA250027AFE**（夜轮改动 + 删除状态文案后的终稿；84 项单测实跑、Lint issues=0；未装机，已被 517A776B 覆盖）。**在机版本现为 `517A776B…`**（09-26 补充小轮，本轮真机复测通过，`pm path` 回拉一致）；性能对照包 benchmark(R8) 在机 `08607981…`，`764D0FE1…` 未装机。夜轮登记过的候选锚 `E984FF40…`/`A201AE4A…` 未跑门禁、未装机，已被取代。上一真机验收锚 **80CF7629C3BB7416CC82F4728F5A9F6CA240269948D4D6D26CE1D13E2B92625E**（歌单精简版）基础布局通过、滚动掉帧待优化——本轮 A/B 已证明该数据是 debug 口径，R8 构建实测 0.16%–0.77%。
- 上一装机 APK 锚 **D882D18632E04E28887DD8D87181410CE1115098838E6C8729B5B9A77D2E4767**（0.3.0 批次 A 终稿 + 真机修复：批次 A 全部内容 + `PlayerSheet` 改 `skipPartiallyExpanded`；100 项单测、Lint issues=0；**已装机 PHQ110 并完成 6 项真机验收**，装机后 `pm path` 拉回 base.apk 复核 SHA256 逐位一致）。
- 上一稿 **F5827821…**（批次 A 复核稿，未装机）：真机验收暴露出展开页半屏回归，被 D882D186 覆盖。
- 上一在机版本 **C685CE0ADE0B7E3288BB13465B74D0A5D65D421A42A79D8415D2E4C9ED67B30E**（反馈二小轮：顶栏去房间码 + 删保存长图；当时未跑门禁，本轮开工补跑门禁得到同一 hash，欠账已关闭，见下）。
- 上一交付锚 **011DD835CF111A9DB8B352E206B00A341962EC5D5722D3D8830AC54BFEF1910E**（试用反馈轮：通知栏/展开页上一首下一首 + 顶栏收拢 + 口令隐端口 + 去搜索；74 项单测、Lint 0；真机部分实测通过，详见下）。
- 云端：release **20260926-1822** 在产（prev=20260924-0937 保留，20260922-2159/20260923-2157 亦在 releases/）；入口 `http://8.166.126.136:3000`。TLS 路线 A 已决策：**维持 IP 明文**（试用 ECS 无法备案、备案拦截按域名跨任意端口生效、Let's Encrypt 不签裸 IP），正式化留待转包年包月备案或迁香港。
- 云端曲库 23 首真实音乐（96.5 分钟，192k；2026-09-24 按试用反馈移除 demo-load 负载测试音，备份在 media-originals/20260924-221628/，云端负载重测需先恢复——见 [陷阱 8.10](development-pitfalls.md)）。
- 后端防线 E-05（WS 握手限连）/E-09（同 IP 建房配额 ≤3）/Q-3（事件日志 + health 计数）**已于 2026-09-24 上午上云并通过 14 项验证与新防线专项验证**；升级失败注入仍未做。
- 剩余待办与恢复条件：M2 双机（缺设备）/ M3-LONG（≥70 分钟窗口）/ TLS 正式化（用户决策）/ 补测项（蜂窝公网、弱网注入、真实令牌作废、升级失败注入），详见 [路线图与验收标准](next-development-plan.md)。

## 本轮新增（0.3.0 批次 A 一起听体验轮：房间动态流 + 伪封面 + 跟随滚动 + 头像 emoji，2026-09-25）

> **Android 客户端轮**：只改 `android/app` 与文档，未动 `server/`、未改协议与行为约定、未部署、未做 git 提交、**未做真机验收**（用户明确说明本轮无法进行真机测试）。验收证据只有 Gradle 门禁与 JVM 单测，真机项全部显式挂起。详细说明见 [模块 01 Android UI](modules/01-android-ui.md)。

- **房间动态流（A1，零协议改动）**：服务端只推全量快照、没有事件通道，新增 `ui/RoomActivity.kt` 以纯函数 `RoomActivity.derive(previous, current, tracks)` 对连续快照做差分，得出"加入/离开/上下线/房主转移/换曲/播放暂停"事件。三条约定：①首帧（刚入房、断线重连后的第一份快照）不产生事件，避免整屏"XX 加入了房间"；②服务端在成员离线 60 秒后才移除（store 的 tick），"离开"只在上一帧仍在线时产生，否则会在"掉线了"之后补一条重复的"离开了"；③同帧换曲 + 开播只报换曲。第④条由核对 `server/src/rooms/store.ts` 得出：`add()` 先广播（新成员 online=false），WS 连上后 `connect()` 才置 online=true，所以"在线"事件必须要求该成员此前被见过在线（调用方跨快照维护 `everOnline`，`updateEverOnline` 只保留当前房间内成员），否则每个新人都会刷出"加入了房间"+"回来了"这条假动态——这正是本来自查发现并修掉的缺陷。
- **动态展示**：成员区折叠行第二行改为"连接状态 · 最近一条动态"（不额外占行），且**摘要只保留 10 分钟内的动态**（更早的会淡出，避免旧动态读起来像刚发生；完整历史仍在展开的时间线里）；展开后成员列表下方为「房间动态」时间线（最近 8 条、最新在上、右侧相对时间）。事件保留 20 条；相对时间与淡出判定每 30 秒刷新（`rememberNowMs`）。订阅来源是 `RoomClient.state` 的原始快照，而不是界面的 `screenStates()`——后者为播放进度做了 500ms 去重，会丢成员与播放状态的中间帧。
- **伪封面（A2）**：曲库没有封面字段（`Track` 只有 id/title/durationMs），新增 `ui/TrackArtwork.kt` 用"稳定取色 + 首字素"绘制：复用头像的 `avatarPaletteIndex`（同一首歌颜色恒定）、配色取主题色对（container 与对应 on 色）、渐变终点只向内容色靠拢 22% 以保住文字对比度、空标题回落 ♪。MiniPlayer 左侧加 44dp 缩略图；PlayerSheet 改为「180dp 封面居中 + 标题居中 + 主控居中 + 进度与时间左右对齐」，并整体可滚动（小屏/大字体不裁切，大屏观感不变）。
- **歌单跟随（A3）**：`rememberLazyListState` + 切歌后 `animateScrollToItem`；目标行已在屏幕上时不滚动，不打断用户当前浏览位置；横幅出现/消失导致布局晚一帧、目标越界时放弃本次跟随而非交给 LazyList 处理。
- **触感与无障碍（A3）**：播放/暂停、上一首/下一首、拖动结束各给一次 `HapticFeedbackType.LongPress`；MiniPlayer 的整条点击由 `pointerInput + detectTapGestures` 改为 `clickable`——手势写法不产生语义点击动作，读屏点不开播放页；成员区（展开/折叠）补 `stateDescription`，头像圆片补 `contentDescription`（读屏中文名；选中状态由 `selectable(role=RadioButton)` 语义承载，不写进描述以免重复播报）。
- **头像 emoji（B2，零协议改动）**：协议 `members[]` 只有 `name` 字段，新增 `ui/DisplayName.kt` 约定"昵称首个字素是 emoji 即当作头像"：`firstGrapheme`（码点/字素簇级，整体取回 ZWJ 组合、肤色修饰符、成对地区指示符）、`isEmojiGrapheme`（emoji 区块判定，不含 CJK 与拉丁字母）、`splitAvatarPrefix`、`composeNickname`（`头像 + 空格 + 昵称`，总长 ≤ 24 码元，与服务端 1–24 字校验一致；用户自己敲的 emoji 优先，不重复叠加）。入房表单昵称下方新增头像圆片选择器（「无」+ 6 个 emoji，横向可滑，`selectable(role=RadioButton)`，读屏用中文名）；选择经 `ConnectionStore.loadAvatar/saveAvatar` 持久化（接口默认实现返回空，既有测试替身无需改动）。成员行文字改用 `memberDisplayName`，头像 emoji 不在文字里重复出现；`MemberAvatar` 不再 `take(1)`。
- **新增 26 项 JVM 单测**：`RoomActivityTest` 13 项（首帧无事件、同快照无事件、加入与离开、离线后移除不重复、掉线回来、新成员首次连上不报"回来了"、`everOnline` 只保留在房成员、房主转移与无主回退、换曲标题与曲库缺失兜底、同帧换曲不报播放态、相对时间分档与时钟回拨、折叠摘要 10 分钟淡出、缺名与"播放已暂停"兜底文案）、`DisplayNameTest` 10 项（含反例断言 `"🐱 小王".take(1).length == 1`、`takeCodePoints` 不切代理对、头像前缀放不下整个 emoji 时宁可少一字）、`AvatarGlyphTest` 3 项（头像/成员文字/封面三处取字符一致）。
- **独立复核（第二轮质量关，替代缺失的真机测试）**：因本轮无设备，另起一个独立复核会话对全部改动做对抗性审查（读 server 源码核对差分时序、逐项检查 Compose 状态/布局/无障碍/API 26 可用性）。结论**无阻断项**，确认无问题的项包括：差分规则与服务端一致、同内容快照不产生假事件、`everOnline` 修复正确、订阅线程与生命周期无冲突、ModalBottomSheet 可滚动后拖拽未被破坏、`animateScrollToItem` 无越界崩溃、MiniPlayer 改 `clickable` 后内层播放键仍独立。查出并已修的问题：
  - **重要①（既有缺陷，本轮顺手修）**：`rememberRoomPlayer` 原以 `client` 为唯一 key，`pendingSeek` 记着上一间房的快照 version；新房 version 从 0 起会让确认分支永不成立——滑条停在上一个房间的目标值，5 秒后新房凭空弹"进度跳转未确认，请重试"。改为 `remember(client, ui.credentials?.token)`。
  - **重要②（本轮新代码）**：动态时间线用纯 `remember`，而 Manifest 未锁方向、无 `configChanges`，旋转/切深色/改字号会重建 Activity → 时间线归零而展开状态被 `rememberSaveable` 保留，出现"展开着却一条动态都没有"。改为 `rememberSaveable(stateSaver = listSaver(...))`，并返回 `State` 让读取发生在成员区条目内（避免每条动态重组整页）。
  - **次要③**：成员区整行的读屏文本被箭头图标的 `contentDescription` 盖掉（TalkBack 只念"查看成员"），本轮新增的"最近动态"完全不可达；`selectable(selected=false)` 还与"已展开/已折叠"矛盾。改为 `clickable(role=Button, onClickLabel=…)` + 图标 `contentDescription = null`。
  - **次要④**：末曲自然播完时服务端同样置 `playing=false`（store.ts 的 tick），原文案"暂停了播放"读起来像有人按了暂停 → 改为被动的"播放已暂停"。
  - **次要⑤**：昵称按 UTF-16 码元 `take` 截断会切出半个代理对（服务端存成 `?`、界面方框）→ 新增 `takeCodePoints` 按码点截断，放不下整个 emoji 时少一个字。
  - **次要⑥⑦⑧⑨**：点击类动作用轻触感（`TextHandleMove`）、只在拖动结束后保留长按级触感；头像圆片 44→48dp 并给选择器加 `selectableGroup()`；修正 `TrackArtwork` 关于"与头像同色"的失真注释；修正"避免 emoji 重复"的注释（纯 emoji 昵称的文字行仍是它本身）。
  - 复核另记录一条**服务端遗留观察**（非本轮代码、客户端无需改）：全员离线时 tick 会移除房主却不更新 `hostId`，留下指向已移除成员的 hostId（已由 09-26 本地修复，未部署）；只要还有在线成员，旧实现下一 tick（250ms）即转移，客户端届时正常播报"X 成为了房主"。该轮未做的 `JoinInput` 配置恢复已由 09-25 夜轮 `JoinInputSaver` 修复并真机验证。
- **自查发现并修掉的一个真实缺陷**：核对 `server/src/rooms/store.ts` 时发现 `add()` 先广播（新成员 online=false）、WS 连上后 `connect()` 才置 online=true，原差分规则会把每个新人播成"加入了房间"+"回来了"两条——后者是假的。改为要求"该成员此前被见过在线"（`everOnline` 跨快照集合 + `updateEverOnline` 只保留在房成员，集合有界），并补 3 项单测钉住（这是真机测试一定会看到、而单测原先覆盖不到的路径）。
- **构建验收**：`gradlew :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug` → **BUILD SUCCESSFUL**；单测**实跑 100 项（74 基线 + 26 新增），0 失败 0 错误 0 跳过**（`build/test-results/testDebugUnitTest/*.xml` 合计 `tests=100`，日志中 `> Task :app:testDebugUnitTest` 不带 UP-TO-DATE）；Lint **`lint-results-debug.xml` issues=0**（先删报告再跑，日志中 `> Task :app:lintReportDebug` 不带 UP-TO-DATE——上一轮的 txt 是 09-24 的旧文件，照抄等于引用旧结论，见陷阱 5.5 补充）；`check.ps1 -Scope docs` Markdown 本地链接检查通过。**APK SHA256 F5827821…**（该稿未装机；同一源码两次构建 hash 一致；真机验收后已被 D882D186 覆盖，见下）。
- **开轮先还门禁欠账**：本轮开工先对改动前代码跑了一次完整门禁（cleanTest + test + assembleDebug + lintDebug）——**74 项实跑全过、Lint 0**，且该次产出的 APK SHA256 = **C685CE0A…**，与 09-25 装机锚逐位一致（顺带证明工作区源码就是装机版本），反馈二小轮"未跑门禁"的欠账就此关闭。
- **真机验收（2026-09-25 下午完成，PHQ110 / Android 14 / 云端后端 `http://8.166.126.136:3000`）**：设备就位后按原挂起清单逐项实测——①房间动态流：脚本成员加入/掉线/回来/离开四条动态文案与人数正确，**掉线超 60 秒被服务端移除后不补报"离开了房间"**（抑制规则实测），时间线 6 条按时间倒序且相对时间分档正确（刚刚/1/2/3 分钟前）；②伪封面与展开页布局（含修复后复验）、返回键收起；③歌单跟随：当前曲滚出视野时切歌自动滚到新当前曲、当前曲已在屏内时不跳动；④头像 emoji：成员区头像为 🐼 且文字行 `AliceLongName12345678` 不重复、重装+重启后选择保留（`checked=true`）、24 字昵称 + emoji 前缀入房未触发 400（服务端快照名字为 `🐼 AliceLongName12345678`，即前缀 3 码元 + 昵称 21 = 24）；⑤触感**无客观证据**（`dumpsys vibrator_manager` 的 TOUCH 历史不记录 `performHapticFeedback`），标人工手感项；⑥暗色与动态取色下封面文字、进度与说明可读。**装机一致性复核**：`pm path` 拉回 base.apk 的 SHA256 与交付锚逐位一致。
- **真机发现并修复的 1 处回归（展开页半屏）**：`ModalBottomSheet` 默认 `skipPartiallyExpanded = false`，内容高于半屏时先停半屏锚点——真机上进度滑条、时间与同步说明都落在屏幕外，主控制项要再滚一次才够得着（独立复核曾预判"基本等同全展开"，真机证明该预判不成立）。改为 `rememberModalBottomSheetState(skipPartiallyExpanded = true)`，小屏/大字体仍由内容列 `verticalScroll` 兜底。修复后重跑门禁（100 项单测、Lint issues=0），装机复验 ①②③⑥ 全过，APK 由 F5827821 → **D882D186…**。
- **真机验收的可复用物料**：新增 `scripts/member-sim.mjs`（`create/join/resume/leave`，成员必持 WS、`--hold` 到期即"掉线"、逐行 JSON 输出），把"缺第二台手机"从**阻塞项**降级为**脚本可覆盖**；文档见 [模块 09](modules/09-build-deployment.md)。证据与截图见 [2026-09-25 批次 A 真机记录](test-results/2026-09-25-device-batch-a/README.md)。
- **坑回填**：陷阱 **4.6**（`take(1)`/`take` 截断 emoji 代理对；昵称 24 字上限在客户端与服务端两处校验，拼头像前缀后必须再按码点截断）、**4.7**（`remember` 的 key 漏了会话/配置维度：跨房间复用与重建清零，含"状态属于哪一层"的判定口诀）、**1.7**（`*>&1 | Out-File` 采集 Gradle 输出会把 Kotlin 报错拆行加装饰导致搜不到，改用 `1>out 2>err` 文本重定向）、**5.5 补充**（`lintReportDebug UP-TO-DATE` 时磁盘报告可能是上一轮的），以及第 7 节新增"看起来没变的替换会吃掉行尾换行并把两个 import 并成一行"（本轮真实踩到两次）。

## 本轮新增（反馈二小轮：顶栏去房间码 + 删除保存长图，2026-09-25）

> 用户指示："去掉房间号显示，去掉保存长图功能。其它部分放弃验证，实现功能就行不需要测试。" 本轮按指示未跑单测/Lint/真机验收，仅做 `:app:compileDebugKotlin` 编译确认通过；APK 已于 2026-09-25 应要求重建并装机（仅 assembleDebug，未跑门禁）：SHA256 **C685CE0ADE0B7E3288BB13465B74D0A5D65D421A42A79D8415D2E4C9ED67B30E**（含本轮与试用反馈轮全部 Android 改动；上一交付锚仍为 011DD835…）。

- **顶栏去房间码**：`MainActivity.kt` TopBar 房间页不再显示房间码胶囊，与入房页统一显示「一起听歌」；操作区仍为分享与退出。房间码只出现在邀请口令文本与加入前的邀请确认卡（`InviteCode` 与分享逻辑不变）。
- **删除保存长图**：`ui/PlaylistImage.kt` 整文件删除（exporter/按钮/PNG 绘制编码），MainActivity 移除 import、`rememberPlaylistImageExporter` 与 `imageExporter` 参数透传和歌单标题行按钮；无关联单测，无残留引用。此前记录的 ColorOS 系统长截屏兜底随功能一并移除。
- **试用反馈轮真机验收终止**：上轮（011DD835）真机 8 项场景在设备可用时段已实测通过 5 项（通知栏下一首/上一首/末首回绕切歌、Sheet 切歌钮、顶栏/无搜索+云端 23 首、分享口令无 :3000），其余项（粘贴口令重入同房、成员 Snackbar、保存长图）按用户决定不再补验，其中「保存长图」场景随功能删除而作废。结果修订见 [feedback-round](test-results/2026-09-24-feedback-round/README.md)。

## 本轮新增（试用反馈轮：通知栏切歌修复 + 顶栏收拢 + 口令隐端口 + 去搜索，2026-09-24 夜）

> 用户试用反馈 4 项：建议可采纳（上一首/下一首图标、去搜索、去云端测试音），Bug 必修（后台通知栏无下一首、上一首变回开头）。代码与云端已完成，真机验收待 USB 重连（设备验收时离线）。完整证据见 [feedback-round](test-results/2026-09-24-feedback-round/README.md)。

- **①顶栏收拢（MainActivity.kt TopBar）**：删除胶囊内复制图标与「房主」标注，房间码胶囊只读化（不再可点按）；操作区保留分享与退出。口令 encode 单一来源不变。
- **②上一首/下一首（修复 Bug④ + 建议②）**：`PlayerSheet` 标题行新增 48dp 上一首/下一首圆钮（房主可用，成员点按弹「只有房主可以切歌」，与歌单行为一致）；通知栏/蓝牙切歌由 `ForwardingSimpleBasePlayer` 覆写 `getState()` 追加 COMMAND_SEEK_TO_NEXT/PREVIOUS、`handleSeek` 按命令路由到 `sync/TrackQueue.skip(±1)`（环形回绕纯函数，未知当前曲目下一首取首/上一首取末，空歌单返回 null）→ 房主 `command("select")`。根因：转发器透传单条目 ExoPlayer 可用命令——无 NEXT、PREVIOUS 被 ExoPlayer 实现为 rewind，根本到不了 handleSeek（[陷阱 9.4](development-pitfalls.md)）。
- **③去搜索（MainActivity.kt + 删 PlaylistFilter.kt/PlaylistFilterTest）**：搜索框、`PlaylistFilter` 纯函数、9 项单测与长图导出的筛选词依赖整体移除，歌单恢复完整列表；「保存长图」导出全量歌单。
- **④口令隐端口（InviteCode.kt + RoomClient.kt）**：encode 剥掉约定端口 `:3000`（正则 `^(https?://[^/?#]+):3000$`），分享口令不再暴露端口号；`RoomClient.join` 在地址唯一入口对无端口 URL（okhttp 回填成 80/443）补回 3000，**显式非默认端口（如 :8080）两向原样保留**——口令省略与入房补回互为 round-trip。新增 InviteCodeTest 2 项（隐端口/保非默认端口）+ RoomClientSessionTest 1 项（explicitNonDefaultPortPreserved），既有 3 处断言改以 `:3000` 基址为准（兼作回归）。
- **⑤云端曲库去 demo-load（用户试用服务器）**：media-originals/20260924-221628/ 备份（mp3 + catalog.json.bak）→ catalog.json 24→23 → 音频移出 media/ → restart → catalog API 23 首实证 → `m4-deploy-verify.sh` **14/14**（[陷阱 8.10](development-pitfalls.md)：曲库启动时加载、改后必须重启）。
- **构建验收**：`gradlew :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug` → BUILD SUCCESSFUL；单测实跑 **74 项**（`tests=74 failures=0 errors=0`，xml 合计），Lint 0。APK SHA256 **011DD835CF111A9DB8B352E206B00A341962EC5D5722D3D8830AC54BFEF1910E**。
- **真机验收（待 USB 重连）**：通知栏上一首/下一首实际切歌、Sheet 切歌钮与成员 Snackbar、口令隐端口粘贴入房、无搜索框、云端 23 首——安装时设备离线（adb 无设备、无 mDNS 服务），装包脚本未执行成功；设备重连后按 [feedback-round](test-results/2026-09-24-feedback-round/README.md) 场景补验。

## 本轮新增（UI 重构：入口收拢 + 常驻播放器，2026-09-24 晚）

> Android 布局与组件重构轮，未改 server/、网络层与行为约定；seek 确认模型原样迁移。完整真机证据见 [ui-refresh](test-results/2026-09-24-ui-refresh/README.md)。

- **入口页（A）**：删除 primaryContainer 欢迎大卡，收拢为「文字标题区 + 单卡片表单」——分段切换/昵称/粘贴邀请/邀请码/高级设置/错误横幅/主按钮同处一张 surfaceContainer 卡；连接进度条移到卡下。
- **播放器（B1）**：`NowPlayingCard` 列表卡拆为 `ui/RoomPlayer.kt`——Scaffold bottomBar `MiniPlayer`（3dp 细进度 + 歌名/状态 + 44dp 播放键，点击展开）与 `ModalBottomSheet` 的 `PlayerSheet`（完整滑条/时间/同步说明）；`RoomPlayerState`（positionMs/dragged/pendingSeek）挂房间会话作用域，Sheet 关闭不中断快照确认与 5 秒兜底；`dragged` 从 JoinInput 迁出。
- **成员区（B2）**：默认压缩为一行 `AvatarStack`（≤5 个重叠头像 + +N 圆片，首个头像状态点不被遮挡）+「N 人一起听 · 状态」+ 箭头，整行点击展开原成员列表。
- **顶栏（B3）**：房间码 + 复制图标合并为 secondaryContainer 胶囊，点按即复制邀请口令（Snackbar 反馈），删除独立复制按钮；口令 encode 单一来源不变。
- **歌单（B4）**：当前曲目播放中行首替换为 `PlayingIndicator`（3 根错相跳动竖条）。
- **回归**：无新增纯函数逻辑（seek 确认/编解码/过滤均原样迁移），73 项单测 cleanTest 实跑全过、Lint `No issues found`；APK SHA256 **6C231394C9BD14D50CFE61D08F1513403AB32184C7E1C4CBDB836BFC192A76AC**。真机 10 项场景（两标签/校验/建房/胶囊复制/播放动效/展开页/两次 seek 确认/成员展开/退出回流）全部通过；多人堆叠、Sheet 关闭后 seek 未确认兜底、暗色对比度抽查如实标注未覆盖。

## 本轮新增（UI 试用反馈：布局、滚动与歌单长图，2026-09-24）

> Android 实现 + PHQ110 真机轮；公网歌单、滚动帧率和 PNG 导出已有实测，长截屏 OEM 入口、旧版对照与播放中听感仍待验。完整记录见 [ui-scroll](test-results/2026-09-24-ui-scroll/README.md)。

- **UI**：首页主题欢迎卡 + 创建/加入分段切换；顶栏左对齐；播放按钮移至曲名右侧、播放卡去阴影并缩小内边距；歌单间距 8dp，显示命中数量；edge-to-edge 与 560dp 限宽修正。
- **滚动开销**：隔离每 500ms 的本机进度刷新，播放器单独订阅；列表过滤按曲库/查询缓存；独立歌单行、时长文本缓存、稳定 key/contentType；保留全部 room 快照与 seek 确认信息。此为已实现的代码优化，未宣称真机卡顿已消除。
- **长图**：新增「保存长图」导出完整命中歌单为 PNG（包含屏幕外歌曲）；系统保存器选位置，后台线程绘制/编码，无存储权限；当前标记/长标题/取消和失败路径已实现。系统 Compose ScrollCapture 本就存在；ColorOS 原生长截屏入口尚未确认修复。
- **回归**：新增 ScreenStateTest 3 项（进度去重、业务状态透传、seek 快照完整性）。最终 `cleanTestDebugUnitTest + testDebugUnitTest + assembleDebug + lintDebug` 成功；**73 项实跑，0 失败/错误/跳过，Lint 0 错误 0 警告**；文档链接检查通过。APK SHA256：**B4833B95AAA278E8AFA946AB2D78786572A95A35A3622C8E704102B8FFB59431**。

## 本轮新增（UI 批次真机验收：批次 1 + 批次 2，2026-09-24 下午）

> **通过，零产品缺陷**。PHQ110（USB，serial fbddbe8）+ 本地演示后端（demo-media）+ 验收驱动 `.workbuddy/b1_driver.py`（单进程连接→装包→reverse→场景序列→导出诊断）。APK 2CBA5913…（批次 2 构建，批次 1 场景同轮重验）。完整场景矩阵与证据见 [test-results/2026-09-24-ui-batch-acceptance](test-results/2026-09-24-ui-batch-acceptance/README.md)。

- **批次 1 邀请口令闭环全过**：复制口令→Snackbar「邀请已复制，发给朋友即可」；「粘贴邀请」→确认卡（房间码+服务器地址，快照断言）；确认卡→「加入，一起听」→重入同房（room=3C67DD61 与口令一致，页面以顶栏「退出房间」图标为房间页标志、排除确认卡同码假阳性）；口令地址≠已记住地址→Info 提示且以口令地址入房；join 失败（手填不存在房间码）→错误横幅**「房间不存在或已过期」**、横幅优先于确认卡、已填昵称保留。
- **批次 2 全过**：展开成员显示头像首字符'B'+'B1'+'房主 · 在线'（文字行并存不单靠颜色）；搜索'192'→列表仅剩 192kbps 行（'45 秒'行消失）、无命中显示「没有匹配的歌曲」、清除恢复全列表；选歌切换当前歌曲为「合成长测试音 · 40 分钟」。
- **播放与 E-07 回归（批次 2 动了 MainActivity 后必做）**：40 分钟曲 PLAYING；拖回开头 20794ms→6125ms；诊断 playback=196、correction **seek=1**（恰为主动拖动一次）、速率中位 **995ms/s=1.0x**；手填 join 对照组同步通过。
- **自动化边界（如实标注，三项待人工）**：智能识别（整段口令粘进邀请码框）——adb 无法向 Compose 字段注入中文剪贴板（keyevent 279 / Ctrl+V 均未生效）；busy 禁用——本地 reverse 下 join 时序过短无法稳定断言；系统分享面板实际弹出——需拉起外部 chooser。口令文本本身已由 encode 单测 + 复制路径旁证。
- **验收过程发现并修复的驱动侧问题（非产品缺陷，已回填[陷阱 2.11](development-pitfalls.md)）**：ColorOS 输入法对 uiautomator 不可见且 keyevent 111 不收起，底部区域 tap 全被拦截（keyevent 4 解法）；LazyColumn 未组合行不在 dump（滚动查找）；服务端房间回收后的僵尸会话（先看 /health 再操作）；播放动画期 dump 失败须重试。期间 0 处产品代码改动。

## 本轮新增（批次 2：成员可视化 + 歌单搜索，2026-09-24）

> Android 客户端轮：只改 `android/app` 与文档，未动 server/、未引入新依赖、未部署、未做 git 提交、未执行 adb/真机操作（设备正被并行验收占用）。**真机目视验收已于同日通过**（成员头像/搜索过滤/占位/清除/选歌，见 [test-results/2026-09-24-ui-batch-acceptance](test-results/2026-09-24-ui-batch-acceptance/README.md)）。

- **成员状态可视化（新增 `app/src/main/java/com/listentogether/app/ui/MemberAvatar.kt` + MainActivity.kt MembersSection 改造）**：成员行新增圆形头像——昵称首字符（空白兜底「友」），背景从主题派生的 6 色固定色板（primary/secondary/tertiary 及各自 container，配对对应 on 色）按 memberId 稳定散列（`avatarPaletteIndex(memberId, paletteSize)` 纯函数，`hash * 31 + code` 折叠 + `mod`）取索引，同一成员颜色恒定，无硬编码色值，亮暗方案自动跟随。头像右下角 10dp 在线状态点：在线 colorScheme.primary、离线 colorScheme.outline，surface 色 1.5dp 描边保证任意底色上可见。「房主 · 在线/离线」文字行保留，不单靠颜色传达状态；折叠/展开结构与「N 人一起听」摘要不变。实现收敛在独立小文件，避免 MainActivity 继续膨胀。
- **歌单搜索（新增 `app/src/main/java/com/listentogether/app/ui/PlaylistFilter.kt` + MainActivity.kt PlaylistSection 改造）**：歌单区顶部新增 OutlinedTextField——单行、FieldShape、leading 图标 Icons.Outlined.Search、非空时 trailing 清除按钮 Icons.Outlined.Close（contentDescription「清除搜索」）、placeholder「搜索歌曲」。过滤逻辑抽为纯函数 `PlaylistFilter.filter(titles, query): List<Int>`（返回命中原索引，保持原顺序）：查询串首尾 trim、空查询返回全部、大小写不敏感、子串包含匹配（中文直接匹配）。过滤后为空显示「没有匹配的歌曲」；当前播放项按原索引对齐，高亮在过滤结果中依然生效；搜索词存于 `PlaylistSearch`（按房间会话 remember，退出重进自动重置），只影响本地显示，不触碰播放与服务器状态；清空或退出恢复完整列表。曲库为空时仍显示原提示，不显示搜索框。
- **新增 9 项 JVM 单测**：PlaylistFilterTest 6 项（空查询全返回、大小写不敏感、trim、无命中返回空、中部子串命中、中文曲名匹配）+ AvatarPaletteIndexTest 3 项（同 id 恒定同色、任意 id/色板大小索引在界内、不同 id 允许分布）。
- **构建验收**：`.\gradlew.bat :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug --console=plain` → **BUILD SUCCESSFUL in 1m 54s**；单测实跑 **70 项（61 基线 + 9 新增），0 失败 0 错误 0 跳过**（`build/test-results/testDebugUnitTest/*.xml` 合计 `tests=70 failures=0 errors=0 skipped=0`；`> Task :app:testDebugUnitTest` 实跑，不带 UP-TO-DATE）；Lint **0 错误 0 警告**。
- **APK SHA256**：**2CBA59132F8103C9AB450CA627A61A1A2AC95F6708E7C55422E73111AB427E73**（app-debug.apk，本轮 15:22 重建）。
- **边界与自查修正**：首轮构建暴露 PlaylistFilterTest 一处断言错误（「loving you」不含子串「love」，测试预期自身写错，非实现缺陷），修正预期后全绿；初次全量重跑 BUILD FAILED 后修正，最终结果以上述最终一轮实跑为准。未改 server/、未部署、未执行 adb、未做 git 提交。

## 本轮新增（批次 1：邀请口令闭环，2026-09-24）

> Android 客户端轮：只改 `android/app` 与文档，未动 server/、未部署、未做 git 提交。**真机验收已于同日通过**（复制→粘贴闭环/失败路径/地址不一致提示，见 [test-results/2026-09-24-ui-batch-acceptance](test-results/2026-09-24-ui-batch-acceptance/README.md)）；智能识别、busy 禁用、分享面板弹出三项自动化未能模拟，标注人工验证。

- **InviteCode 编解码（新增 `app/src/main/java/com/listentogether/app/InviteCode.kt`）**：encode 产出四行纯文本口令（来一起听歌 / 房间码 X / 服务器 URL / 复制整段，打开 App 即可加入），地址为空时省略服务器行；decode 用锚点正则（`(?:房间码|邀请码)[^0-9A-Za-z]*([0-9A-Fa-f]{8})` 与 `(https?://…)`）容错解析，容忍微信/QQ 加引号、前后闲聊行、全角冒号、hex 大小写混用，两行均在全文任意位置匹配、不做宽松匹配；房间码必得（大写归一），服务器可空=缺地址降级沿用已存地址；失败返回 null 不抛异常。口令只含房间码与服务器地址（公开信息），**绝不包含成员令牌**。
- **顶栏复制/分享改造（MainActivity.kt）**：复制改为完整口令，Snackbar「邀请已复制，发给朋友即可」；分享 EXTRA_TEXT 与复制共用同一 encode 来源（`inviteText` 单点生成，无两处硬编码）；chooser 标题「分享邀请」。
- **加入 Tab（MainActivity.kt）**：邀请码输入框上方新增「粘贴邀请」FilledTonalButton（ContentPaste 20dp + 文字、高 40dp、PillShape、fillMaxWidth、与输入框间距 8dp）；onClick 只读一次剪贴板并 decode（Android 13+ 系统自带"已粘贴"提示，App 不重复告知）；解析成功 → 表单被口令接管（房间码替换为 8 位码、地址字段填入口令值）并显示邀请确认卡——Surface surfaceVariant + BannerShape、padding 14dp，房间码 titleMedium 等宽、地址 bodySmall 次级色、「重新输入」TextButton 拆卡回手填；口令地址≠已记住地址时 Info 图标 20dp + 「将使用邀请中的服务器地址」（不阻断，入房以口令地址为准）；确认卡容器 liveRegion=Polite。解析失败 → Snackbar「未识别到有效邀请，请复制完整邀请后重试」，表单不动。智能识别兜底：邀请码框文本 >8 字符且含「房间码」锚点时尝试 decode，成功接管表单、失败保留用户输入。确认卡与 join 错误横幅互斥展示（失败优先横幅，确认卡数据与已填昵称保留）；busy 时粘贴/重新输入禁用。
- **InviteCodeTest（新增，8 项 JVM 单测）**：encode 四行格式、无地址省略服务器行、encode/decode 往返、引号+闲聊行容错、全角冒号+大小写混用、仅房间码 server=null、无锚点失败（含裸 8 位码不认）、不足 8 位失败。
- **构建验收**：`.\gradlew.bat :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug --console=plain` → **BUILD SUCCESSFUL in 3m 49s**；单测实跑 **61 项（53+8），0 失败 0 错误 0 跳过**（`build/test-results/testDebugUnitTest/*.xml` mtime 为本轮 14:51，合计 `tests=61 skipped=0 failures=0 errors=0`，其中 InviteCodeTest 8/8；`> Task :app:testDebugUnitTest` 不带 UP-TO-DATE）；Lint **0 错误 0 警告**（仅既有的 Information 级 AutoboxingStateCreation 提示，非本轮引入）。
- **APK SHA256**：**BF393FB4801BF907E390A6694E3FE56D9BE54A326E7E0E9176F9141738D5A967**（app-debug.apk，本轮 14:51 重建）。
- **边界与自查修正**：定稿方案写的 TonalButton 在项目锁定的 material3 1.3.x 稳定版不存在（该 API 1.4-alpha 才引入，首轮编译即失败并暴露），改用同语义稳定版 **FilledTonalButton**，无新依赖；「确认卡与错误横幅互斥」落地为错误横幅优先、确认卡在其存在期间回退为手填输入框（数据保留、手动编辑即拆卡）。emoji 扫描 `grep -rP '[\x{1F300}-\x{1F9FF}…]'` 零匹配；未改 server/、未部署、设备离线未做真机操作、未做 git 提交。

## 本轮新增（长时 + 多人组合真机测试：M3-LONG 复活，2026-09-24）

> **通过**。真实音乐（非测试音）顺播 70 分钟 + 息屏 30 分钟 + 多人动态进出（最高 5 人在线）+ 房主转移，全部达成。完整方案、判定与数据见 [test-results/2026-09-24-long-multiplayer](test-results/2026-09-24-long-multiplayer/README.md)。

- **长时**：真实歌单顺播 70 分钟（T0=11:03→12:13）零中断；诊断 4988 条（**seek=1**（仅 E-07 主动拖动）/ speed=82（省电变速追赶，设计内）/ buffering=46）；自动顺切 20 首（诊断窗口内 14 首全成功）；主测 WS 70 分钟单次连接（蜂窝）。
- **息屏**：11:19→11:49 整 30 分钟 Dozing，全程 PLAYING、息屏中切歌 3 次、位置速率 ≈1.0x；定时解锁后播放无缝。
- **多人**：最高 5 人在线、加入/退出全程服务器事件记录（joined×11 / left×7 / removed×4）、error=0；E-05/E-09 防线对真实用户零误伤。
- **房主转移**：主测退出瞬间转移给在线成员、新房主切歌立即生效；主测重入 5 秒内追上；**无主房间边界**——hostId 清空后 tick 自动授予下一个在线成员房主（修正"永久无主"初判）。
- **交互对账**：E-07 拖回开头生效（全场唯一 seek）、暂停/恢复服务器快照逐位一致。
- **边界**：非房主切歌被拒 / 成员本地暂停互不影响未覆盖（参与者中途全部离场）；诊断仅前 60 分钟（窗口上限，如期兑现）；听感为主观确认；结论只对参与设备与本网络条件。曲库同步扩充至 24 首真实音乐（96.5 分钟，192k，demo-load 挪至末尾）。

## 本轮新增（后端防线上云：release 20260924-0937，2026-09-24 上午）

> C1 时间片 09:35 声明 → 收尾释放。完整操作序列、实测数据与边界见 [test-results/2026-09-24-backend-deploy](test-results/2026-09-24-backend-deploy/README.md)。

- **升级成功**：`package-deploy.ps1` 打包（tsc 0 错误、11.4MB、LF 清单）→ scp 上传 → `releases/20260924-0937` 解包 → **sha256sum 42/42 OK** → listen 账号 npm ci / npm run build（BUILD-EXIT=0）/ prune 三关全过 → **`current-version.txt` 成对写入 id=20260924-0937 / prev=20260922-2159** → `ln -sfn` → restart。health 第 2 秒返回 **`{"ok":true,"rooms":0,"onlineMembers":0,"wsConnections":0}`**（新计数字段生效即新代码在跑的直接证据）；MainPID 16099→20210、NRestarts=0、WorkingDirectory 不变。
- **基线 → 升级对比**：旧版本 14 项脚本 pass=13 fail=0（第 1 项 health 计数按设计 SKIP）；新版本 **pass=14 fail=0**（health 字段解析与配额预检均实 PASS）。仪表先在已知良好版本上验证，升级后的失败才可归因。
- **新防线公网验证**：**E-05** 同令牌握手 `open×5 → http429`（10 秒窗口 5 次额度，第 6 次拒绝）；**E-09** 建房序列 `200,200,429,429`、终态 rooms=3——即"起始 1 间（14 项脚本残留）再建 2 间到顶、第 3 次起 429"的精确行为（验证脚本打印 FAIL 系自身 expectBase 参数漏算残留房间，非防线缺陷，行为数据完整）；**Q-3** 事件通道 journal 实证 `room.created×3 / member.joined×3 / member.online×6 / host.transferred / member.removed×2 / ws.handshake_rejected×1`，无令牌字段；6 分钟窗口 error/unhandled 计数 **0**。
- **回滚预案**：prev=20260922-2159 真实存在未动用。本次升级与在产版本存在**实质代码差异**，覆盖了 W3 演练"同代码新 ID"未能证明的"新代码上线"路径；升级失败注入仍未做（同 W3 边界）。
- **边界**：APK E814F90E 真机验收仍待设备在线（本轮验证覆盖服务端与公网 HTTP/WS 层）；测试房间占用同 IP 配额约 5 分钟后自动回收（终态复核见下）；出网流量仅几 KB。

## 本轮新增（工具与文档轮：门禁强制实跑 Q-2 / 明文边界 E-06 / 协议契约 A-02 轻量版，2026-09-24）

> **纯工具与文档轮**：只改 `scripts/check.ps1`、文档与一个测试文件，**未改任何产品代码、未部署、未重建 APK，无新 hash**（锚仍为 E814F90E…）。

- **[Q-2] 门禁强制实跑**：`scripts/check.ps1` 安卓段由 `:app:testDebugUnitTest` 改为 `:app:cleanTestDebugUnitTest :app:testDebugUnitTest`。此前 Gradle 增量构建会把输入未变的测试任务判为 `UP-TO-DATE` **并跳过实跑**，门禁报"通过"其实只是上一轮的结论（历史记录里已出现过"45 项 UP-TO-DATE"这种写法）。清理该变体测试任务的输出后再执行，测试必然本轮重跑；只删 `build/test-results`、`build/reports` 对应目录，**不触发重新编译与重新打包**（APK 不变）。已在 AGENTS.md 的常用命令同步。顺带按[陷阱 1.5/1.6](development-pitfalls.md) 改造 `Invoke-CheckedCommand`：调用原生命令期间把 `$ErrorActionPreference` 收窄为 Continue 并在 `finally` 恢复，成败只认 `$LASTEXITCODE`（旧写法在 EAP=Stop 下会把 gradle/npm 的任意一行 stderr 变成终止错误）。
- **[E-06] 明文边界写进 README「行为约定」**：新增一条——试用期内入口是 `http://8.166.126.136:3000` 明文 HTTP，Bearer 令牌在链路上可被窃听，服务端**没有令牌撤销机制**（令牌只在内存里，重新入房换新令牌，旧令牌随成员离线 60 秒清理 / 房间空置 5 分钟删除而失效），正式使用必须先换 TLS + 域名。措辞与既有路线 A 决策一致，未新增任何承诺。
- **[A-02 轻量版] 协议单一出处可执行化**：`docs/protocol.md` 追加「JSON Schema（v1 消息契约）」小节，覆盖 `state` 快照与 `sync`/`command`/`clock`/`error` 五类消息；新增 `server/test/protocol.test.ts`（2 项）**直接从该文档提取 schema**，校验 `buildApp` 产出的真实消息（WS 收到的 state/clock/error、直接取样的快照、出站 sync/command）与 `members[]` 形态。`additionalProperties:false` 保证实现新增/改名字段而文档漏改也会失败；另有一项用构造性漂移（多字段/缺字段/类型错/未知 action/越界 status）证明校验器有牙，避免"schema 被掏空后测试恒绿"。校验器为 `server/test/mini-schema.ts` 的最小实现（约 80 行，支持 `$ref/type/const/enum/required/properties/additionalProperties/items/minLength/maxLength/minimum/maximum/maxItems/pattern/oneOf`）——**无 codegen、无运行时依赖**。
- **本地验证结果**：后端 `npm run build`（tsc 0 错误）+ `npm test` **20/20 通过**（18 + 2）；反向确认——给 `snapshot()` 临时塞一个文档未定义字段，protocol.test.ts 立刻失败，撤回后恢复全绿；`scripts/check.ps1 -Scope all` 全过（后端 20/20；安卓 `:app:cleanTestDebugUnitTest :app:testDebugUnitTest` **本轮实跑 53 项**，`build/test-results/testDebugUnitTest/*.xml` 的 mtime 为本次、`tests=53 skipped=0 failures=0 errors=0`，日志中 test 任务不再是 UP-TO-DATE；assembleDebug/packageDebug 仍 UP-TO-DATE，**APK SHA256 与上轮一致 E814F90E…**；lintDebug 通过；Markdown 链接检查通过）。**实跑可重复**：紧接着单独复跑一次 `-Scope android`，两次都是 `3 executed, 51 up-to-date`（cleanTest / test / lint），结果 XML 时间戳随每次刷新——不是一次性的假象。外部日志用 `*>&1 | Out-File` 采集也不再触发[陷阱 1.5](development-pitfalls.md) 的空消息异常（EAP 已在脚本内收窄）；只有 node.exe 的中文输出在 PS 5.1 日志里仍会乱码（陷阱 1.3），判成败一律看退出码。
- **边界**：本轮**未部署云端、未跑真机**；E-06 只是把既有的明文约束写进行为约定，不代表入口或 TLS 方案有任何变化。

## 本轮新增（后端防线 E-05/E-09 + 排障通道 Q-3 + 防线回归 Q-4/Q-5，2026-09-24）

> 本轮只动后端（server/src、server/test）、验收入口脚本与文档：**未改 Android 代码、未重建 APK**，APK 锚仍为 E814F90E…。

- **[E-05] WS 握手限连**：`/ws/:code` 在鉴权通过后按"成员令牌 + 来源 IP"做固定窗口计数，10 秒内最多 5 次升级请求，超出返回 HTTP 429「连接过于频繁，请稍后重试」拒绝升级；无效令牌仍是 401 且不占额度。阈值 5 高于客户端 1/2/4/8/16 秒退避重连节奏（任一 10 秒窗口最多 4 次），正常断线重连不受影响；并已核对客户端侧行为——`RoomClient.onFailure` 只把 401/404 判为终态，**429 走非终态 → Reconnecting 退避重试**，不会误判成 Expired。实现为单进程内存 Map（`realtime/limits.ts`，无新依赖；键数上限 4096，超限淘汰最旧键，内存有界）。**消息级 20 条/秒限频未改动**。
- **[E-09] 建房存量配额**：Room 新增 `creatorIp`（取 `req.ip`，trustProxy 仅信任回环、直连不可伪造），**同 IP 活跃房间 ≤3**，第 4 间返回 429「同一来源最多同时创建 3 个房间，请先使用已有房间」；空房 5 分钟回收的语义不变，回收即释放配额（不按历史累计）。与路由既有的每 IP 30 次/分钟限速是两道独立防线（限速不限量 → 现在也限量）。
- **[Q-3] 排障通道**：结构化事件日志覆盖 `room.created`/`room.deleted`、`host.transferred`、`member.joined`/`online`/`offline`/`left`/`removed`、`ws.handshake_rejected`，字段只含房间码、成员 ID、来源 IP，**不含 Authorization、成员令牌与昵称**（有单测红线）；`/health` 追加 `rooms`/`onlineMembers`/`wsConnections` 只读计数，保留 `{ok:true}` 兼容现有探活。生产日志（logger=true）实测形如 `{"level":30,...,"event":"member.online","code":"39294E55","memberId":"...","msg":"member.online"}`。
- **[Q-4/Q-5] 防线回归**：后端测试 **7 → 18 项**。新增：曲库拒绝 `../` 逃逸与指向库外的目录链接（含"库内链接仍可加载"对照）、WS 同连接第 21 条消息/秒收 429 error 帧、bufferedAmount 超 128KiB 时 `close(1013)`、15 秒无 pong 才 terminate（假 timer 注入）、握手限连 3 例（超限 429 / 换源 IP 不受影响 / 无效令牌仍 401）、建房配额 2 例（回收释放、按 IP 隔离）、事件红线与 health 计数。**既有 7 项全部未回归**。为可测性把发送与心跳抽成 `createSender`/`startHeartbeat`（socket 面与 timer 可注入），生产行为不变。
- **本地验证结果**：`npm run build`（tsc 0 错误）+ `npm test` **18/18 通过**；`scripts/check.ps1 -Scope server` 全过；另起真实后端冒烟：同令牌连续握手 `open,open,open,open,429`、同 IP 第 4 次建房 429、`wsConnections` 随连接 0→1→0、事件日志中无令牌。限流用例做过反向确认（把限流阈值放大后该用例立刻失败），证明它真的钉住防线而不是恒真。
- **⚠️ 本地通过 ≠ 云端生效**：以上三处修复要真正生效，必须把新版本部署到 8.166.126.136。**本轮未部署**——部署需要独占云端时间片，且 `systemctl restart` 会清空全部内存房间，执行前必须确认无活跃房间（[deployment.md 第 5 节](deployment.md)；现在可直接读 `/health` 的 `rooms/onlineMembers/wsConnections` 三个计数）。未做的还有：云端复跑 14 项服务端验证、升级/回滚演练、真机回归。
- **验收入口同步**：`m4-deploy-verify.sh` 由 13 项增至 **14 项**——health 改为按字段解析（旧版本无计数时 SKIP、不计失败），并在建房前用 `rooms` 计数做存量配额预检，避免连续重跑第 4 次被 429 误判为新版本缺陷（见[陷阱 8.9](development-pitfalls.md)）。该脚本**未在云端执行**。

## 本轮新增（客户端缺陷修复 A-01/E-07 + 诊断测试 Q-1，2026-09-24）


- **[A-01] PlaybackService 会话代次守卫**：applyState 入口、onPlayerError、500ms 位置上报循环、onPlayWhenReadyChanged（焦点/耳机）四处加 `client.sessionGeneration != boundGeneration` 守卫。旧服务实例退出/换房间后不再向新会话上报位置、load/seek 播放器（双播放器竞态消除）、误标 locallyPaused。applyState 入口守卫触发时 pause + stopSelf，循环守卫触发时 stopSelf + break，不让服务僵住。行为约定不变。
- **[E-07] seek 乐观预览确认条件过松**：播放中分支 `positionMs >= target - 1500` 在 `target ≤ 1500ms` 时对任意非负位置恒真（seek 指令丢失也显示成功）。改用相对推进量确认——记录发起 seek 时刻 `pendingSeekTimeMs`，容忍窗口 = 确认以来经过的时长 + 固定余量（1500ms 含 RTT 补偿），即 `abs(snapshot.positionMs - target) <= elapsed + 1500`。拖回开头等低 target 场景下，确认需快照位置确实接近 0。5 秒未确认提示兜底不变。
- **[Q-1] DiagnosticsLogTest（8 项 JVM 单测）**：覆盖 20MB 轮转停止、60 分钟窗口停止、JSONL 行格式（type/wallClockMs/monotonicMs/deviceLabel 必有字段）、令牌不出现在输出（红线约束：无 Bearer/Authorization/token 文本与 JSON 键）、禁用时不创建文件。DiagnosticsLog 重构为内部构造器注入时钟/目录/执行器，生产入口不变。
- **构建验收**：`gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug` 全过——53 项单测（+8 新增）、BUILD SUCCESSFUL、Lint 0 错误 0 警告。APK SHA256 **E814F90E…**。`check-doc-links.mjs` 通过。
- **真机验收显式标注待设备在线**：分级纠正回归（A-01 代次守卫后旧实例 stopSelf，新实例由系统重建）+ "拖回开头" seek 确认场景（E-07 修复后 target=0 不再恒确认），不得记为通过。

## 本轮新增（文档结构优化，2026-09-24）

- **verification.md 重建**：33 个按时间平铺的历史小节压缩为「交付历史索引」与「APK 版本历史」两张表；每轮完整证据仍在 docs/test-results/ 与归档文档中，索引行给出链接。修正过时表述（如「本轮尚未部署到云端」）。
- **计划文档收敛**：execution-plan.md 删除——M3-LONG 执行要点并入 [路线图](next-development-plan.md)，验收报告字段规范并入 [开发规范](development-standards.md)；learning.md（关键代码阅读顺序）并入 [模块索引](modules/README.md)。
- **一次性文档归档**：handover-2026-09-23.md（W1/W2 交接单，使命完结）与 playback-test-2026-09-21.md（早期播放测试）移入 [docs/archive/](archive/)，内容未删改。
- **parallel-development-plan.md 压缩**：W1–W4 已完成工作流的任务定义删除，保留完成摘要与证据链接；W5–W7、C1–C8 协调规则保留。
- 本轮为纯文档重构：未改产品代码、未重建 APK（锚 36BD3A5B… 不变）；`scripts/check-doc-links.mjs` 全量通过。

## 本轮新增（收尾汇总：全量回归 + 文档一致性 + 入口快照，2026-09-24）

> 收尾会话：不改产品代码、不动服务器；对 W1–W4 并行交付做统一回归、一致性核对与入口同步。

- **全量回归通过**（scripts/check.ps1 -Scope all）：后端 tsc 0 错误 + **7/7 测试**；安卓 testDebugUnitTest（输入未变 UP-TO-DATE，**45 项**）+ assembleDebug + lintDebug 通过（BUILD SUCCESSFUL 52s，**Lint 0 错误 0 警告**）；Markdown 本地链接检查通过。
- **APK hash 不变声明**：本轮未改产品代码、未重建 APK，锚定 36BD3A5B…；全量检索核对无并行会话引入新 hash。
- **文档一致性核对与最小合并**：「尚待验收」清单勾选与正文逐条核对一致；唯一矛盾——LOAD-15 条目（2026-09-22 行）尾巴"云端 TLS/公网重测仍属 M4 门槛"已被云端通过推翻，已就地更正。
- **入口快照同步**：AGENTS.md 快照更新为"2026-09-24 收尾确认"；parallel-development-plan.md W1/W2 标注完成（W3/W4 此前已标），T1/T2 清零；同文两处过时口径一并更正（LOAD-15 云端流量 2.2GB 估算→实测 ≈235MB/轮；"36BD3A5B 未真机验收"→已验收）。
- **工作区清理**：交接单第七节临时产物已删除（tmp-diag-*.jsonl ×4、services-dump.txt、flinger-a.txt、storm-window.txt、sync-offsets.txt，共 8 个）。
- 本轮边界：纯收尾交付——未执行真机/云端测试，未改任何产品代码、脚本与服务器状态。

## 交付历史索引（0.2.0 开发以来，新→旧）

| 日期 | 交付 | 结果 / 关键数据 | 详细记录 |
|---|---|---|---|
| 09-25 深夜 → 09-26 凌晨 | 夜轮装机验收 + 界面提示精简 | 补跑门禁（首轮 Lint 报 `CAMERA` 缺 `uses-feature`）→ 86 项实跑、Lint 0；`9C480583` + R8 `08607981` 装机回拉一致；6 项真机场景通过（预填/跨重建/重新加入/回收失败/二维码反解/HTTP 放行）；**歌单滑动 A/B：R8 0.77%/0.16% vs debug 7.66%/2.08%**，debug 口径的 27.27% 不代表用户构建；按用户指示删除播放状态文案与同步说明 → 终稿 `BCF3DE16`/`9E17F291`（84 项、Lint 0、**未装机**）；扫码/双人/大字号等未覆盖项如实标注 | [night-acceptance](test-results/2026-09-25-night-acceptance/README.md)、本轮（见上节） |
| 09-25 下午 | 0.3.0 批次 A 真机验收 | PHQ110/Android 14/云端：6 项场景通过（动态流含 60 秒移除抑制、伪封面与展开页、跟随滚动、头像 emoji 持久化、暗色可读；触感标人工）；真机抓到并修复展开页半屏回归；新增 `scripts/member-sim.mjs`；装机 hash 复核一致；APK **D882D186** | [device-batch-a](test-results/2026-09-25-device-batch-a/README.md) |
| 09-25 | 0.3.0 批次 A 一起听体验轮 | 房间动态流（快照差分 + everOnline 修正）+ 伪封面 + 歌单跟随 + 触感/无障碍 + 头像 emoji（全部客户端、零协议改动）；**独立复核 9 项修正**（含既有 RoomPlayerState 跨房间复用缺陷）；单测 74→**100** cleanTest 实跑全过、Lint issues=0；APK F5827821（复核稿）→ 当天下午真机验收并修复展开页半屏回归 → **D882D186**（见上一行） | 本轮（见上节）、[模块 01](modules/01-android-ui.md) |
| 09-24 夜 | 试用反馈轮 | 通知栏/展开页上一首下一首（TrackQueue 环形回绕）+ 顶栏只读胶囊 + 口令隐 :3000 round-trip + 去搜索；云端 23 首（demo-load 移除、14/14）；74 项单测、Lint 0；APK 011DD835 | [feedback-round](test-results/2026-09-24-feedback-round/README.md)、本轮（见上节） |
| 09-24 晚 | UI 重构轮（入口收拢+常驻播放器） | 单卡片表单/MiniPlayer+PlayerSheet/头像堆叠/码胶囊复制/当前曲动效；73 项单测实跑、Lint 0；APK 6C231394；真机 10 项场景通过 | [ui-refresh](test-results/2026-09-24-ui-refresh/README.md)、本轮（见上节） |
| 09-24 | 工具与文档轮 | Q-2 门禁强制实跑（cleanTest，可重复）+ E-06 明文边界入 README + A-02 协议 schema 契约；后端测试 20/20；纯工具/文档轮、**无新 hash** | 本轮（见上节） |
| 09-24 | 后端防线本地交付 | E-05 握手限连 + E-09 同 IP 建房配额 + Q-3 事件日志/health 计数；测试 7→18 全过；**未部署上云** | 本轮（见上节） |
| 09-24 | 文档结构优化 | 本轮（见上节） | — |
| 09-24 | 收尾汇总 | check.ps1 全过（后端 7/7+安卓 45+Lint 0+链接）；W1–W4 标注完成；清理临时产物 | commit 0a8724a |
| 09-23 晚 | W4 · LOAD-15 云端重测 | 15 路×600s 公网直连全 206 零失败、2.847Mbps=基线 99.1%；出网约 235MB/轮（旧估算 2.2GB 高一个数量级）；demo-load 上云保留 | [load15-cloud](test-results/2026-09-23-load15-cloud/README.md) |
| 09-23 晚 | W3 · 升级/回滚演练 | 升级到 20260923-2157 → 真实回滚到 20260922-2159 双向通过；PID 4191→14935→15175；13 项抽查三次各 13/0；restart 清空内存房间已实证；CRLF 清单与硬编码曲目两坑回填 | [m4-rollback-drill](test-results/2026-09-23-m4-rollback-drill/README.md) |
| 09-23 晚 | W1+W2 真机轨道 | W1：先纠正装机偏差（设备实为 169018AE→重装 36BD3A5B 回拉锚定）；关省电 180s 位置 1.001x 且 `seek=0`、开省电 `speed` 追赶 9 条、自动切歌零 seek、端点 14dp 圆点/5dp 轨道、暗色冷启动无白闪、听感用户确认。W2：同一 APK 公网七步全链路（version 2→9）、RTT 中位 65ms、第二房间复测通过 | [w1-recheck](test-results/2026-09-23-w1-recheck/README.md)、[m4-public-e2e](test-results/2026-09-23-m4-public-e2e/README.md) |
| 09-23 晚 | 并行开发推进方案 | 待办组织为 W1–W7 + C1–C8 冲突协调；真机轨道∥云端轨道 | [parallel-development-plan.md](parallel-development-plan.md) |
| 09-23 傍晚 | TLS/域名检查→路线 A | 备案拦截按域名（Host/SNI）跨任意端口生效（8443 对照实验推翻"非标端口可用"）；试用 ECS 无法备案；LE 不签裸 IP；用户决策维持 `http://8.166.126.136:3000` 明文 | [陷阱 8.6](development-pitfalls.md) |
| 09-23 傍晚 | 卡顿修复+进度条端点 | 根因=省电降频致渲染 underrun→每 5 秒 seek 风暴（0.86x 漂移）；分级纠正（500ms–2.5s 变速追赶、>2.5s 才 seek）+SmoothRenderers 0.7s 缓冲+每秒自检；进度条 14dp 圆点手柄；单测 45；APK 36BD3A5B | [交接单（归档）](archive/handover-2026-09-23.md)、[同步模块](modules/04-synchronization.md)、陷阱 9.1 |
| 09-23 中午 | 曲库工具链+全量转码 | add-media.ps1+media-manage.sh；云端 5 首 320k→192k（47.2→31.6MiB，-33%）；EAP=Stop 吞 stderr 警告坑回填 | [deployment.md 第 6 节](deployment.md) |
| 09-23 上午 | UI 优化真机验证 | 地址折叠/退出确认/返回 Toast 等目视通过（APK 169018AE）；Toast 不进 dump 等坑回填 | [ui-optimize](test-results/2026-09-23-ui-optimize/README.md) |
| 09-23 凌晨 | UI 系统评审+优化批次 | 2 致命/8 重要/7 建议分级清单，落地 12 项；APK 169018AE；单测 42 | [ui-refresh](test-results/2026-09-23-ui-refresh/README.md) |
| 09-23 凌晨 | 公网超时定位 | VS Code Remote 常驻会话三次触发全局 OOM→整机冻结（全端口超时的真面目）；服务本身 NRestarts=0；严禁服务器跑重负载 | [陷阱 8.5](development-pitfalls.md) |
| 09-23 | 简洁 UI 重构 | 首页 Tab/单主按钮/轻量歌单；APK 59773A08；本地 reverse 真机通过（公网因 OOM 超时未测） | [ui-refresh](test-results/2026-09-23-ui-refresh/README.md) |
| 09-22 深夜 | 图标+公网链路 | 图标 BE545EEF 装机；真机 curl 公网 200 首个数据点；E2E 自动化 6 连败暂停（陷阱 3.4） | [m4-public-test](test-results/2026-09-22-m4-public-test/README.md) |
| 09-22 深夜 | 公网开启+真实曲库 | HOST 0.0.0.0（安全组放行后真机可达）；云端曲库换 5 首真实 MP3 | — |
| 09-22 深夜 | M4 首次部署 | Node 24/listen 账号/releases+符号链接；服务端 13/13+SSH 隧道 9/9；个人音频误打包纠偏 | [m4-first-deploy](test-results/2026-09-22-m4-first-deploy/README.md) |
| 09-22 晚 | M3-AUTH 横幅复验通过 | 832FB65E 回拉一致；401 文案 5/5、"已同步"0/5（校时不覆盖暂停修复成立）；挂起项关闭 | [m3-auth-recheck](test-results/2026-09-22-m3-auth-recheck/README.md) |
| 09-22 晚 | M4 盘点+部署准备 | SSH 打通（authorized_keys 未写入所致）；服务器 1.7Gi 无 swap、Node 未装；package-deploy.ps1 实跑 | [m4-inventory](test-results/2026-09-22-m4-inventory/README.md) |
| 09-22 | 无线调试通道打通 | connect-wireless.ps1 一体化 connect+reverse+自检；无线 reverse 完全可用实锤 | 陷阱 2.7 |
| 09-22 | 架构文档+UI 交互修补 | [architecture.md](architecture.md)（分层/依赖/数据流/不变式）；imePadding/Snackbar/退出快捷键/滑块禁用说明；APK 5DA5082A | — |
| 09-22 | M3-LONG 物料+检查入口 | check.ps1/check-doc-links.mjs；demo-hour 70 分钟测试音+m3long-sample.ps1（真机执行仍挂起）；单测 32 | — |
| 09-22 | M3-FOCUS 音频焦点 | 抢占/来电本机暂停 ≤300ms、无自动恢复、明确点击续播；localPause 边沿诊断修复 | [m3-focus](test-results/2026-09-22-m3-focus/README.md) |
| 09-22 | M3-AUTH+LOAD-15 本地 | audio401 注入自测 10 项；真机 401 四次即停（8CF98CE1）；15 路本地 600s 2.873Mbps；负载成员必须持 WS 坑回填 | [m3-auth](test-results/2026-09-22-m3-auth/README.md)、[load15](test-results/2026-09-22-load15/README.md) |
| 09-22 | M3 稳定性批次 | 通知栏实际点击走服务端 pause；息屏 75s；蓝牙断开本机暂停；404→暂停→恢复续播 | [m3-notification-device](test-results/2026-09-22-m3-notification-device/README.md)、[m3-bluetooth-audio-error](test-results/2026-09-22-m3-bluetooth-audio-error/README.md) |
| 09-21 | 界面重构+拖动修复 | M3 Google 蓝 UI；乐观预览修复拖动回跳；开发陷阱清单建档 | [播放测试（归档）](archive/playback-test-2026-09-21.md) |
| 09-21 | M1 真机复测+故障注入 | 重连→404→Expired 全链路；300ms 延迟保持 Ready；12s 断线自动恢复；超宽限真实 Expired | [m1-session-device](test-results/2026-09-21-m1-session-device/README.md)、[m1-fault-proxy](test-results/2026-09-21-m1-fault-proxy/README.md) |
| 09-21 | M1 会话加固 | SessionContext/状态机/ClockEstimator/诊断 JSONL/可注入传输层；单测 21 | 同上 |
| 09-21 前 | 0.2.0 基线 | SDK35/JDK17 构建打通；音频焦点误恢复修复；应用图标；demo-media；build/start/install/smoke 脚本 | git 历史 |

## APK 版本历史（新→旧）

| SHA256 | 日期 | 内容 | 单测 | 真机状态 |
|---|---|---|---|---|
| 517A776B05C30EEBF2E7A0E2B68FE315F959748F0C3C8057FC20B975B69D98A3 | 09-26 下午 | 当前交付锚：EC5FCF0A 基 + seek 确认单调时钟（`seekConfirmed` 纯函数）+ 重新加入昵称合成 | 96 | **已装机 PHQ110 并真机复测通过**（`pm path` 回拉一致；seek 三场景/过期重入闭环/扫码入房，见 [设备复测](test-results/2026-09-26-device-retest/README.md)） |
| 764D0FE19B27DEC71EA629115297CE1D74911DF1E782F775A2282F149239F1B8 | 09-26 下午 | 同源码 R8 benchmark，性能测试专用、不分发 | 96（debug 侧计） | 构建通过，未装机 |
| EC5FCF0A987D10087CE88CEC228CF4509CDCC5B4E6D06E0CC79662005A4C4870 | 09-26 | 遗留修复：邀请提示/解析边界、实际播放倍速复位 | 91（口径后更正为 92） | 未装机；代码基随 517A776B 装机复测覆盖；Lint 0，见 legacy-fixes |
| F943E3CA4942B84E23169CF0927A07BE11D607329F27DA86B27225F894E2438B | 09-26 | 同源码 R8 benchmark，性能测试专用、不分发 | 91（debug 侧计） | 构建通过，未装机 |
| BCF3DE1630969684B05BB6552E26925F76E34C0039C78B212F950CA250027AFE | 09-26 凌晨 | 终稿：夜轮全部改动 + 删除播放状态文案（`playbackLabel`/MiniPlayer 副标题/「当前歌曲」行/同步说明），`CAMERA` 补 `uses-feature`，二维码位图改用 androidx-core Ktx | 84 | **未装机**（用户此后无法提供真机）；门禁全过 |
| 9E17F2916D1E4B3A3F3C21A51CEC476E6EDEF51886179081E5FC5E34A72C7302 | 09-26 凌晨 | 与 BCF3DE16 同源码的 R8 benchmark 包 | 84（debug 侧计） | 未装机；构建含 `minifyBenchmarkWithR8`；不可分发 |
| 9C48058311d96f2a958c6f6f9ec083b6f726aab88973d96ceef29df69a7f40eb | 09-25 深夜 | 夜轮改动 + Lint 修复（`uses-feature` camera / UseKtx），状态文案尚未删除 | 86 | **已装机 PHQ110**，`pm path` 回拉一致；6 项真机场景通过（见 [night-acceptance](test-results/2026-09-25-night-acceptance/README.md)）；扫码/双人未覆盖 |
| 086079819f422c4eccaf2d9ea9a9940e3b2e86e2b617e3e5ebb9261c7bfd1ccc | 09-25 深夜 | 同源码 R8 benchmark 包（2.4 MB vs debug 23 MB） | 86（debug 侧计） | **已装机**，回拉一致；歌单滑动帧耗时在此包采集（0.77%/0.16%）；`run-as` 不可用故无客户端诊断；不可分发 |
| E984FF400894D50CADFFB1BD1665E54A479D88639F71CACC45C817DB8816CD6D | 09-25 晚续修 | 入房表单恢复 + 重新入房 + QR 扫描/展示 + 歌单测量支持 | —（未运行） | 构建成功；未装机；被 9C480583（补门禁与 Lint 修复）取代 |
| A201AE4A07AB700590651DDCB331B18E0CCFBB6D72069FD1F8158D2523C68B8B | 09-25 晚续修 | 专用 R8 优化 benchmark 包（debug 签名、仅 benchmark HTTP） | —（未运行） | 安装成功但当时未测帧耗时；被 08607981 取代；不可分发 |
| 80CF7629C3BB7416CC82F4728F5A9F6CA240269948D4D6D26CE1D13E2B92625E | 09-25 晚 | 歌单滚动优化 + 固定表头/独立列表 + 移除头像选择/动态/首字封面；进度条逻辑保持原样 | 86 | PHQ110 已装机、回拉 hash 一致；基础布局通过；连续滑动 janky 27.27%、带停顿 13.38%，性能待优化 |
| D882D18632E04E28887DD8D87181410CE1115098838E6C8729B5B9A77D2E4767 | 09-25 | 0.3.0 批次 A 终稿 + 真机修复：房间动态流 + 伪封面 + 歌单跟随 + 触感/无障碍 + 头像 emoji；`PlayerSheet` 改 `skipPartiallyExpanded`（真机发现半屏回归） | 100 | **真机验收通过**（PHQ110，6 项场景，见 [device-batch-a](test-results/2026-09-25-device-batch-a/README.md)；⑤触感标人工、10 分钟淡出未覆盖） |
| F58278214D11CE2EB9A4A5E47606FA104F4FE8D181916B333E150F81B1AE4009 | 09-25 | 0.3.0 批次 A 复核稿（含独立复核 9 项修正） | 100 | 未装机；真机验收暴露出展开页半屏回归，已被 D882D186 覆盖 |
| 466C7B729A5334D669447A475826404A473A698DC0A74B779C9CF433A5920E0D | 09-25 | 0.3.0 批次 A（中间稿，已被 F5827821 覆盖）：同上，差独立复核后的 9 项修正 | 97 | 未装机（中间产物，无验收） |
| C685CE0ADE0B7E3288BB13465B74D0A5D65D421A42A79D8415D2E4C9ED67B30E | 09-25 | 反馈二小轮：顶栏去房间码胶囊（统一显示「一起听歌」）+ 删除保存长图；仅 assembleDebug，门禁未跑（累计改动同 011DD835 的 74 项基线） | —（未实跑） | 装机 Success（用户指示免验，未做场景目视） |
| 011DD835CF111A9DB8B352E206B00A341962EC5D5722D3D8830AC54BFEF1910E | 09-24 | 试用反馈轮：通知栏/展开页上一首下一首 + 顶栏只读胶囊（去复制图标/房主）+ 口令隐 :3000 + 移除歌单搜索 | 74 | 部分实测通过、其余按指示关闭（见 [feedback-round](test-results/2026-09-24-feedback-round/README.md)） |
| 6C231394C9BD14D50CFE61D08F1513403AB32184C7E1C4CBDB836BFC192A76AC | 09-24 | UI 重构轮：入口单卡片表单 + mini 播放器常驻/ModalBottomSheet 展开 + 成员头像堆叠 + 房间码胶囊复制 + 当前曲动效条 | 73 | 真机验收通过（10 项场景，见 [ui-refresh](test-results/2026-09-24-ui-refresh/README.md)；多人堆叠/跨生命周期 seek 兜底/暗色抽查标注未覆盖） |
| B4833B95AAA278E8AFA946AB2D78786572A95A35A3622C8E704102B8FFB59431 | 09-24 | 紧凑 UI + 进度隔离/歌单缓存 + PNG 长图导出 | 73 | 已被 6C231394 覆盖（同批能力真机通过） |
| 2CBA59132F8103C9AB450CA627A61A1A2AC95F6708E7C55422E73111AB427E73 | 09-24 | 批次 2 成员可视化（主题色板头像+状态点）+ 歌单搜索（PlaylistFilter） | 70 | 真机验收通过（批次 1+2 全场景，2026-09-24 下午） |
| BF393FB4801BF907E390A6694E3FE56D9BE54A326E7E0E9176F9141738D5A967 | 09-24 | 批次 1 邀请口令闭环（InviteCode + 粘贴邀请/确认卡/智能识别 + 顶栏口令化） | 61 | 已被上锚覆盖（场景经 2CBA5913 重验通过） |
| E814F90E1982936947218EA8917745B889A1430287F490A8E0FF5CB55B425FA7 | 09-24 | A-01 代次守卫 + E-07 seek 确认 + Q-1 诊断测试 | 53 | A-01/E-07 经 M3-LONG 与 2CBA5913 两轮真机验证通过 |
| 36BD3A5B3ACA74EE45CCEE952F6EB8C042BB0A18D40123601398ADF626DD0CCE | 09-23 | 分级纠正+SmoothRenderers+进度条圆点 | 45 | W1 验收+W2 公网 E2E 通过 |
| 169018AE746164D274E9C843AC8985A1DD27B647D6BF28DFA05110B705FB6845 | 09-23 | UI 评审优化 12 项 | 42 | UI 优化真机验证通过（后被覆盖） |
| 59773A08ACB9A4FBFF815C8FEDF3680B55FC7FA4EDA992FC6DC664EFB7119EED | 09-23 | 简洁 UI 重构 | 42 | 无线本地 reverse 目视通过 |
| BE545EEFE1C3260A8F4E00C88D8C4C14A62F1A442E7D717978107E79B4E60924 | 09-22 | 图标去紫→Google 蓝 | 36 | 装机 Success（桌面目视未做） |
| 5DA5082AA630A10AE324172FFA4B46F9D073A2AB4BDD07F6082EEA4C67D9119F | 09-22 | UI 交互修补 4 项 | 36 | 未真机目视（并入后续批次） |
| 832FB65EA4B606EB1C3EBFCE0EEAA887C585097D30219C1B11ED3884F907D09B | 09-22 | 校时不覆盖暂停提示 | 26 | 401 横幅复验通过（5/5） |
| 8CF98CE13507090BC45746B8E1F766CB87839B8B1EE57728E91096F15795BACA | 09-22 | M3 焦点+localPause 边沿诊断 | 25 | M3-AUTH 真机 401 首验通过 |
| 74BB193C670A9DB0F73FE8F2B5E7BCCFD62ECFD77DB07F7833E02FF541F5BBAF | 09-22 | 播放失败分类 | 25 | 蓝牙/404 恢复真机 |
| D30EE0EE455C6F16102592896EF11236F74907416A8E6A4546A9AE0D877940FB | 09-22 | 通知栏/息屏 | — | 通知栏点击+息屏真机 |
| 9AD0BD1DBEF839D6966AF5F0DF5DD47F3CF0EC16A454D772ED7C75E039DB2B22 | 09-21 | 界面重构 | — | 播放/暂停回归 |
| 139EC36C38A729351833DE01526B9904A2D5483E7E93F44826CE8628D059D839 | 09-21 | M1 会话加固 | 21 | M1 真机复测 |
| 228BB0B0A1CA2B169523D51FA14A477625F3E938A60E9FA99929B5004BB62939 | 09-21 | 上一轮基线 | — | — |

> 0.3.0 批次 A 的 hash 演进：**2D73A208**（95 项，自查中间稿）→ **466C7B72**（97 项，自查中间稿）→ **F5827821**（100 项，独立复核稿）→ **D882D186**（100 项 + 真机修复，**唯一装机并通过真机验收的交付锚**）。中间稿均未装机、无验收记录，保留在此仅用于回溯"哪一版引入的问题"。
>
> 09-25 夜轮的 hash 演进：**E984FF40 / A201AE4A**（夜轮实现会话登记，未跑门禁）→ **9C480583 / 08607981**（补门禁与 Lint 修复，**已装机并做真机验收**）→ **BCF3DE16 / 9E17F291**（删除播放状态文案后的终稿，未装机）。

## 尚待真机与云端验收
- [x] EC5FCF0A/517A776B 代码基真机回归：**已关闭**——同一代码基随 debug `517A776B…` 装机（09-26 傍晚复测通过：邀请入口/扫码、seek 三场景无假横幅、播放 1.0x 前进），见 [设备复测记录](test-results/2026-09-26-device-retest/README.md)；唯**倍速追赶后实际复位**未做专项注入测量（省电场景难复现，保持挂起项，随弱网注入补测）。
- [x] 09-26 房主清扫与 connect 补位修复：**已上云**（release 20260926-1822，专项验证 HostA 掉线被清扫 → MemberB 加入即接任；设备端对新后端入房冒烟未做，见 [云端部署记录](test-results/2026-09-26-cloud-deploy/README.md)）。
- [x] 09-26 界面提示精简（BCF3DE16 代码基）：**已装机并目视**——同一精简界面随 `517A776B…` 于 09-26 傍晚装机，复测含展开页与房间页截图（MiniPlayer 只剩歌名、状态仅由横幅/图标承载）；BCF3DE16 单包不再单独目视。
- [x] **`InviteCode.HINT` 文案失真**：09-26 按本轮遗留修复请求改为「打开 App 扫描邀请二维码，或手动输入房间码加入」，旧口令仍兼容；新包未装机。
- [x] 09-25 夜轮真机验收（在机 `9C480583…` + benchmark `08607981…`，PHQ110 / Android 14 / 云端）：预填不静默入房、`rememberSaveable` 跨重建存活、Expired 横幅「重新加入房间」换发新令牌、房间回收后的表单内联错误、邀请二维码反解（四行、无 `:3000`、无令牌）、benchmark 放行 HTTP 并播放成功；**歌单滑动帧耗时同条件 A/B：R8 0.77%/0.16% vs debug 7.66%/2.08%**——上一轮 27.27%/13.38% 属 debug 口径，不代表用户构建。见 [night-acceptance](test-results/2026-09-25-night-acceptance/README.md)。
- [ ] 夜轮未覆盖项：**相机扫码入房**（需人工对准屏幕）、**双人同屏与成员展开 180dp 滚动**（同机两客户端被 ColorOS 断网，需本机后端 + `adb reverse` + `scripts/member-sim.mjs`）、空歌单、2 倍系统字号、小屏布局、emoji/代理对昵称真机目视（`input text` 打不进非 ASCII，仅单测覆盖）、滚动中切歌不抢滚动、人工手感。
- [ ] 09-25 晚歌单精简版（80CF7629…）：已装机并确认固定标题、独立滚动和成员展开；当时记的滚动掉帧（连续 27.27%、带停顿 13.38%）已由夜轮 A/B 澄清为 debug 口径，R8 实测 1% 量级；剩余待补项并入上一条。
- [x] 手机实际创建房间、选歌、播放、暂停、拖动进度；用户确认有声音。
- [x] 断线重连状态机：服务器死亡→退避重连→404 过期→退出重新入房（2026-09-21 真机故障注入）。
- [x] 受控断线恢复与延迟注入：12 秒断线自动恢复、300ms 延迟校时稳定（2026-09-21）。
- [ ] 两台安卓手机同时听歌并测量同步误差，不能把 WebSocket 测试当作实际音频同步验证（M2，缺第二台手机挂起）。
- [x] 后台与短暂息屏继续播放，系统媒体会话暂停控制。
- [x] 通知栏按钮实际点击（2026-09-22 真机）。
- [x] 耳机拔出等价路径：蓝牙断开触发本机暂停、重连不自动恢复（2026-09-22）。
- [x] 音频错误重试：404→暂停→恢复文件后手动重试续播（2026-09-22）。
- [x] M3-FOCUS：其他媒体持久抢占与真实来电中断（2026-09-22）；去电、拒接、VoIP 抢占未测。
- [x] M3-LONG：60 分钟连续播放 + 至少 30 分钟息屏——**已完成**（2026-09-24，真实音乐顺播 70 分钟 + 息屏 30 分钟整 + 多人动态进出同时进行，见 [test-results/2026-09-24-long-multiplayer](test-results/2026-09-24-long-multiplayer/README.md)；"非房主切歌被拒/成员本地暂停互不影响"两项未覆盖，见该记录边界节）。
- [x] M3-AUTH：注入 401 真机路径 + 横幅持久性复验均通过；真实令牌作废场景无入口，保持标注。
- [x] LOAD-15：本地 600s 通过（2.873Mbps）；云端公网重测通过（2.847Mbps=99.1%，2026-09-23 晚）；throughput 模型未在云端执行（流量预算取舍，如实标注）。
- [ ] 成员端本地暂停不影响其他人、房主转移、中途加入——**大部分达成**（2026-09-24 长时+多人轮：房主转移 ✅、中途加入 ✅、成员本地暂停互不影响未覆盖——参与者中途全部离场，见 [test-results/2026-09-24-long-multiplayer](test-results/2026-09-24-long-multiplayer/README.md)；M2 精度验收仍需可接 adb 的第二台手机）。
- [x] 云端首次部署 + 13 项服务端验证 + SSH 隧道联调（2026-09-22）。
- [x] 公网验证：真机经 `http://8.166.126.136:3000` 完成建房→播放全链路（2026-09-23 晚，APK 36BD3A5B…）。**部分覆盖**：仅 Wi-Fi 出口；蜂窝未测（无线调试依赖 Wi-Fi，切蜂窝断 adb，需 USB 或第二台手机补）。
- [x] W1 卡顿修复真机验收（2026-09-23 晚，关/开省电、自动切歌、端点像素、暗色冷启动、听感确认全过）。
- [ ] 公网弱网/丢包/抖动条件下的真机表现（未测；fault-proxy 注入此前只在本地用过）。
- [x] 版本回滚演练：升级 + 真实回滚双向通过（2026-09-23 晚，13 项抽查三次各 13/0）；两次 restart 各清空一次内存房间已实证。升级失败注入未做（如实标注）。
- [x] 15 路实际音频带宽云端重测（2026-09-23 晚）。**M4 四项部署门槛至此全部关闭**。
- [x] 后端防线 E-05/E-09/Q-3 上云：**已完成**（2026-09-24 上午，release 20260924-0937，14 项验证 + 新防线专项验证通过，见上文与本轮记录）；升级失败注入仍未做。
- [x] 批次 1 邀请口令真机闭环（2026-09-24 下午，BF393FB4→2CBA5913 重验）：复制口令→Snackbar、粘贴邀请→确认卡（房间码+地址）、确认卡加入重入同房、口令地址≠已记住地址提示、join 失败横幅「房间不存在或已过期」+ 横幅优先于确认卡且昵称保留——全过（见 [test-results/2026-09-24-ui-batch-acceptance](test-results/2026-09-24-ui-batch-acceptance/README.md)）；**智能识别、busy 禁用、系统分享面板弹出三项自动化未能模拟，标注人工验证**。
- [x] 批次 2 成员可视化 + 歌单搜索真机目视（2026-09-24 下午，2CBA5913…）：展开成员头像首字符'B'、'房主 · 在线'文字并存；搜索'192'→仅 192kbps 行、无命中占位「没有匹配的歌曲」、清除恢复全列表；选歌切换当前歌曲、播放健康（diag 速率 995ms/s=1.0x）、E-07 拖回开头回归（20794→6125ms、seek=1）——全过（见 [test-results/2026-09-24-ui-batch-acceptance](test-results/2026-09-24-ui-batch-acceptance/README.md)）；暗色主题下批次 2 头像可读性未自动验（暗色冷启动无白闪此前已验），标注人工。

- [x] 本轮紧凑 UI + 滚动 + 长图（2026-09-24）：公网 24 首曲库安装/页面/PNG 保存已通过；快滑 janky 23.79%、自然节奏 8.43%。**长图导出已于 2026-09-25 按用户指示整体删除**，播放中听感、ColorOS 原生长截屏等待验项随之作废。步骤见 [ui-scroll](test-results/2026-09-24-ui-scroll/README.md)。
- [ ] 试用反馈轮真机验收（APK 011DD835…）：**用户决定终止补验（2026-09-25）**。已实测通过：通知栏下一首/上一首/末首回绕实际切歌（Bug④ 修复成立，公网 23 首曲库）、Sheet 切歌钮、顶栏无复制图标/房主标注、无搜索框 + 云端 23 首、分享口令文本无 :3000 且系统分享面板含「复制」目标。未补验即关闭：粘贴口令→确认卡→重入同房、成员点切歌 Snackbar；「保存长图」「顶栏房间码胶囊」两场景随 2026-09-25 反馈二小轮功能删除而作废。注意：**当前工作区代码已含 011DD835 之后的新改动（未重建 APK）**。结果修订见 [feedback-round](test-results/2026-09-24-feedback-round/README.md)。（后半句已过时：09-25 已重建 C685CE0A…（装机）与 466C7B72…（本轮，未装机）。）
- [x] 0.3.0 批次 A「一起听体验轮」真机验收（APK **D882D186…**）：**2026-09-25 下午完成**（PHQ110 / Android 14 / 云端后端），6 项场景通过——①房间动态流（加入/掉线/回来/离开 + 离线 60 秒被移除不补报 + 时间线与相对时间分档，长期老化到 `14 分钟前` 仍正确）；②伪封面与展开页布局（修复半屏回归后复验）、返回键收起；③歌单跟随（屏外滚到当前曲、屏内不跳动，**曲终自动推进同样跟随**）；④头像 emoji 与偏好持久化、24 字昵称 + emoji 不触发 400；⑤触感**标人工手感**（`dumpsys vibrator_manager` 不记录 `performHapticFeedback`，见陷阱 2.12）；⑥暗色与动态取色可读。**未覆盖**：10 分钟摘要淡出（观察窗内持续播放、最新动态始终 <10 分钟，规则仅单测）、2 倍系统字号下的小屏展开页、成员数 ≥3 的 `+N` 堆叠收尾、弱网下动态到达时序。证据见 [device-batch-a](test-results/2026-09-25-device-batch-a/README.md)。

## 环境与联调速查

- 本地后端：`.\scripts\start-demo.ps1`（前台窗口）；健康检查 `http://127.0.0.1:3000/health`；后端重启清空内存房间。
- 真机 USB：`.\scripts\install-debug.ps1`（装 APK + reverse + 启动）；多设备加 `-Serial`。
- 真机无线：`.\scripts\connect-wireless.ps1 -DebugHost <IP:调试端口> -Port 3000,3001 -Install -Verify`；配对端口≠调试端口且每次轮换；连接/reverse 必须单命令块完成（陷阱 2.7/2.8）。
- 公网入口：手机直接填 `http://8.166.126.136:3000`，无需 adb。
- 云端运维：`ssh aliyun`；升级/回滚见 [deployment.md 第 5 节](deployment.md)，曲库管理见第 6 节（替换音频后必须重启，重启清房间）；**严禁在服务器跑 VS Code Remote/重负载**（陷阱 8.5）。
- 项目级检查：`.\scripts\check.ps1 -Scope all`（后端 tsc+测试、安卓单测+构建+Lint、文档链接）。安卓段自带 `cleanTestDebugUnitTest`，**单测必然本轮实跑**（不加清理任务时 Gradle 会 UP-TO-DATE 跳过，见[陷阱 5.5](development-pitfalls.md)）；判读日志看 `> Task :app:testDebugUnitTest` 不带 UP-TO-DATE。
- 动手前必读：[开发陷阱清单](development-pitfalls.md)。

## 测试记录入口（docs/test-results/）

| 记录 | 内容 |
|---|---|
| [2026-09-21-m1-session-device](test-results/2026-09-21-m1-session-device/README.md) | M1 真机复测：状态机全链路、诊断 JSONL |
| [2026-09-21-m1-fault-proxy](test-results/2026-09-21-m1-fault-proxy/README.md) | M1 故障注入：延迟/断线/宽限过期 |
| [2026-09-22-m3-notification-device](test-results/2026-09-22-m3-notification-device/README.md) | 通知栏实际点击、息屏播放 |
| [2026-09-22-m3-bluetooth-audio-error](test-results/2026-09-22-m3-bluetooth-audio-error/README.md) | 蓝牙断开、音频 404 恢复 |
| [2026-09-22-m3-focus](test-results/2026-09-22-m3-focus/README.md) | 音频焦点抢占与来电中断 |
| [2026-09-22-m3-auth](test-results/2026-09-22-m3-auth/README.md) | 401 注入自测 + 真机首验 |
| [2026-09-22-m3-auth-recheck](test-results/2026-09-22-m3-auth-recheck/README.md) | 横幅持久性复验（832FB65E） |
| [2026-09-22-load15](test-results/2026-09-22-load15/README.md) | LOAD-15 本地基线 2.873Mbps |
| [2026-09-22-m4-inventory](test-results/2026-09-22-m4-inventory/README.md) | 云端只读盘点 |
| [2026-09-22-m4-first-deploy](test-results/2026-09-22-m4-first-deploy/README.md) | M4 首次部署 13/13 + 隧道 9/9 |
| [2026-09-22-m4-public-test](test-results/2026-09-22-m4-public-test/README.md) | 公网 E2E 自动化失败记录（陷阱 3.4） |
| [2026-09-23-ui-refresh](test-results/2026-09-23-ui-refresh/README.md) | 简洁 UI 交付记录 |
| [2026-09-23-ui-optimize](test-results/2026-09-23-ui-optimize/README.md) | UI 优化真机验证 |
| [2026-09-23-w1-recheck](test-results/2026-09-23-w1-recheck/README.md) | W1 卡顿修复真机验收 |
| [2026-09-23-m4-public-e2e](test-results/2026-09-23-m4-public-e2e/README.md) | W2 公网 E2E 通过 |
| [2026-09-23-m4-rollback-drill](test-results/2026-09-23-m4-rollback-drill/README.md) | W3 升级/回滚演练 |
| [2026-09-23-load15-cloud](test-results/2026-09-23-load15-cloud/README.md) | W4 云端 15 路重测 |
| [2026-09-24-ui-batch-acceptance](test-results/2026-09-24-ui-batch-acceptance/README.md) | UI 批次真机验收：批次 1 邀请口令 + 批次 2 成员可视化/歌单搜索 |
| [2026-09-24-feedback-round](test-results/2026-09-24-feedback-round/README.md) | 试用反馈轮：通知栏切歌修复 + 顶栏收拢 + 口令隐端口 + 去搜索/去云端测试音 |
| [2026-09-25-device-batch-a](test-results/2026-09-25-device-batch-a/README.md) | 0.3.0 批次 A 真机验收：房间动态流/伪封面/跟随滚动/头像 emoji/暗色（6 项通过，触感标人工，含真实缺陷修复与截图） |
| [2026-09-25-playlist-feedback](test-results/2026-09-25-playlist-feedback/README.md) | 09-25 晚歌单滚动与界面精简：固定标题/独立滚动/移除头像与动态；装机目视 + debug 包掉帧基线（27.27%/13.38%，口径限制见夜轮 A/B） |
| [2026-09-26-legacy-fixes](test-results/2026-09-26-legacy-fixes/README.md) | 遗留逐项修复：邀请提示/长码边界、房主清扫/接任、倍速复位、旧采样证据更正；23 后端 + 91 安卓 + 3 脚本测试，Lint 0；未装机/未部署 |
| [2026-09-25-night-acceptance](test-results/2026-09-25-night-acceptance/README.md) | 夜轮装机验收：门禁与 Lint 修复、两包装机回拉、6 项真机场景、二维码反解、**R8 vs debug 帧耗时同条件 A/B**、播放态显示疑点与未覆盖项清单（含 adb 环境限制） |
| [2026-09-26-device-retest](test-results/2026-09-26-device-retest/README.md) | 设备复测：`517A776B` 装机回拉（截断陷阱）、云端真实曲库 seek 三场景回归、过期重入闭环（成员+房主）、二维码反解 + 人工扫码、`member-sim` 进出、24 码元昵称边界、热点约束与断网手段修正 |
| [2026-09-26-cloud-deploy](test-results/2026-09-26-cloud-deploy/README.md) | 后端上云 release 20260926-1822：42/42 校验、旧/新版本 14/14 自检、房主清扫→首个上线成员接任专项验证、prev 回滚点保留 |

历史过程记录：[2026-09-21 播放测试](archive/playback-test-2026-09-21.md)（操作过程、状态采样与问题处理，已归档）；W1/W2 交接单 [handover-2026-09-23](archive/handover-2026-09-23.md)（卡顿根因完整分析，已归档）。
