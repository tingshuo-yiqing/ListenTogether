# 09 构建、脚本与部署

## 当前云端发布（2026-10-02 已执行）

已按用户明确授权把全部待交付源码与证据推送 main，并发布后端 20261002-013255（旧 20260928-1815）、管理器 20261002-metadata-v2（旧 metadata-03）。在独立目录 npm ci/build/test、独立 33002 检查21项；正式切换前 room/online/ws=0，失败回滚 trap 就绪。正式与公网各21项通过，两个服务 active/running/NRestarts=0；真实曲库全文件 SHA256、属主/组/权限不变。代码归 root:listen，并收回组/其他写权限。

Ajv 8.18.0，生产审计0；FFmpeg8.0.1供云端管理器 AAC/M4A 导入。只读安卓头像/合成音频夹具用于 Linux 门禁，验后移除，ServerOnly 包仍不带 media/demo-media。旧 helper member-sim 补 v2 HTTP/WS 头，旧 v1忽略该头。

APK 041B4295… 通过已有 Nginx默认站点 /downloads 提供，公网下载与固定副本哈希一致；没有操作手机。完整数据、APK链接与回滚说明见 [发布报告](../test-results/2026-10-02-v2-cloud-release/README.md)。

## 无曲库候选包与失败回滚（2026-10-02）

check-doc-links.mjs 排除 .workbuddy/deploy-artifacts：这些目录里的下载运行时/候选包文档不属于项目文档，避免对 Node 发行包未附源码的链接误报；实际项目 Markdown 继续检查，首次失败日志与修正复跑已归档。

在产后端升级使用 `scripts/package-deploy.ps1 -ServerOnly`，排除 media/demo-media，保留云端持久曲库；默认 Node 从 PATH 取，可 -NodePath 指定，时间戳含秒。旧默认打包行为仍保留，曲库维护不能混用。候选包含 schema 生成脚本与 protocol.md，解包后实际 SHA256 清单验证通过。

本机 WSL/systemd 用生产 service 模板沙箱与 Restart=on-failure/5 秒，实际 dist 的坏入口/缺 node_modules 各触发 NRestarts≥1、ExecMainStatus=1；切回 good 两次恢复健康，5/5，临时服务与目录已收尾。WSL 使用临时 Node 24，未替换系统 Node 18。云端生产失败发布与 v2 部署没有执行。

固定 APK 041b4295…（180/24、Lint 0）未装机，纯后端包与制品 hash 见 [本轮报告](../test-results/2026-10-02-desktop-tasks/README.md)；生产维护命令以部署手册为准。

2026-10-01：协议生成步骤已加入 server 的 predev/prebuild/pretest；部署打包携带 server/scripts 与 docs/protocol.md，远端 npm run build 可从权威文档生成协议 TS。Ajv 为运行时依赖，生成产物不独立维护。只核对打包入口，本轮未运行含真实曲库的部署包或上云；复跑及当前版本见 [修复报告](../test-results/2026-10-01-queue-chat-fixes/README.md)。

## 当前职责与文件
android的Gradle配置固定现有工具链：JDK17、Gradle8.11.1、SDK35，最低Android8.0。
scripts包含后端启动/检查、安卓构建、USB安装、demo启动、真实HTTP/WS smoke。
deploy包含systemd、环境变量和Nginx模板；现阶段没有自动部署到云端。
现有操作说明见 [Ubuntu部署](../deployment.md) 与 [USB联调](../usb-testing.md)。

### 脚本清单（2026-09-25 增补）

| 脚本 | 用途 | 关键约束 |
|---|---|---|
| `scripts/start-demo.ps1` / `build-android.ps1` / `install-debug.ps1` | 演示后端、安卓构建、USB 装机（安装 + `adb reverse` + 启动） | 装机后如需核对版本，用 `pm path` 拉回 base.apk 比 SHA256（W1 轮出现过装机偏差） |
| `scripts/check.ps1 -Scope server\|android\|docs\|all` | 统一门禁 | 安卓段固定 `cleanTestDebugUnitTest`（见陷阱 5.5）；Lint 报告可能被判 UP-TO-DATE 而不重写，取证看 `lint-results-debug.xml` 的 issues 计数 |
| `scripts/check-doc-links.mjs` | Markdown 本地链接检查 | 纯文档轮也要跑 |
| `scripts/load15.mjs` | 15 路并发读取负载（playback / throughput 两种模型分开报告） | 成员必须持 WS，否则被 60 秒清扫 |
| `scripts/fault-proxy.mjs` | 延迟/断线/audio401 故障注入代理 | 端口 3001，配合 `adb reverse` |
| `scripts/member-sim.mjs` | **脚本成员**：`create/join/resume/leave` 四个子命令，用于单机验收"房间动态"（成员进出、掉线、回来、房主转移） | 每个成员必须持 WS（服务端按离线 60 秒清扫纯 HTTP 成员）；`--hold` 到期或进程结束即"掉线"（不发 DELETE）；令牌只打印给调用方、不落文件；逐行 JSON 输出便于与手机界面动态逐条对照 |

`member-sim.mjs` 的典型用法（真机验收场景见 [2026-09-25 批次 A 真机记录](../test-results/2026-09-25-device-batch-a/README.md)）：

