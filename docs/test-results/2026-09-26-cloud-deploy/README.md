# 2026-09-26 后端上云部署（release 20260926-1822：房主清扫/接任修复上线）

日期：2026-09-26 18:2x–18:3x
操作链路：本机打包 → scp → 解包校验 → listen 构建 → 符号链接切换 → `systemctl restart` → 自检 + 专项验证
上一版：release **20260924-0937**（保留为 `prev`，`releases/` 下目录未动，可随时按 docs/deployment.md 第 5 节回滚）

> 部署内容：09-26「遗留逐项修复」轮的后端改动——①全员超时清扫时清空旧 `hostId`（不再留下指向已移除成员的悬空房主）；②无现存房主时 `connect()` 在首份在线快照前补位（首个上线成员立即接任，不等下一 tick）。客户端（`517A776B`）不含本轮改动，无需重装。

## 前置状态

- 设备端真机复测完成后已退出房间；云端 `health: {rooms:1, onlineMembers:0, wsConnections:0}`（1 个空房待回收）。
- 用户已授权重启清空内存房间（「测完了后上云」）。

## 打包与上传（本机）

- `scripts/package-deploy.ps1`：tsc **0 错误**；产出 `listen-together-0.1.0-20260926-1822.tar.gz`（11.4 MB，含 demo-media 5 支合成曲）+ `SHA256SUMS-20260926-1822.txt`（42 行，LF）。
- scp 上传 /tmp/；tarball 行 `sha256sum -c` **OK**（42 个包内文件行按流程解包后校验）。

## 服务器端

1. 解包至 `/opt/listen-together/releases/20260926-1822/`，`sha256sum -c` **42/42 OK**。
2. `chown -R listen:listen` → `npm ci`（0 vulnerabilities）→ `npm run build`（tsc 0 错误）→ `npm prune --omit=dev`；完成后 `chown -R root:listen` + `chmod -R g+rX` 收回写权限。
3. `current-version.txt` 写成对字段：`id=20260926-1822` / `prev=20260924-0937`。
4. `ln -sfn` 切换 `/opt/listen-together/server` → `releases/20260926-1822/server`；`systemctl restart listen-together`。
5. 重启后：health `{"ok":true,"rooms":0,"onlineMembers":0,"wsConnections":0}`（内存房间清零，协议内行为）；`WorkingDirectory=/opt/listen-together/server`、ExecStart 不变（符号链接切换达成）。

## 自检（m4-deploy-verify.sh 14 项）

| 版本 | 结果 |
|---|---|
| 旧版 20260924-0937（切换前基线） | **pass=14 fail=0** |
| 新版 20260926-1822（切换后） | **pass=14 fail=0** |

覆盖：health 字段解析、catalog 200、音频全量/三种 Range/越界 416/无令牌 401、WS 开放 + sync 回包、无令牌 WS 401、临时成员清理。journal 事件序列（room.created / member.joined / member.online / member.offline / member.left）正常。

## 专项验证：房主清扫 → 首个上线成员接任（本轮修复的行为证明）

服务端 `/tmp/host-cleanup-check.mjs`（房间 8C667A37）：

1. HostA 建房并持 WS → 75s 后进程退出（=掉线）；
2. 再等 75s（离线满 60s 后清扫 tick 移除 HostA，**清空 hostId**）；
3. MemberB `POST /join`（200）并连 WS → 首份状态即 `hostId = MemberB.memberId`（**hostIsB: true**），members 仅 MemberB(online)。

与旧版对照：旧版在全员清扫后 hostId 悬空指向已移除成员、下一成员上线不接任（该缺陷 09-26 本地审计发现并修复，本轮上线）。

## 冒烟与边界（如实标注）

- **设备端对新后端的入房冒烟未做**：第三次 USB 掉线（当日），不再打扰用户重连；新后端已由 14/14 自检、专项验证与全天设备侧同客户端链路覆盖。
- E-05 握手限连 / E-09 建房配额未在本轮重测（09-24 已上线且本轮未改相关代码）；自检脚本与专项验证各建 1 房，均在空房 5 分钟回收窗口内、未触发 429。
- 升级失败注入（演练项）未做，照旧挂起。
