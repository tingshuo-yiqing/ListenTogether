# M4 升级/回滚演练（W3 · 云端轨道）

> 任务编号 **T3 / W3**（[并行开发推进方案](../../parallel-development-plan.md)）。本文是**两段式**演练记录：
> 段 1 本地打包可与真机轨道并行（未碰云端），段 2 在收到真机轨道「W2 公网 E2E 已完成」信号后独占云端服务时间片执行。

## 一、标识

| 项 | 内容 |
|---|---|
| 任务编号 | W3（对应 verification「版本回滚演练」项、执行单第 5 节第 4 步） |
| 日期 | 2026-09-23 21:57（段 1）、22:52–22:57（段 2），均为 GMT+8 |
| 操作者 | AI 会话执行全部本地打包、scp/ssh 与云端操作 |
| 结论 | **升级成功 + 回滚成功**（真实版本回滚，非"停用/恢复候选"） |
| 前置信号 | 真机轨道报告 W2 通过（[记录](../2026-09-23-m4-public-e2e/README.md)），并明确"本窗口结束后释放云服务时间片" |
| 云端时间片 | **22:52 声明占用 → 22:57 释放**；期间无其他工作流操作云端（协调规则 C1） |
| 产品代码 / APK | **未改动、未重建**（hash 仍 36BD3A5B…，与 W1/W2 同一锚点） |
| 后端代码 | 新 release 与在产 release **逐文件同源**（`server/` 20 个文件 SHA256 全等），属"同代码新 ID"演练 |

## 二、环境

| 项 | 实测值 |
|---|---|
| 云端 | 阿里云 ECS `8.166.126.136`（Ubuntu 26.04，2vCPU / **内存 1.7Gi + 2G swap**，cn-guangzhou），`ssh aliyun`（root，密钥） |
| 部署基线 | `/opt/listen-together`（`releases/<id>` + `server` 符号链接 + `media` 持久层 + `current-version.txt`） |
| 演练前在产版本 | `releases/20260922-2159`，systemd active，PID 4191，ActiveEnterTimestamp 2026-09-23 12:05:26，**NRestarts=0** |
| 本机 | Windows / Git Bash + PowerShell 5.1；工作区 `D:\ListenTogether` |
| 入口 | `http://8.166.126.136:3000`（IP 明文直连，用户既定的 TLS 路线 A） |
| 曲库 | 云端持久层 `/opt/listen-together/media`：5 首真实 MP3（192kbps），本次**未变更** |
| 公网流量 | 演练对公网出网流量消耗 ≈ 几 KB：scp 为**入向**（不计出网），三次 13 项抽查全部走服务器本地回环 `127.0.0.1:3000`（含两次各 5.8MB 音频传输），公网侧只有 health 探测 |

## 三、操作

### 段 1 · 本地打包（21:57，不碰云端）

```powershell
cd D:\ListenTogether
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\package-deploy.ps1
```

产出与本地核对：

| 项 | 值 |
|---|---|
| 新版本 ID | **20260923-2157** |
| 制品 | `deploy-artifacts/listen-together-0.1.0-20260923-2157.tar.gz`（11.4 MB，打包前 tsc 0 错误） |
| 清单 | `deploy-artifacts/SHA256SUMS-20260923-2157.txt`（35 行 = tarball + 34 包内文件） |
| tarball SHA256 | `61e7eeb99ab152114f3f15b9786c3ffc72d30142f31b6b9d9eb92421fca08ce2`（与清单首行逐字符一致） |
| 包内逐文件核对 | 解包后 `sha256sum -c` → **34/34 OK** |
| 与在产版本同源性 | 与 `20260922-2159` 包的 `server/` **20 个文件哈希全等** |
| 内容合规 | demo-media 按 catalog 过滤，只含 5 个合成测试音，**无个人音频**（陷阱 8.1 过滤生效；包体因此由 20.5MB 降至 11.4MB） |

