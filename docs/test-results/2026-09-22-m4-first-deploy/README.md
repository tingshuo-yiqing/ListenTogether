# M4 首次部署与 SSH 隧道联调（2026-09-22 深夜）

- 标识：M4-ACCESS 第 2/3 步（execution-plan 第 5 节）；操作者：AI 助手；结果：**通过**（服务端功能 13/13、隧道联调 9/9）；公网验证未做，版本回滚未验证（首次部署）
- 授权说明：本轮在服务器实际安装软件（Node 24、2G swap）并创建账号（listen），已获用户明确确认（"这一步会在服务器上实际安装软件和创建账号。现在就开始"）

## 环境（部署后基线）

| 项 | 值 |
| --- | --- |
| 服务器 | 阿里云 iZ640bdwb4odxlZ，Ubuntu 26.04.1 LTS，2 vCPU / 1.7Gi 内存 + 2G swap（/swapfile，fstab 持久）/ 磁盘 6.0G/40G（部署前 3.7G） |
| Node | v24.9.0（官方二进制 → /opt/node24，符号链接 /usr/bin/{node,npm,npx,corepack}；npm 11.6.0；SHASUMS256 校验 OK；apt 候选仅 22.22.1 不满足 engines >=24） |
| 账号 | listen（system，uid 999，/usr/sbin/nologin，home=/opt/listen-together） |
| 部署布局 | /opt/listen-together/releases/20260922-2159/{server,demo-media,deploy,docs,media}；`server -> releases/20260922-2159/server`（符号链接）；media/（5 首 demo 曲库，跨版本持久）；current-version.txt（id=20260922-2159，prev=(none, first deploy)） |
| 服务 | systemd listen-together.service：active + enabled；User=listen；WorkingDirectory=/opt/listen-together/server；ExecStart=/usr/bin/node /opt/listen-together/server/dist/index.js；绑定 127.0.0.1:3000（env：NODE_ENV=production、HOST=127.0.0.1、PORT=3000、MEDIA_DIR=/opt/listen-together/media、TRUST_PROXY=true） |
| 部署包 | listen-together-0.1.0-20260922-2159.tar.gz（20.5MB，SHA256 6c82c51b…8dd4），上传后 tarball 校验 OK + 解包 35 文件逐项 sha256sum -c 全部 OK |
| 权限 | 构建期 chown listen:listen（npm 需写 node_modules）；构建后 chown -R root:listen + chmod -R g+rX 收回写权限（服务只读） |

## 操作与数据

部署序列（全部经 `ssh -o BatchMode=yes aliyun` 执行）：

1. swap：fallocate 2G → mkswap → swapon → fstab 持久；`free -m` Swap=2047（防 npm ci/tsc 在 1.7Gi 内存下 OOM）。
2. Node 24：npmmirror 下载 node-v24.9.0-linux-x64.tar.xz + SHASUMS256.txt → sha256 OK → 解压 → 符号链接 → node v24.9.0 / npm 11.6.0。
3. 账号/目录：useradd listen；/opt/listen-together/releases/20260922-2159。
4. 上传：scp 部署包与 SHA256 清单到 /tmp（21,493,138 字节与本地一致）。
5. 校验 + 解包：tarball OK；解包后 35 文件逐项 OK。
6. 构建（listen 账号）：`env HOME=/tmp npm ci --cache /tmp/npm-cache-listen` → `npm run build`（tsc 0 错误，dist OK）→ `npm prune --omit=dev`（typescript 已移除，剩 69 包）。
7. 锁权 + 布置：chown root:listen + g+rX；media 拷入 5 首 demo 曲 + catalog.json；`ln -sfn …/releases/20260922-2159/server /opt/listen-together/server`；/etc/listen-together.env + /etc/systemd/system/listen-together.service；`systemctl enable --now`；journal 显示 `Server listening at http://127.0.0.1:3000`。
8. 验证：服务端 scripts/m4-deploy-verify.sh → 隧道 scripts/tunnel-verify.mjs。

### 服务端验证 13/13（[server-verify-raw.txt](server-verify-raw.txt)）

| 检查 | 实测 |
| --- | --- |
| health | `{"ok":true}` |
| 建房 | code=85EA324C，token 64 位 |
| 曲库鉴权 | 200，5 首（demo-soft/high/long/hour/load） |
| 曲库无令牌 | 401 |
| 音频全量 | 200，481,114 B |
| Range 0-1023 | 206，1024 B，`content-range: bytes 0-1023/481114` |
| 后缀 -500 | 206，500 B |
| 开区间 1024- | 206，480,090 B |
| 越界 999999999- | 416 |
| 音频无令牌 | 401 |
| WS 持令牌 | open + sync → `state`（connect 即推快照）与 `clock` |
| WS 无令牌 | 升级被拒 401 |
| 退出清理 | `{"ok":true}` |

journal（`-n 6`）仅有启动条目，无错误。

### SSH 隧道联调 9/9（[tunnel-verify-raw.txt](tunnel-verify-raw.txt)）

- 本机 `ssh -N -L 13000:127.0.0.1:3000 aliyun`（本机 3000 被演示后端占用，隧道改用 13000；ExitOnForwardFailure + ServerAliveInterval）。
- scripts/tunnel-verify.mjs（Node 22 fetch + server 本地 ws 模块带 Authorization 头）：health / 建房 6E003857 / 曲库 5 首 / Range 0-1023→206+Content-Range / 后缀 206 / 全量 200 / 无令牌 401 / WS open+state+clock / 退出清理，**9/9 通过**。
- 后端保持回环绑定，未暴露公网，符合"先受限联调"要求。

## 边界与未覆盖

- **公网验证未做**：需显式 HOST=0.0.0.0（或 TLS 反代）+ 安全组放行，再从两种公网网络真机验证；域名/TLS 未盘（用户尚未提供域名）。
- **版本回滚未验证**：首次部署无上一版，仅具备"停用（systemctl stop）/恢复候选（start + health）"条件；未记作回滚通过。
- 15 路云端负载、TLS/公网延迟未测（M4 后续门槛）；升级流程未实跑（本轮即首次部署）。
- 服务器重启后 systemd 自动拉起服务，但内存房间清空（协议内行为）。
- 验证脚本两处自身缺陷（Content-Range 断言取错字段、`node -e` 模式 argv 不含脚本名导致 WS 连错房间号）修复后重跑；最终 13/13 与 9/9 均为修正后单次完整运行，中间轮次不计入结论。

## 纠偏记录

- demo-media 内个人音频「有何不可.mp3」随整目录打包上传（包内存在、catalog 未引用、API 不会提供）：已从服务器 media 与 releases 目录删除；scripts/package-deploy.ps1 已改为按 demo-media/catalog.json 引用过滤打包，后续不会再带入未引用文件。

## 清理

- 服务器：/tmp 的部署包、SHA256 清单、验证脚本、npm 缓存已删；临时成员已退出（空房间 300 秒后自动回收）；无注入残留。
- 本机：SSH 隧道进程已停止（13000 释放）。
- 服务保持运行：listen-together active + enabled（部署基线，供后续公网验证）。
