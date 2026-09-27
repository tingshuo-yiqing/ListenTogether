# 2026-09-27 白天 · 后端上云（release 20260927-1226：歌词管线 + 7 字段曲库）

用户指示「上云」。把元数据第一二轮的后端改动与 21 份真实歌词部署到试用实例，替换 `20260926-1822`。

- **入口**：`http://8.166.126.136:3000`（路线 A 明文 IP 不变）
- **release**：`20260927-1226`，prev = `20260926-1822`（**可回滚**，`releases/` 下另存 20260922-2159 / 20260923-2157 / 20260924-0937）
- **restart 代价**：清空内存房间（部署前云端有 1 个活动房间；用户已授权部署）

## 1. 部署内容与方式

| 项 | 做法 |
|---|---|
| 后端 | `server/` 源码 + `dist` 打包为 `listen-together-20260927-1226-server-only.tar.gz`（61,953 字节，SHA256 `2020ef25…`），服务器侧 `npm ci` → `npm run build` → `npm prune --omit=dev` |
| 歌词 | `media/lyrics/`（23 个 `.lrc`，含 2 个说明性占位）打成 `lyrics.tar.gz` 解到持久层 `media/` |
| catalog | 云端原 23 条（3 字段）→ 只追加 `lyrics` 引用（**不动 file 中文名、不补 artist**）；由新增 `scripts/build-cloud-catalog.mjs` 在本地生成，避免在服务器上用 sed/node -e 拼中文（陷阱 1.6） |

> **为什么不用 `package-deploy.ps1`**：该脚本会把本地 `media/` 整体打进包，而本地 catalog 是 `<id>.mp3` 的 ASCII 名布局——直接部署会**覆盖云端中文名曲库**。本轮改为手动只打 `server/`，并在服务器侧单独安装歌词与 catalog。脚本本身未改（其设计面向"曲库随包发布"的首次部署场景），差别已记入本记录。

## 2. 部署过程中遇到并解决的问题

- **`npm ci` 失败：`/opt/listen-together/.npm` 缓存被 root 拥有**（npm 历史 bug 留下的 root 文件），报 `EACCES: mkdir …/node_modules/…` 与一串 `TAR_ENTRY_ERROR ENOENT`。**根因是缓存目录归属，不是网络或包损坏**——报错信息却指向 node_modules 里各种文件，容易误判成包坏了。规避：`chown -R listen:listen /opt/listen-together/.npm`，并给部署命令显式加 `npm_config_cache=/tmp/lt-npm-cache`。已回填陷阱 8.11。
- **脚本经 ssh 管道传输时中文被破坏**：`echo "中文"` 这类内容过 PowerShell → ssh 时会串码，连**引号都会被吃掉**，bash 报 `syntax error near unexpected token`。规避：需要执行的脚本一律**先 scp 到服务器再 `bash` 执行**（服务器是 UTF-8 环境），或写成纯 ASCII 输出。已回填陷阱 1.9 补充。
- 首轮部署脚本因中文 echo 触发上述语法错误而中断在解包后，第二次续跑（补缓存归属修复）一次通过。

## 3. 验收证据

### 3.1 服务端功能（部署基线脚本，14 项全过）
`bash scripts/m4-deploy-verify.sh`（在云端执行）：`RESULT pass=14 fail=0`——建房/令牌、catalog 200（23 首）、无令牌 401、全量音频 200、Range 三态（0-1023 / -500 / 1024-）与 416、WS 握手收发 clock+state、无令牌 WS 被拒 401、临时成员退出。

### 3.2 歌词管线专项（公网探针）
| 检查 | 结果 |
|---|---|
| `/health` | `{"ok":true,...}` |
| catalog | 23 首，字段 `id,title,durationMs,artist,hasCover,coverVer,hasLyrics`（7 字段） |
| `hasLyrics=true` | **23/23** |
| 路径泄漏 | 无 `.lrc`/`.mp3`/`/opt` 外泄 |
| `lyrics/he-bu-ke` | 200 · `text/plain; charset=utf-8` · `private, no-store` · 1145 字节，`[00:22.95] 天空好想下雨` 等中文原样 |
| `lyrics/chi-xin-jue-dui` | 200 · 1777 字节（公网拉取复核，繁体中文完整） |
| `lyrics/dan-che`（占位） | 200 · `; 未在 lrclib.net 匹配到带时间戳歌词；曲名「单车」` |
| `lyrics/<不存在>` | 404 `{"message":"歌曲不存在"}` |
| 无令牌 | 401 |
| 音频 | 200 · `audio/mpeg` · 5,805,496 字节 |

### 3.3 服务器侧一致性核对
- 新 catalog 的每条 `lyrics` 引用**逐条 stat 校验**：`lyrics refs ok=23 bad=0`（同时校验对应 mp3 仍在）
- `dist/routes/` 含 `audio.js` + `cover.js` + `lyrics.js`
- 符号链接 `server -> releases/20260927-1226/server`；`current-version.txt` 为 `id=20260927-1226 / prev=20260926-1822`，prev 目录真实存在（陷阱：写成不存在的 id 会让下次回滚切出断链）
- 旧 catalog 备份在 `media-originals/catalog-<时间戳>/catalog.json`

## 4. 未做 / 已知边界
- **设备端对云端新后端的歌词冒烟未做**：验收时用户正在使用手机（前台为其他应用），未强制重启其 APP 打断使用。设备里的 `baseUrl` 已是云端地址，退出重入房间即可看到歌词。**如实标注为未验**。
- **artist 未补**：云端 catalog 仍无 `artist` 字段（保持原样，最小改动）。安卓侧字段缺失显示为空、不占行高，行为安全；若要与本地验收环境一致（显示歌手），用 `scripts/build-cloud-catalog.mjs` 去掉 `--no-artist` 重新生成并重传即可，**不需要重启**（catalog 在启动时加载，改后仍需 restart —— 见陷阱 8.10）。
- `cover`/`coverVer` 仍为停用状态（服务端强制 null），`/cover` 一律 404，界面统一静态占位——与本地一致。
- 回滚命令见 [部署手册第 5 节](../../deployment.md)（`ln -sfn releases/20260926-1822/server` + restart，并手工把 `id=` 改回实际在产版本）。