> 段 1 结束时刻意停在原地：**未上传、未重启、未改云端任何状态**（连只读 curl 也未执行），保持边界干净。

### 段 2 · 云端升级 + 回滚（22:52–22:57）

**① 声明占用时间片 + 确认无活跃房间**（22:52–22:53）

```bash
curl -s -m 8 http://8.166.126.136:3000/health          # {"ok":true}
ssh aliyun "journalctl -u listen-together -n 20 --no-pager"
ssh aliyun "ss -tn state established '( sport = :3000 )' | tail -n +2 | wc -l"   # 0
```

判据：health 200；journal 最近一次重启为 12:05:26、此后 10h50m 无重启、**无房间活动记录**；
端口 3000 **零条 ESTABLISHED**（无 WS 成员在线）。另：W2 的两个房间（83888A9C / 4EC9D5D1）
已于 22:35 由真机显式退出，间隔 18 分钟 > 空房间 300 秒自动删除阈值。→ **确认无活跃房间，可安全重启。**

**② 上传与解包校验**（22:53–22:54）

```bash
scp deploy-artifacts/listen-together-0.1.0-20260923-2157.tar.gz deploy-artifacts/SHA256SUMS-20260923-2157.txt aliyun:/tmp/
# 服务端（照抄 deployment.md 第 5 节，并按下述 CRLF 处置加一步转换）
ssh aliyun 'tr -d "\r" < /tmp/SHA256SUMS-20260923-2157.txt > /tmp/SHA256SUMS-20260923-2157.lf.txt'
ssh aliyun 'mkdir -p /opt/listen-together/releases/20260923-2157 && tar -xzf /tmp/listen-together-0.1.0-20260923-2157.tar.gz -C /opt/listen-together/releases/20260923-2157'
# 校验：tarball 本体 + 包内 34 文件
```

结果：tarball `OK`；包内 **34/34 OK**。清单副本另存 `/opt/listen-together/releases/20260923-2157/SHA256SUMS.txt`（位于 `server/` 之外，便于将来复核）。

> **本轮新坑（已回填陷阱 8.7）**：PowerShell 生成的 `SHA256SUMS` 是 **CRLF** 行尾。`sha256sum -c` 本身容忍 CRLF，
> 但 **GNU grep 的 `$` 锚点不匹配 CR** —— `grep 'tar\.gz$' 清单 | sha256sum -c -` 在服务器上静默拿到空输入，
> 报 `no properly formatted checksum lines found`；而本机 MSYS grep 会自动吞 CR，**同一条命令本地通过、服务器失败**。
> 处置：服务器侧先 `tr -d '\r'`；同时已修正 `scripts/package-deploy.ps1` 今后直接输出 LF 清单。
> **修正后已端到端复跑验证**：新清单 CR 字节数 **0**，服务器 GNU grep `'tar\.gz$'` 由**命中 0 行**变为**命中 1 行**
> （复跑制品 `…-20260923-2258.tar.gz` 仅用于验证清单修正，**不是本次演练的升级锚点**）。

**③ 构建**（22:54，以 listen 账号）

```bash
chown -R listen:listen /opt/listen-together/releases/20260923-2157
cd /opt/listen-together/releases/20260923-2157/server
sudo -u listen env HOME=/tmp npm ci --cache /tmp/npm-cache-listen
sudo -u listen env HOME=/tmp npm run build
sudo -u listen env HOME=/tmp npm prune --omit=dev
chown -R root:listen /opt/listen-together/releases/20260923-2157 && chmod -R g+rX /opt/listen-together/releases/20260923-2157
```

`npm ci` 退出码 0（added 112 packages in 3s）、`npm run build`（tsc）退出码 0、`npm prune` 退出码 0；
`typescript` 已移除，`node_modules` 18M。**全过程 `available` ≥ 1154MB、swap 用量始终 0**，无 OOM 迹象。

**④ 写版本文件并切链接**（22:55:44）

