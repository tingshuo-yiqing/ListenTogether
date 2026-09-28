# 2026-09-28 元数据链路真机验收（无线调试）与云端曲库同步

任务：用户要求「开启无线调试，测试元数据脚本功能是否正确——封面是否正常显示、歌词会不会乱码」，中途指示「使用云服务器测试，不要用 127.0.0.1」「media 文件夹本地重构完，云端还没同步」。

## 0. 环境

- 设备 PHQ110 经无线 adb 在线（`adb-fbddbe8-WFMDTR._adb-tls-connect._tcp`，transport 27），无需重新配对。
- 装机 APK 回拉 `20489954` 字节、SHA256 `A586F93C7E7487A8ACB67A4A82170D4AE4F2AF5EBA020DEA42AD9AA826D2E13F`，与 verification「当前交付锚」（09-27 下午轮）逐位一致；且与 09-28 全清重建产物相同（当前 HEAD 源码的可复现构建）。
- 云端入口 `http://8.166.126.136:3000`；本轮起始在产 release `20260927-1240`。

## 1. 发现并修复的两个真实问题

### 1.1 歌词乱码（真机当场抓到）

- 现象：真机播放《有何不可》，第 4 行「抬起頭 數烏雲」渲染为「抬�??頭 數烏雲」（U+FFFD）。截图 `05-playersheet-lyrics.png`。
- 取证：云端 `/opt/listen-together/media/lyrics/he-bu-ke.lrc` 第 4 行 `起`(E8 B5 B7) 在盘上已是 `ef bf bd ef bf bd ef bf bd`（3 个 U+FFFD）；第 26 行同句完好。全库扫描 23 个 `.lrc`：坏 2 个文件 3 行——`he-bu-ke.lrc` 2 行、`te-bie-de-ren.lrc` 1 行（「你就␣␣我要遇見的」缺「不是」）。本地原件全部干净。
- 根因链：`.workbuddy/lyrics.tar.gz`（09-27 12:27 打包的上云原件，本轮解开验证）**内已含坏字节**——tar/scp 传输字节安全，损坏发生在抓取阶段。`scripts/fetch-lrc.mjs` 的 `api()` 用 `data += chunk` 拼接 https 响应 Buffer，**每块被独立按 UTF-8 解码**，跨块边界被切断的汉字整体变 U+FFFD（大 JSON 多块传输，仅个别行中招，与观察完全吻合）。本地 09-27 22:53 重抓的净本走的是管理器 `res.text()` 安全路径，故本地后来是干净的。
- 修复：`fetch-lrc.mjs` 改为 `res.setEncoding('utf8')` 后再拼接；脚本门禁 37/37 复跑通过。云端 3 行坏字节已随本轮全量同步被干净版本取代（坏文件留档 `media-originals/lyrics-corrupt-backup-20260928/`）。

### 1.2 云端封面从未启用（非新缺陷，是部署缺口）

- 现象：同步 media 后真机歌单封面仍是占位、服务端日志无 cover 请求。
- 定位：在产 release 20260927-1240 的 `dist/library/catalog.js` 带 `const cover = null` 置空覆盖（09-27 部署时刻意停用）；真正的封面实现（独立图片优先/ID3 回退/内容版 coverVer，commit `12cb8de`）在仓库 HEAD 但从未发版。
- 修复：按部署手册发 **release 20260928-1718**（server-only，tarball SHA256 `65ac5e50…`；本地门禁服务端 30/30 + tsc 0 错误；服务器侧 npm ci→build→prune→切链接→restart），`m4-deploy-verify.sh` **14/14**；dist 复核置空覆盖已移除，`loadCatalog` 产出 19/21 封面。

## 2. 云端曲库同步（按用户指示，本地重构布局上云）

- **同步前备份（media-originals/，只移不删）**：`media-flat-backup-20260928/`（旧平铺 mp3 ×21、旧 covers ×19、旧 lyrics ×26、旧 catalog.json）；坏歌词另存 `lyrics-corrupt-backup-20260928/`。
- **曲目口径（用户选定）**：云端 catalog 仅 21 首——《红日》《忘情水》为用户当日经云端管理器删除，**保持 21 首**，同步时从 catalog 剔除；两首音频文件仍留本地盘。本地 `media/catalog.json` 亦改为 21 首口径（23 首合并版存档 `.workbuddy/catalog-merged-23-track-record.json`）。
- **合并规则**：本地重构布局为骨架（`audio/<id>.mp3` ASCII 名、`covers/<id>.jpg`、`lyrics/<id>.lrc`），保留云端管理器已应用的 artist/album/year（19/23 有值）；《爱情转移》封面仅云端有，取回按本地命名规则落盘 `covers/ai-qing-zhuan-yi.jpg`。
- **上传包**：`.workbuddy/media-sync-20260928.tar.gz` 127,388,722 字节，SHA256 `048473208e29727d7bcac8f2018338a35ab3fa8decef3df147f7cbfdf6e5c7c9`；音频抽样 md5 本地=云端（纯改名非转码）；落盘后复核 21/19/21、he-bu-ke.lrc md5 与本地净本一致（`ef5a5c4e…`）。
- **重启说明**：本轮两次 restart（media 同步后一次、release 切换一次）均清内存房间；当时仅本轮创建的测试房间（20631CA5 / 7C9418FA），无真实用户影响。

## 3. 真机验收结果（全部通过）

| 项 | 结果 | 证据 |
|---|---|---|
| 建房连云端 | 21 首、歌手副行齐全（许嵩/李圣杰/陈奕迅/G.E.M.邓紫棋/王菲…） | `07`/`09` |
| 歌单行真实封面 | 19/21 真实专辑图，2 首无独立封面按设计占位（《单车》等） | `09-new-room-covers.png` |
| 迷你条/播放页大封面 | 许嵩《自定义》、方大同《危险世界》正常 | `10`/`12` |
| 歌词乱码修复 | 「抬起頭 數烏雲」完整（原「起」字 U+FFFD） | `10-playersheet-cover-lyrics.png` |
| 《特别的人》修复行 | 1:38「你就是我要遇見的 特別的人」完整（原缺「不是」） | `14-te-bie-de-ren-scroll.png` |
| seek 重定位 | 拖到 2:10，当先行加粗跟随正确；繁体混排无乱码 | `11-seek-reposition.png` |
| 切歌 | 连续 9 次下一首从《有何不可》到《特别的人》，逐曲封面/歌词刷新 | `12` |
| 播放状态 | `dumpsys` PLAYING、1.0x（媒体音量未验听感） | journalctl/记录 |
| 歌词缓存 | 客户端坏缓存留证后清除（`device-lyric-cache-corrupt-evidence.lrc`），重新下载为净本 | 目录内留档 |

- 备注：歌词为 lrclib 来源，存在繁简混排（如「樓下/乌云」），属内容原样非乱码。
- 收尾：测试房间已退出，空房按 5 分钟机制回收；未关闭热点、未开飞行模式。

## 4. 未做 / 已知边界

- 通知栏歌手/专辑（第三轮范围）未做；`lyricsVer` 客户端缓存失效仍挂账（本轮靠手动清缓存绕开）。
- 《单车》《倔强》（21 首中无独立封面的 2 首）按设计显示占位，非缺陷。
- 听感验收（媒体音量）未做；双人同屏仍缺第二台设备。
- 本地 `media/` 与云端现已同布局同步（21 首口径）；后续本地增删曲目需再走同步（catalog 是唯一事实源）。
