# 后端防线上云（E-05 / E-09 / Q-3，2026-09-24 上午）

| 字段 | 内容 |
|---|---|
| 标识 | 后端防线上云（release 20260924-0937）；操作者：AI 会话；结果：**通过（升级成功 + 14/14 + 新防线验证）** |
| 环境 | 本地 main = aac6733（工作区干净）；云端 Ubuntu / 1.7Gi+2G swap / Node 24.9.0；入口 `http://8.166.126.136:3000`；打包制品 `listen-together-0.1.0-20260924-0937.tar.gz`（11.4MB） |
| 时间片 | C1：09:35 声明占用 → 收尾释放；全程轻量 SSH（free/journalctl/systemctl/ss/curl/node 检查脚本） |
| 回滚预案 | `prev=20260922-2159`（真实存在，未动用） |

## 操作序列与实测

1. **预检**（只读）：`health {"ok":true}`（旧版无计数字段，符合预期）、ESTABLISHED=0（零活跃房间）、available 1155MB、NRestarts=0、PID 16099、`current-version.txt` id=20260922-2159 / prev=20260923-2157 成对正确。
2. **打包**：`package-deploy.ps1` → tsc 0 错误 → tar.gz 11.4MB + LF 清单。
3. **上传**：scp tarball + 清单 + `m4-deploy-verify.sh`（Bash 通道）。
4. **基线（旧版本 20260922-2159）**：14 项脚本 **pass=13 fail=0**（第 1 项 health 计数按设计 SKIP——旧版无该字段）；tarball 行 sha256 OK。包内 42 行清单此时不可校验（未解包），移至解包后。
5. **升级**：`releases/20260924-0937` 解包 → **sha256sum -c 42/42 OK** → listen 账号 `npm ci`（0 vulnerabilities）→ `npm run build`（BUILD-EXIT=0）→ `prune --omit=dev` → `chown root:listen + g+rX` → **`current-version.txt` 成对写入 id=20260924-0937 / prev=20260922-2159** → `ln -sfn` → restart。
6. **升级后即时**：health 第 2 秒返回 **`{"ok":true,"rooms":0,"onlineMembers":0,"wsConnections":0}`**（新计数字段生效=新代码在跑的直接证据）；MainPID 16099→20210；NRestarts=0；WorkingDirectory=/opt/listen-together/server 不变。
7. **14 项（新版本）**：**pass=14 fail=0**（对比基线 13+SKIP：health 字段解析与配额预检两项均实 PASS）。
8. **公网可达**：`curl http://8.166.126.136:3000/health` 返回新计数字段。
9. **Q-3 事件通道**：journal 中出现 `room.created / member.joined / member.online / host.transferred / member.offline / member.left`（14 项脚本动作触发），无令牌字段。
10. **E-05 握手限连**（`/tmp/defense-check-20260924.mjs`，同令牌连 6 次）：`open,open,open,open,open,http429`——**PASS**（10 秒窗口 5 次额度，第 6 次 429）。
11. **E-09 存量配额**（同脚本，建房 4 次）：实测 `200,200,429,429`、终态 `rooms=3`——**防线行为正确**。脚本打印 "FAIL" 系验证脚本自身判定参数传错（把 14 项脚本残留的 1 间活跃房间漏算，`expectBase` 传 0 实为 1），非防线缺陷；`200,200,429,429` + rooms=3 正是"起始 1 间、再建 2 间到顶、第 3 次起 429"的精确表现。
12. **终态**：available 1138MB、NRestarts=0、PID 20210；测试房间占同 IP 配额约 5 分钟，空房回收后自动释放（下节复核）。

## 边界（如实标注）

- **真机未回归**：APK E814F90E（A-01/E-07 修复）真机验收待设备在线；本轮验证覆盖服务端与公网 HTTP/WS 层。
- **升级失败注入未做**（与 W3 演练同边界）；本次升级与在产版本存在**实质代码差异**（E-05/E-09/Q-3），覆盖了 W3 演练"同代码新 ID"未能证明的"新代码上线"路径。
- 两次 **restart 各清空一次内存房间**（基线前后无真实用户，预检 rooms=0 确认）。
- 测试房间 5 分钟内占用同 IP 配额（rooms=3），期间本机再建房会 429——自然回收，非缺陷（陷阱 8.9 语义）。
- scp 为入向流量；出网仅几 KB（health/14 项脚本的 HTTP 响应）。

## 复核（部署后 +6 分钟）

- `/health` rooms 计数回落（测试房间空置 5 分钟自动回收）→ 见 verification.md 本轮小节复核行。
- journalctl 无 error 级输出。
