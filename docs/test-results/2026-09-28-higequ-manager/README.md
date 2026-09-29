# Hi歌曲优先与管理页面优化（2026-09-28）

## 结果与环境
通过。本轮只改本机管理器、启动器、测试与文档。Windows / Node.js v24.21.0 / Chrome headless；不改服务端、协议、安卓和真实 media，不发布云端、不重启播放后端。
云端管理器仍为先前验收记录中的 metadata-03；本轮能力尚未部署到云端。

## 行为
- 默认来源改为 Hi歌曲优先：按歌名读取公开搜索页的前10条，严格核对歌名及歌手（保留版本差异），达阈值才取详情；不执行页面脚本、不请求音频。Hi缺失或失败时依次尝试 QQ、网易云、MusicBrainz，明确选择旧源时保持单源行为。
- 歌名、歌手、专辑来自搜索原文字段，封面来自 og:image，歌词从 lyric-line 的 data-time 秒值转换为 LRC；没有明确提供的年份、流派和时长留空，不拿最后一句歌词冒充时长。Hi歌词缺失时尝试 LRCLIB；未知歌手不盲目套用同名歌。
- Hi页面12秒/2MB上限，进程实例串行且1秒间隔；跳转重新验证同站搜索/详情路径。封面允许实际观察到的 img数字.kuwo.cn 图床，仍经1MB上限与图片格式校验。详情部分失败不缓存，成功详情缓存一天，键含本地画像，页面布局变化或低置信度可重试。
- 单曲匹配只给候选；应用仍走快照票据、整库校验与失败回滚。保留“已有歌词单曲默认勾选替换，批量 onlyIfEmpty 不覆盖”的用户约定。
- 页面新增专辑检索、按缺失字段筛选、歌名/歌手/缺项排序、筛选计数、全库/当前筛选批量范围、停止后续匹配、失败项重新匹配、批量空值→候选预览、实际来源与回退结果、Hi原页面链接、窄屏布局。已有单曲新旧值/歌词预览继续复用。
- 回收站读取原 manifest.jsonl，恢复原条目与文件副本，原回收文件保留；已有ID/同名文件/路径越界拒绝。先验整库，再复制缺失文件，最后写库校验，失败撤销新副本；损坏批次单独报错。
- 双击项目根 start-metadata.cmd 调 scripts/start-metadata.ps1：复用已启动管理器，或隐藏启动本机服务后打开浏览器；日志在 .workbuddy/metadata-manager.stdout.log 与 stderr.log。缺构建产物给出 npm ci/build 指引，不自动装依赖。

## 验证
1. powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check.ps1 -Scope scripts：**47/47**（原37+10），全部离线；包括Hi页面嵌套解析、实体、错身份/版本、越界时间、超时/过大/站外跳转，真管理器优先/降级/应用/删除恢复，恢复冲突、坏库、失败回滚与清单越界。
2. node docs/test-results/2026-09-27-metadata-sources/manager-offline-check.mjs：**85/85**，更新默认源断言，旧三源缓存/上传/共享文件/并发/坏库/删除仍通过。
3. node docs/test-results/2026-09-28-higequ-manager/browser-check.mjs：**Chrome PASS**。HTTP夹具隔离公网，验证单曲勾选/应用、批量补缺、切歌丢弃旧响应、分类与专辑筛选、失败重试保留成功结果、停止、回收恢复、390px无横向溢出、无JS异常。截图 [桌面](candidate-ui.png)、[窄屏](mobile-ui.png) 已目视检查。
4. PowerShell Parser：start-metadata.ps1 零语法错误，UTF-8 BOM；[启动器夹具](launcher-check.ps1) 模拟验证复用、隐藏启动、缺构建产物三条路径（含退出码）；未实际启动后台服务或打开用户浏览器。
5. 真实站点只读抽查：[live-metadata.json](live-metadata.json)。有何不可：置信度0.95，歌词2383字节，JPG 12925字节；单车：0.95，歌词1505字节，JPG 20050字节；晴天首次12秒超时，重试0.95、歌词2488字节。未把抓取结果应用到真实曲库；站点响应会变化，不承诺全库命中。
6. Markdown链接与 git diff --check 收尾执行。

## 开源参考与取舍
动手前搜索 site:github.com higequ，未找到可直接沿用的适配器。
参考 [YouCD/music_metadata 的 provider 接口](https://github.com/YouCD/music_metadata/blob/master/provider/provider.go) 将搜索、歌词、封面分开，统一候选结构；本项目继续使用现有候选票据和旁路文件，不引入其Go工具或音频标签写入。
该仓库目录未见明确LICENSE文件，仅阅读接口设计，无代码复制、无新增第三方依赖。
站点实际结构以 [Hi歌曲搜索](https://higequ.com/s/%E6%99%B4%E5%A4%A9/) 和 [详情](https://higequ.com/player/228908/) 为准；robots.txt 本轮读取返回 Allow: /。

## 边界与清理
浏览器验证为桌面Chrome及窄视口，不是手机真机；真实站点仅抽样，不代表所有歌曲或所有网络。
自动化临时曲库、测试服务与Chrome进程由各驱动finally清理；保留本目录证据。真实曲库与云端未变。

## 2026-09-29 中断恢复收尾
自动审批额度恢复后补验：Chrome夹具新增批量应用409失败→仅重试失败曲→重新匹配票据→应用成功，PASS；精简为仅复制demo-soft.mp3的真管理器夹具复跑PASS。前轮47/47全量单测、85/85离线驱动结论保留。未部署云端、未改真实曲库。

## 2026-09-29 用户反馈修复：旧进程与当前歌词

旧本机 PID 52392 的 /api/sources 实际 default=qq、仅三源；磁盘 HTML 是新版。确认端口归属和命令行后替换为 PID 40440，返回 serviceVersion=20260929-lyrics-preview、default=higequ 与四源。启动器新增版本检查，页面旧版时显示持久提示。此前“未实际启动后台服务”的记录仅描述 09-28 轮，此轮已真实重启本机管理器。

新增已保存歌词只读接口和编辑页折叠预览（重新读取按钮）。真管理器夹具新增无引用/不存在曲目/正常歌词/BOM中文/HTML原文/超限/缺文件/越界校验；预览不写文件。Chrome 新增空缺提示、保存后预览、切歌延迟响应隔离、HTML不执行、服务版本提示；桌面及390px截图已目视。47/47与85/85本轮重新实跑通过，Chrome PASS；启动器四模式 reuse/start=0、missing/old=1。

真实本机只读验证：有何不可联网匹配返回 source=higequ、metadataAccepted=true、lyrics.status=matched，仅一次 Hi命中，无回退；已保存 lyrics/he-bu-ke.lrc 读取1142字符。倔强未填 catalog artist，ID3生效值为 kuwo，未自动改写，需填五月天后保存再匹配。未应用真实候选、未修改真实曲库、未更新云端/安卓/播放后端。

## 恢复人工应用权限

2026-09-29：按用户指令恢复低置信度文字候选的手动应用。单曲 score < minScore 时只提示核对，不默认勾选，但可手动选择艺术家/专辑/年份/流派并应用；批量仍仅消费达标的 changes。资源未匹配到时不伪造封面或歌词候选。Chrome 实测 0.6 < 0.8 候选默认未选、可勾选并提交五月天；85/85接口回归通过。HTML按请求读取，刷新页面即生效，未改真实曲库。