```bash
# 照抄第 5 节：读 prev 必须在切链接之前
PREV=$(readlink /opt/listen-together/server | sed 's|.*/releases/||;s|/server||')   # → 20260922-2159
printf 'id=20260923-2157\nprev=20260922-2159\n' > /opt/listen-together/current-version.txt
ln -sfn /opt/listen-together/releases/20260923-2157/server /opt/listen-together/server
systemctl restart listen-together
```

> 与第 5 节唯一差异：`current-version.txt` **保留 `id=` 行并新增 `prev=` 行**，与首次部署写入的文件
> schema（`id=` / `prev=`）一致；回滚命令 `grep prev= … | cut -d= -f2` 行为不变。

**⑤ 升级验收**：health 第 2 秒 200；`WorkingDirectory=/opt/listen-together/server`、ExecStart 路径不变
（符号链接方案的设计目标）；PID 4191→**14935**、ActiveEnterTimestamp=22:55:44、NRestarts=0；
13 项抽查 **13/0**。

**⑥ 回滚**（22:56:01，照抄第 5 节）

```bash
PREV=$(grep prev= /opt/listen-together/current-version.txt | cut -d= -f2)   # → 20260922-2159
ln -sfn /opt/listen-together/releases/$PREV/server /opt/listen-together/server
systemctl restart listen-together
curl -s http://127.0.0.1:3000/health
```

health 第 2 秒 200；PID 14935→**15175**、ActiveEnterTimestamp=22:56:01、NRestarts=0；13 项抽查 **13/0**；
公网 `http://8.166.126.136:3000/health` = `{"ok":true}`。

> **回滚的读数是"从 current-version.txt 读 prev"**，即演练覆盖了**真实运维路径**（不是手敲版本号切回），
> 这正是首次部署时无法验证的部分。
>
> 回滚片段本身不改写版本文件，故另按 §5 布局注释"**回滚时手工改写**"把它更新为
> `id=20260922-2159` / `prev=20260923-2157`，并做一致性自检（见边界 11）。

## 四、数据

### 4.1 两次重启的判据对照

| 判据 | 演练前 | 升级后（20260923-2157） | 回滚后（20260922-2159） |
|---|---|---|---|
| `readlink /opt/listen-together/server` | releases/20260922-2159/server | releases/**20260923-2157**/server | releases/**20260922-2159**/server |
| ExecMainPID | 4191 | 14935 | 15175 |
| ActiveEnterTimestamp | 12:05:26 | **22:55:44** | **22:56:01** |
| NRestarts | 0 | 0 | 0 |
| `WorkingDirectory` / ExecStart 路径 | /opt/listen-together/server | 同（未变） | 同（未变） |
| health（本地回环） | {"ok":true} | 第 2 秒 {"ok":true} | 第 2 秒 {"ok":true} |
| health（公网 IP 直连） | {"ok":true} | — | {"ok":true} |
| 13 项功能抽查 | 13/0（基线） | **13/0** | **13/0** |
| `current-version.txt` | id=20260922-2159 / prev=(none, first deploy) | id=20260923-2157 / prev=20260922-2159 | 链接切回后**手工改写**为 id=20260922-2159 / prev=20260923-2157（见边界 11、证据 06.1） |
| 受控测试房间 | 建 D611EE22 → catalog 200 | **同 CODE → 404「房间不存在或已过期」** | 建 9BA71413 → 200 → restart 后 **404** |

### 4.2 13 项抽查（脚本 `scripts/m4-deploy-verify.sh`，三次全过）

| 运行 | 版本 | RESULT |
|---|---|---|
| ① 基线（切链接前，验证"仪表"本身正确） | 20260922-2159 | **13 / 0** |
| ② 升级后 | 20260923-2157 | **13 / 0** |
| ③ 回滚后 | 20260922-2159 | **13 / 0** |

