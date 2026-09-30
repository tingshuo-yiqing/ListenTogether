# AGENTS · 开发会话指南

本项目用 AI 辅助持续开发。任何新会话（包括中断后恢复）从本文开始，按顺序读少量文档即可继续，无需重读整个项目。

## 恢复开发的标准入口（按序阅读；不必通读全文，verification.md 优先看「本轮新增 / 当前状态一览 / 尚待验收」三节）

1. `docs/verification.md` —— **进度唯一事实来源**。"本轮完成/本轮新增"是最近交付，"尚待验收"是待办清单。
2. `docs/next-development-plan.md` —— M0-M4 路线图、当前任务顺序、验收标准。
3. `docs/modules/README.md` —— 模块索引；改动哪个模块就读对应 `docs/modules/<编号>.md`（含已实现/待开发分界）。
4. `docs/development-pitfalls.md` —— **开发陷阱清单**：实际踩过的坑与规避方法（编码、adb、UI 自动化、Compose、协程测试）。动手前通读，踩到新坑必须回填。

历史证据按需查：`docs/test-results/<日期-场景>/README.md`（**45 个场景目录**，完整索引见 verification.md「测试记录入口」）；使命完结的一次性历史文档在 `docs/archive/`（播放测试 2026-09-21、W1/W2 交接单 2026-09-23）。

## 当前进度快照（2026-09-30：23 首新歌上云 + 重复《唯一》清理（本地/云端曲库同为 45 首）；安卓锚 `F79DFE09…`；后端在产 release `20260928-1815`；细节以 verification.md 为准）