```powershell
# 手机先建房并从诊断日志拿到房间码，然后用脚本成员模拟朋友加入/掉线/回来/离开
node scripts/member-sim.mjs join   <房间码> "脚本小王" --hold 20 --target http://8.166.126.136:3000
node scripts/member-sim.mjs resume <房间码> <令牌>   --hold 20 --target http://8.166.126.136:3000
node scripts/member-sim.mjs leave  <房间码> <令牌>                --target http://8.166.126.136:3000
```

## 本地构建与身份
后端使用npm ci锁定依赖，安卓使用Wrapper；构建命令和工具版本写入报告。
debug允许HTTP用于受控联调；发布配置使用HTTPS/WSS。
APK版本号、hash、测试报告作为一次交付的整体。debug签名不能被描述为正式发布签名。
local.properties、私钥、令牌不进版本库。未来正式签名配置从本机私有配置读取，不写进脚本。

## 下一阶段
统一检查入口 scripts/check.ps1 支持后端、安卓和文档链接验证，保留按范围单独运行：-Scope server|android|docs。
入口函数只在调用原生工具期间收窄 $ErrorActionPreference（见 [陷阱 1.5/1.6](../development-pitfalls.md)），成败只认 $LASTEXITCODE。
安卓段固定 `:app:cleanTestDebugUnitTest :app:testDebugUnitTest`：Gradle 增量构建会把"输入未变"的测试任务判 UP-TO-DATE 并跳过实跑，
加上清理任务后，门禁里的"测试通过"必然来自本轮执行（见 [陷阱 5.5](../development-pitfalls.md)）。
将USB脚本的设备选择、端口冲突、未授权设备、安装失败变成明确提示；不自动修改用户防火墙。
演示脚本记录自身启动进程，提供只停止该进程的方式，避免用户误杀别的Node服务。
构建后输出版本/签名校验/hash和设备安装说明，避免多个同名APK混淆。
这一阶段保持现有依赖主版本，不因新版本可用就进行无关升级。

## 云端M4执行方案
先确认实例CPU/内存/磁盘/出网带宽、流量权益和域名条件；不默认提高付费配置。
单实例、一个Node进程、Nginx终止TLS；服务仅监听127.0.0.1，公网由80/443入口提供。
先验证health，再以短期测试成员访问曲库/Range/WS，完成后退出测试房间。
记录部署前配置与上一版制品；在独立版本目录准备候选，检查通过后切换并重启。
回滚切回上一版本并重启；必须提示房间是内存状态，切换/重启会结束现有房间。
明确服务用户读取权限、日志保留、证书续期与reload检查。现有部署文档继续作为命令来源。

## 验收
Windows与Ubuntu启动路径可复现；配置缺失给出说明，不默默使用错误目录。
TLS与WS升级、Range响应、进程异常恢复和回滚分别检查。
从两种公网网络测试手机连接；记录费用/流量采样，不用localhost成功替代公网验收。

## 核心注释与记录
脚本说明参数/依赖/退出码/副作用；服务配置说明运行身份和重启影响；代理说明来源信任、升级头和超时。
2026-09-21：本地构建/USB安装已通过；云端与停止脚本改进待实施。
2026-09-22：统一检查入口补齐后端构建/测试、安卓单测/Debug/Lint 和 Markdown 本地链接检查；默认 -Scope all，三类检查可独立运行。

## 部署状态（2026-09-26 更新）
**云端已部署且升级/回滚演练双向通过**（2026-09-23 晚，见 [m4-rollback-drill](../test-results/2026-09-23-m4-rollback-drill/README.md)），早期 SSH 公钥阻塞已关闭（见 [部署第 0 节](../deployment.md)）。版本目录方案 = `releases/<id>` + `server` 符号链接，升级/回滚命令与验收见 [deployment.md 第 5 节](../deployment.md)。

2026-09-26：**release 20260926-1822 在产**（prev=20260924-0937）——09-26 后端修复（清扫清空 hostId + 首个上线成员立即接任）上云；42/42 解包校验、旧/新版本 `m4-deploy-verify.sh` 各 14/14、专项验证（HostA 掉线被清扫 → MemberB 加入即接任 hostId=MemberB）通过。见 [2026-09-26 云端部署](../test-results/2026-09-26-cloud-deploy/README.md)。

## 管理器一键启动（2026-09-28）
双击项目根 `start-metadata.cmd`，调用 `scripts/start-metadata.ps1`。若127.0.0.1:3100已有管理器则直接打开，否则以Hidden窗口启动Node，最多轮询40次后打开浏览器。
日志：`.workbuddy/metadata-manager.stdout.log` / `metadata-manager.stderr.log`；缺少server/dist时明确提示先npm ci/build，不自动安装依赖、不停止占用端口的进程、不重启播放后端。
本机脚本门禁使用 `scripts/check.ps1 -Scope scripts`。启动器PowerShell语法与三分支隔离夹具验证通过；实际后台驻留及默认浏览器打开未在本轮触发，详见[本轮记录](../test-results/2026-09-28-higequ-manager/README.md)。

2026-09-29：管理器 /api/sources 增 serviceVersion=20260929-lyrics-preview；启动器仅复用同版本，旧版提示先停止旧 metadata-manager 再启动。HTML 更新不等于 Node 模块更新；本轮只重启本机 3100 管理器，未触及播放后端和云端。