覆盖：health、建房取 64 位令牌、catalog 200/条数、catalog 无令牌 401、音频全量 200（5,805,496B）、
`Range 0-1023`→206 `bytes 0-1023/5805496`、后缀 Range→206 500、开区间→206 5,804,472、
越界→416、音频无令牌 401、WS 持令牌 open+sync 回 clock+state、WS 无令牌被拒 401、临时成员退出。

> **脚本修正（本轮）**：原脚本第 4 节硬编码 `demo-soft`、并断言"catalog 恰好 5 首"。
> 云端曲库已于 2026-09-23 中午换成 5 首**真实 MP3**，`media/` 下已无 `demo-soft.mp3` → 原脚本必然失败。
> 已改为从云端 `catalog.json` 自动解析抽查曲目（可用 `TRACK_ID=` 覆盖）与条数，仍为 13 项、语义不变。
> **先跑基线的意义**：若升级后失败，基线通过即可排除"脚本自身坏了"这一混淆因素。

### 4.3 资源与流量

| 项 | 值 |
|---|---|
| 构建期内存 | `available` 531 → 581 → 564 MB（used），最低可用 1154MB；**swap 用量 0** |
| 服务内存峰值（journal） | 旧实例 195.7M（10h50m 运行）、新实例被替换时 72.6M |
| 磁盘 | 演练前后均 6.6→6.7G / 40G（18%） |
| 公网出网流量 | **≈ 几 KB**（三次抽查全部走回环，5.8MB×多段音频不计出网） |

## 五、边界

1. **⚠️ 两次 restart 各清空一次内存房间（如实标注）**：服务端房间为进程内存态（`Map`），
   升级与回滚两次 `systemctl restart` **各清空一次全部房间**。本次已用受控测试房间客观证实
   （D611EE22、9BA71413 均 `200 → 404`）。执行前经 health + `ss`（0 条 ESTABLISHED）+ journal
   三重确认无活跃房间，**未牺牲任何真实用户会话**；但结论必须携带此约束：*在有人使用期间执行升级/回滚
   会造成全员掉线，需重新建房*（协议内行为，见 [protocol.md](../../protocol.md)）。
2. **回滚只验证"代码版本"回滚，不覆盖"数据/配置"回滚**：`media/` 持久层与 `/etc/listen-together.env`
   不在 `releases/` 内，本方案本就不随版本切换；曲库/环境回滚属另一议题，未演练。
3. **"新版本"与在产版本同源**（`server/` 20 文件哈希全等，刻意为之：本就是要制造"上一版/下一版"对）。
   因此本轮**不能证明**"新代码有缺陷时回滚能恢复功能"这一更强命题——真实验收需一次带**实质代码差异**的
   升级。本次已把新 release 保留在服务器，作为将来真实升级的候选。
4. **未做升级失败注入**：没有构造"新版本启动即崩"（如故意坏 dist / 缺依赖）的场景，故
   "`restart` 失败后 systemd 行为、是否需人工回切"未取证。属可选的下一步强化项。
5. **无零停机/健康门禁**：切换靠 `ln -sfn` + `restart`，无 `systemctl reload`、无 readiness 探针、
   无自动回滚触发器；升级窗口内服务不可用约 1–2 秒（health 第 2 秒恢复）。单实例内存态服务的既定形态。
6. **单实例**：不能用多副本滚动升级（协议约束：内存房间不可跨进程共享）。
7. **明文 HTTP**：入口仍为 IP 明文（TLS 路线 A 决策），升级通道走 SSH（加密），但业务流量明文，
   未做窃听/篡改评估。
8. **未触及用户真实使用时段验证**：本次在 22:52 执行，无真实用户在线；"避开使用时段"是纪律而非实测。
9. 观察（非缺陷、非本轮引入）：对**不存在的房间号**携带任意令牌请求 catalog 返回 404 而非 401
   （`auth()` 先 `get(code)` 再比令牌），两个版本一致。