- **23 首新歌上云 + 重复《唯一》清理（2026-09-30，纯数据轮，无代码改动）**：①上云前盘点发现本轮导入的 `wei-yi-2` 与既有 `wei-yi` 音频 md5 完全相同（同一首歌导入两次），走管理器 DELETE 接口删除、3 文件入回收批次 `20260930-034604`（manifest 可恢复），整库 45/45 可加载；②新增 23 首（成全→泡沫）共 70 文件 116MB 打包 scp 上云（远端 sha256 核对一致），云端 catalog 预备份至 `media-originals/catalog-pre-sync-20260930/`（增量同步，旧 22 首文件未动）；③**坑：chown 没加 `-R`，解包新文件仍是 root 属主 640，服务 loadCatalog EACCES 起不来进重启循环**——递归 chown + 640 后恢复，今后曲库上云的属主操作一律 `-R` 并抽查新文件属主；④重启前确认内存无活跃房间（`A84AFF71` 已 empty-timeout 自毁）；⑤验证：health 200、启动日志零 error、云端 catalog 与音频 md5 与本地逐位一致。GitHub 推送待用户指令。
- **管理器页面重构：视图拆分 + 列表节点缓存 + 版本告警误报修复（2026-09-29，纯前端）**：只改 `scripts/metadata-manager.html`（`metadata-manager.mjs` 零改动，其 HTML 是请求时现读磁盘，**3100 常驻进程无需重启即生效**）。①顶栏 5 平铺按钮 → `浏览曲库 / 批量匹配 / 新增歌曲` 三视图互斥（`body[data-view]` 驱动显隐、`aria-selected` 高亮，切视图不碰数据）；②`renderList` 由整表 `innerHTML` 重建改 `rowCache` 行节点缓存（筛选/排序/多选/删除只改类名与节点顺序）；③顺带修掉版本告警误报——页面由硬编码版本 `===` 改为 `PAGE_SERVICE_VERSION` 下界比较，服务端更新不再误报「旧版本」。门禁 51/51 + 三份页面驱动全绿；抓到并修复 `renderList` 空结果分支早退漏清场（陷阱 10.7/10.8）。函数拆分（`select`/`resourceRow`）本轮未做，等用户实际用过视图后单独一轮。证据：[2026-09-29 管理器 UI](docs/test-results/2026-09-29-manager-ui/README.md)。
- **本机与云端曲库已同为 22 首 Hi 形式（2026-09-29，无新代码）**：①曲库目录收敛为 catalog 引用 66 文件——88 个迭代旧版本（135MB）曾移入 `.workbuddy/media-trash/orphan-cleanup-2026-09-29-04-25-51/`，**清理轮已彻底删除**（仅留 `manifest.json` 作删除记录；云端在产曲库与 `media-originals/media-backup-hi-20260929/` 均有备份）；②main 推 GitHub（`629d3c6` → `34b53ec`；代理端口漂移用 `-c http.proxy` 覆盖）；③上云：旧曲库备份 `media-originals/media-backup-hi-20260929/` → 同步包 101MB（22 音频含 11 首 aac 转码产物 + 22 歌词 + 22 封面 + catalog）scp 解包、`chown listen-metadata:listen` + 640、`systemctl restart listen-together`（当时无活跃房间），基线 **14/14**，本地/云端 ju-hao 音频与封面 md5 逐位一致，catalog 首条 artist/album/year/lyrics/cover 全带；④客户端 coverVer/lyricsVer 随内容变化，设备下次入房自动重拉，**无需清缓存**。⚠️ 清理脚本「按前缀保留」的守卫正则被连字符截断（`hong-ri`→`hong`）误移《红日》《忘情水》5 文件，已取回并记入 manifest——批量脚本按前缀归类前先拿真实样本验（陷阱同族：副作用要对账，不能只看退出码）。
- **.aac 转码收编（2026-09-29，22/22 全部 Hi 化）**：`parseHiAudio` 放行 `.mp3/.aac/.m4a`（酷我 CDN 白名单不变）；管理器新增 `transcodeToMp3`（ffmpeg libmp3lame 192k、180s 超时、临时文件即用即删、产物过魔数 + 长度校验），`/higequ-replace` 与 `/api/higequ/import` 共用，ffmpeg 缺失/失败回 422。**播放链路照旧只读 MP3**，转码只发生在下载环节，不宣称无损。门禁 51/51（含真 aac 夹具 e2e）+ 驱动 85/85。
- **导入拼音命名 + 批量 Hi 替换 + 命名合规（2026-09-29）**：新增根依赖 `pinyin-pro`（MIT）+ `pinyinId()`（`情深深雨濛濛`→`qing-shen-shen-yu-meng-meng`、非中文按原文、64 位截断），`/api/higequ/import` 默认 ID 改拼音、重名自动 `-2`（不再 409，`body.id` 显式指定时仍 409）；命名合规全检修正 3 处反斜杠路径（`path.join` 在 Windows 写进 catalog，同步到 Linux 会坏）。
- **Hi 整首替换 + 搜索导入 + 面板重构 + 启动器幂等重启（2026-09-29）**：`/higequ-replace` 一次动作换音频 + 标题/歌手连名覆盖 + 专辑（非空才覆盖）+ 歌词 + 封面，去掉「先保存表单」拦截；`wx` 独占创建（先 mkdir）+ `writeAndValidate` 闸门，失败整组撤销，旧文件原地保留。新增 `/api/higequ/search`（无 1s 间隔/无缓存，人工挑条）与 `/api/higequ/import`（默认 `hi-<rid>`，重复 409 / 坏 rid 400 / 无直链 404 / 非 MP3 422 均不动库），`parseHiDetail` 加 `verifyIdentity:false`。新增面板改「Hi 搜索行内导入为主 + 手动上传收进折叠」（`textContent` 防注入）。`start-metadata.ps1` 改幂等重启——删掉硬编码版本比较与「复用已运行进程」分支，那正是用户撞上「接口不存在」的来源。门禁 51/51 + 85/85。
- **Hi 音频下载（2026-09-29，用户决策：单曲手动触发、仅开发测试、非商用、不限速）**：`higequ.mjs` 新增 `parseHiAudio`——站点把音频直链以 `let code="<base64>"` 服务端渲染进 player 页（酷我 CDN 免签名免 Referer），解码后仍须过 `allowedAudioUrl` 白名单（`*.kuwo.cn` 族 https/443/无凭证）；`metadata-assets.mjs` 加 `AUDIO_LIMIT`（64MB）；`POST /api/tracks/:id/higequ-audio` 复用 `syncTrack` 身份校验（判定字段是 `metadataAccepted`，消费 `identityAccepted` 会恒 undefined）→ 下载 → MP3 魔数校验 → `audio/<id>-<uuid>.mp3` 换指针，旧音频原地保留。其余来源（QQ/网易云/MusicBrainz）仍不下载音频。
- **M2 双机同步（2026-09-28 深夜，纯测试轮零代码改动）**：A=PHQ110 真机（房主）+ B=MuMu 12 模拟器（成员），云端 release 20260928-1815。测量工具本轮入库可复跑：`scripts/m2-diag-stats.mjs`（diag JSONL 按 `estimatedServerMs` 服务端时钟对齐、1 秒桶配对、`correction=seek/speed` 分级）与 `scripts/m2-sync-sample.mjs`（`dumpsys media_session` 交叉口径，读数偏斜按各自读取时刻外推）。10 分钟连续播放（自动顺播跨三首）：可比样本 **99.5%**（门槛 ≥90% ✅），跨端偏差 ≤500ms 占 **28.1%**（diag，p50=732ms）/ 49.0%（dumpsys）——**95% 门槛未达 ❌**；根因判明为 **MuMu 模拟器音频时钟慢 2–3%**（真机自身 drift p50=**258ms** 达标且零 seek；MuMu p50=934ms、约 75% 时间处于变速追赶）。三场景全过：切歌跟随偏差 161ms、成员本地暂停隔离、恢复跟听 790ms 回带内。**95% 门槛在真机-真机组合复测前显式挂起，模拟器配对不作该门槛判定依据**；期间不调同步参数。音频层同录比对与 15 人负载未重跑。
- **结构拆分 + 封面双层缓存（2026-09-28 深夜，当前安卓锚 `F79DFE09…`，128 单测、Lint 0、已装机并回拉逐位一致）**：先测后改——debug 包 14.3% 掉帧/p90 40ms，R8 benchmark **1.1%/p90 16ms**（结论仍是「帧耗时只认 R8 包口径」）。`CoverCache` 加内存 LruCache（堆 1/8、按 `Bitmap.byteCount` 计费、键含 `targetPx`）+ `inSampleSize` 降采样（44dp 缩略图不再解 500×500 全尺寸位图，滚回可见区不重复解码）；`MainActivity` 868→**284** 行（只留组合根与 `formatTime`），界面拆为 `ui/HomeScreen.kt` / `ui/RoomScreen.kt` / `ui/CommonUi.kt`（全 `internal`，权限 launcher 仍留在 Activity）。协议与服务端零改动。
- **lyricsVer 缓存失效 + 分支合并 + 云端管理器 metadata-03（2026-09-28 深夜，release `20260928-1815`，prev `20260928-1718`）**：catalog 协议扩到**第 8 字段 `lyricsVer`**（`coverVersion` 泛化更名 `contentVersion`，无歌词为 null）；安卓 `LrcCache` 缓存键 = `id-lyricsVer`（旧服务端缺字段时退回纯 id 键，向后兼容）——**「换歌词要手动清客户端缓存」的挂账就此关闭**。分叉分支合并进 main（merge `7428c0c`）。云端管理器发 `20260928-metadata-03`（独立版本目录 + 夹具验收 + 切链接 + rollback trap；服务器侧 `node --test scripts/lib` 37/37、离线驱动 85/85，**未重启播放后端**，生产 catalog 发布前后 SHA256 逐字节相同）。基线 14/14。
- **元数据链路真机验收 + 歌词乱码修复（2026-09-28 傍晚，release `20260928-1718`）**：真机抓到《有何不可》歌词「起」字渲染为 U+FFFD——根因是 `fetch-lrc.mjs` 用 `data += chunk` 逐块独立解码 https 响应 Buffer，跨块汉字整体损坏（**陷阱 10.4**），改 `setEncoding('utf8')` 后脚本 37/37；云端坏字节随同步被净本取代（坏件留档 `media-originals/lyrics-corrupt-backup-20260928/`）。封面在产版是 `const cover = null` 刻意停用，真实现（`12cb8de`）本轮才发版，产出 19/21 封面。**云端《红日》《忘情水》为用户经云端管理器删除**，故云端一度 21 首（09-29 同步后回到 22 首口径，见首条）。证据：[2026-09-28 元数据真机验收](docs/test-results/2026-09-28-metadata-device-check/README.md)。
- **Hi 歌曲优先 + 管理页面优化（2026-09-28）**：`higequ.com` 元数据适配（来源优先 Hi→QQ→网易云→MusicBrainz、`data-time` 歌词转 LRC、`og:image` 封面、12s/2MB 页面上限 + 1s 限速 + 同站跳转校验，只请求搜索/详情）；页面加专辑检索、缺项筛选、批量匹配、停止/重试、新旧值预览；**回收站恢复**（`scripts/lib/media-trash.mjs`，每批 `manifest.jsonl`，恢复后原回收副本保留，坏库先拒绝）；根目录 `start-metadata.cmd` → `scripts/start-metadata.ps1`。门禁 47/47 + 85/85。证据：[2026-09-28 Hi 管理器](docs/test-results/2026-09-28-higequ-manager/README.md)。
- **历史轮次（2026-09-23 ~ 09-27，均已闭环）**：界面收拢、邀请口令 + 二维码、通知栏/展开页环形切歌、批次 A 一起听体验；其中房间动态流（`ui/RoomActivity.kt`）、伪封面（`ui/TrackArtwork.kt`）、歌单长图（`ui/PlaylistImage.kt`）、头像选择器、歌单搜索（`PlaylistFilter.kt`）**均已按试用反馈删除，对应文件不复存在，勿按旧记录去找**；`scripts/fetch-metadata.mjs` **已删除**（抓取/打分/缓存并入 `scripts/lib/metadata-sources.mjs` + 管理器）；元数据三轮（服务端 ID3/歌词/封面 + 安卓解析与 UI）、曲库删除（单曲 + 批量，引用计数、文件进回收可放回）。详述见 verification.md「交付历史索引」与 `docs/test-results/`。
- **下一步**：
  - **M2 95% 门槛 = 当前唯一主线挂起项**：等**第二台真机**；到位后用 `scripts/m2-sync-sample.mjs` + `m2-diag-stats.mjs` 按同口径复测出权威结论（期间不调 SyncMath/变速参数）。
  - **封面链路已闭环（原先的「云端发布 + 真机目视」待办作废）**：`cover` 真实现（`12cb8de`）在 release `20260928-1718` 才真正发版，09-28 傍晚真机已目视确认 **19/21 歌单行·迷你条·播放页真实专辑图**（《单车》《倔强》无独立封面按设计占位），09-29 22 首全套封面随曲库上云。
  - **云端下架一首歌既无工具也无实测流程**：真要下架前先按部署手册 6.3 完整实测一遍再登记。
  - **设备补测**：双人同屏与成员展开 180dp 滚动、空歌单、2 倍系统字号（含歌词排版）、小屏布局、emoji/代理对昵称目视、快滑/触感人工手感。
  - **公网弱网/丢包/抖动真机表现**（此前 fault-proxy 只在本地用过）、真实令牌作废（后端无入口）、升级失败注入。
  - **部署注意**：曲库改动（音频/歌词/catalog）**必须 restart** 才生效（启动时一次性加载，陷阱 8.10）；**不要用 `package-deploy.ps1` 部署曲库**——它会把本地 `media/`（ASCII 名布局）打进包覆盖云端曲库；上云走「云端旧库备份 → 同步包 scp → 解包 → chown/640 → restart」。
  - **清理待办已清（2026-09-29 清理轮）**：迭代旧版本 122MB、同步暂存目录、旧 release 包与一次性探针脚本均已删除（明细见 verification.md「工作区清理轮」），云端 `media-originals/` 下各份备份保留。
  - 元数据第三轮残留：通知栏歌手；专辑已在 catalog 内但**服务端未下发 album 字段**（协议第 9 字段，属第三轮，未开工）。
  - TLS/域名正式化——用户已决策路线 A（试用期维持 `http://8.166.126.136:3000` 明文 IP），转正式实例备案或迁中国香港时一并解决；`benchmark` 变体本机测试专用、不分发，正式 release 继续拒绝 HTTP。
