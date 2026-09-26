# 09 构建、脚本与部署

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