10. **未复验真实令牌作废**（后端无入口，沿用既有标注）。
11. **⚠️ 发现并修正的运维缺口：回滚后 `current-version.txt` 会与实际在产版本不一致。**
    第 5 节的回滚片段只做 `ln -sfn` + `restart`，不改写版本文件；照抄执行后文件仍写着
    `id=20260923-2157`，而实际在产的是 `20260922-2159`。§5 的布局注释本就写明"**回滚时手工改写**"，
    故已手工改写为 `id=20260922-2159` / `prev=20260923-2157` 并加一致性自检（`id` 必须等于 `readlink` 解出的版本；
    `prev` 必须是 `releases/` 下真实存在的 id）。**`prev=` 写成空值或不存在的 id 会让下次回滚切出断链、服务起不来**。
    该自检已写入 [deployment.md 5.1](../../deployment.md) 第 2 条。对回滚命令本身无害（`grep prev=` 是幂等 no-op）。
    原始现象与自检输出见 `evidence/06-version-file-and-lf-fix.txt`。

## 六、清理

| 项 | 状态 |
|---|---|
| 云端最终版本 | `server` 链接指向 **`releases/20260922-2159/server`**（回滚后停在已知良好版本） |
| `current-version.txt` | 手工改写为 `id=20260922-2159` / `prev=20260923-2157`，并通过"id=实际在产 / prev 在 releases/ 下存在"两项自检（见边界 11） |
| 新 release | **保留**在 `/opt/listen-together/releases/20260923-2157/`（含 `server/` 构建产物与 `SHA256SUMS.txt`），供将来真实升级 |
| 受控测试房间 | D611EE22、9BA71413 已随各自 restart 消失（404 实测）；抽查脚本自身的临时成员均已 `DELETE` 退出，房间在 300 秒后自动回收 |
| 云端服务 | active、NRestarts=0、监听 0.0.0.0:3000、health 200；**未改曲库、未改 `/etc/listen-together.env`、未改 nginx** |
| 服务器临时文件 | `/tmp/listen-together-0.1.0-20260923-2157.tar.gz`、`/tmp/SHA256SUMS-20260923-2157{,.lf}.txt`、`/tmp/m4-deploy-verify.sh`、`/tmp/lt-{ci,build,prune}-20260923-2157.log`、`/tmp/lt-verify-20260923-2157.out` **保留**（均为 /tmp，重启即清；便于后续复核，未占用持久层） |
| 本机临时文件 | 解包校验临时目录已删除；`deploy-artifacts/` 保留 tar.gz + 清单（已 gitignore） |
| 时间片 | **22:57 释放**（最终 health 复核通过后） |
| 产品代码 / APK | 未改动、未重建 |

## 七、证据文件

- `evidence/01-package-seg1.log`：段 1 打包脚本完整输出（tsc 0 错误、11.4MB、5 个音频按 catalog 过滤）
- `evidence/02-server-extract-verify.txt`：服务端解包 + **CRLF 口径不对称取证** + 34/34 校验
- `evidence/03-upgrade.txt`：restart 前只读盘点（含 0 条 ESTABLISHED）、升级切换与重启、构建三关、受控房间 200→404
- `evidence/04-rollback.txt`：回滚命令与输出、重启、受控房间 200→404、公网复核
- `evidence/05-verify-13items.txt`：13 项抽查三次运行的完整输出与汇总
- `evidence/06-version-file-and-lf-fix.txt`：两处收尾修正的原始现象与自检输出（`current-version.txt` 一致性、清单改 LF 的服务器端决定性验证）

相关代码与文档变更：`scripts/m4-deploy-verify.sh`（自适应云端曲库）、`scripts/package-deploy.ps1`（清单改 LF）、
`docs/development-pitfalls.md` 8.7（新坑）、`docs/deployment.md` 第 5 节（补充 CRLF 与脚本说明）、
[verification.md](../../verification.md)（本轮新增小节 + 勾选"版本回滚演练"）。