- 日常入口：试用反馈驱动的修复循环，或 M2 条件成熟 / 元数据第三轮残留项推进。

## 常用命令（Windows PowerShell）

```powershell
# 后端（演示曲库）
cd D:\ListenTogether; .\scripts\start-demo.ps1        # 前台窗口，Ctrl+C 停止
# 健康检查
Invoke-WebRequest http://127.0.0.1:3000/health

# 安卓构建 + 单测 + Lint（cleanTest… 保证单测本轮实跑，不加会被 Gradle 判 UP-TO-DATE 跳过）
cd D:\ListenTogether\android
.\gradlew.bat :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
# 性能变体（R8 已 shrink/minify、isDebuggable=false、包名后缀 .benchmark、仅此变体允许 HTTP；帧耗时基准用它，本机测试专用不分发）
.\gradlew.bat :app:assembleBenchmark   # 安装要 adb install --no-streaming
# 注意：该包 `run-as` 会被拒、`am start -n <包名>/.MainActivity` 因后缀报不存在，取证改用 dumpsys media_session / gfxinfo / 截图（陷阱 2.14）

# 真机联调（PHQ110；USB 或无线，多设备/多 transport 时加 -Serial）
cd D:\ListenTogether; .\scripts\install-debug.ps1     # 装 APK + USB 转发 + 启动 APP
# 无线调试（免 USB，USB 抖动时首选；配对→连接→reverse 必须一次做完，见陷阱清单 2.7）
cd D:\ListenTogether; .\scripts\connect-wireless.ps1 -DebugHost <IP:调试端口> -Port 3000,3001 -Install -Verify
# 手机端诊断日志：adb shell run-as com.listentogether.app ls files/diagnostics/
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

# 脚本成员（单机验收好友互动：加入/掉线/回来/离开；成员必须持 WS）
cd D:\ListenTogether; node scripts/member-sim.mjs join <房间码> "脚本小王" --hold 20 --target http://8.166.126.136:3000
# 房间码不在界面显示：从设备诊断 JSONL 或云端 journalctl 的 room.created 事件取

# 曲库管理唯一入口（手工编辑 / 手工上传 / 封面上传替换移除 / 联网匹配【Hi歌曲·QQ·网易云·MusicBrainz】
#   / Hi 搜索导入新歌 / Hi 整首替换 / Hi 音频下载 / 删除单曲与批量 / 回收站恢复，全在这个界面）
cd D:\ListenTogether; start-metadata.cmd                    # 一键启动（幂等重启：先停 3100 旧进程再用最新代码起，打开浏览器）
cd D:\ListenTogether; node scripts/metadata-manager.mjs      # 或手动起，http://127.0.0.1:3100，需先 cd server && npm run build
# 删除只作用于本机 media/，文件进 .workbuddy/media-trash/<批次>/（管理器删曲批次含 manifest.jsonl，可经界面恢复）；云端删曲走 add-media.ps1 + 服务器 media-manage.sh
# 非 mp3（.aac/.m4a）导入时经 ffmpeg libmp3lame 192k 本地转码，ffmpeg 需在 PATH；播放链路本身只读 MP3
# 本机工具脚本单测（纯离线，不访问公网）
cd D:\ListenTogether; .\scripts\check.ps1 -Scope scripts
```

## 环境备忘

- 构建：JDK 17、Android SDK Platform 35、Build Tools 35.0.0、Gradle 8.11.1（wrapper 自动下载）。
- 后端：Node.js 24 / TypeScript / Fastify；依赖用 `npm ci`；演示后端用 demo-media 合成曲库。
- 真机：PHQ110（OPPO），地址填 `http://127.0.0.1:3000`（依赖 adb reverse）；后端重启会丢失房间（内存态）。
- 后台运行的演示后端日志在 `demo-backend.log`。
- 曲库（2026-09-30 现状）：`D:\ListenTogether\media` 为 **45 首真实曲库**（原 22 首 Hi 形式 + 09-30 上云的 23 首 Hi 搜索导入曲；音频/歌词/封面齐备、`<id>-<uuid>` 命名为主，导入端点音频按设计为 `<id>.mp3`），另有《红日》《忘情水》本地留存文件（云端已按用户决定删除、不在 catalog 引用中）。`media/catalog.json` **已入库**（真实编目，不是空模板）；`media/audio|lyrics|covers/` 被 gitignore 覆盖。要跑本机真实曲库：`MEDIA_DIR=D:\ListenTogether\media` 起后端（合成测试音另走 `scripts/start-demo.ps1`）。
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
- 动手实现一个不熟悉的功能前，先搜 GitHub 上的相关开源实现（用 WebSearch/WebFetch 搜 `site:github.com` 或具体库名，本机未装 `gh` CLI）做参考，再写代码；搜到的结论（方案、坑、取舍）在交付说明里简述来源链接。只读参考，不整段拷贝代码，注意许可证。
