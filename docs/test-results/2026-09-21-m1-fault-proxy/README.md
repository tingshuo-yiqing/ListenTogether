# M1 故障注入真机测试记录（本地代理）

日期：2026-09-21
应用：一起听歌 0.1.0 debug（APK SHA256 139EC36C38A729351833DE01526B9904A2D5483E7E93F44826CE8628D059D839）
环境：PHQ110 真机；链路为 手机 → adb reverse:3001 → fault-proxy(3001) → 后端(3000)；demo-media 合成曲库。
工具：`scripts/fault-proxy.mjs`（HTTP+WS 故障注入代理）+ `scripts/fault-proxy-selftest.mjs`（脚本自测）。

## 代理自测（无手机，脚本客户端）

| 场景 | 结果 |
|---|---|
| A HTTP 透传 | PASS，/health 14ms |
| B 延迟注入 300ms | PASS，/health 实测 626ms（请求+响应各 300ms） |
| C WS 经代理建立并收到快照 | PASS |
| D1 断线窗口内新连接被拒 | PASS |
| D2 既有连接被切断 | PASS |
| D3 窗口结束自动恢复 | PASS |

## 真机场景（诊断 JSONL + 代理日志对齐）

### 场景 1：RTT 延迟注入 300ms（双向）
- 注入前基线校时 RTT ≈ 307ms（见 m1-session-device 记录）。
- 注入后 sync 样本 RTT = **644 / 643 ms**，符合 300×2+开销 预期。
- 连接状态保持 Ready；offset 估计稳定；ClockEstimator 在 RTT≤1500ms 内正常取最短样本。

### 场景 2：受控断线 12 秒（注入→检测→恢复）
| 时刻 | 事件 | 证据 |
|---|---|---|
| +0s | `cut?seconds=12` | 代理日志 fault-cut |
| ≈+1s | 客户端检测 EOF，进入 Reconnecting | 诊断 `reconnecting EOFException attempt=0` |
| +1/+2/+4/+8s | 退避重连均被窗口拒绝 | 诊断 `IOException attempt=1..3` |
| +5s | UI 呈现"立即重试"按钮 | uiautomator dump |
| ≈+17s | 窗口结束后首个重试命中，恢复 Ready | 诊断 `socket-open generation=3`；UI"已同步" |

恢复耗时 = 窗口时长 + 一次退避间隔（本例 8s 档），符合退避设计；无并行连接泄漏（代理 tunnels 计数归一）。

### 场景 3（意外收获）：USB 抖动导致离线超过 60 秒宽限
- adb reverse 因 USB 重插被清空，手机离线约 142 秒（重连 ConnectException attempt=1..10）。
- 服务端 60 秒成员宽限到期后，WS 握手返回 404 → 客户端 `ProtocolException` → **Expired**，提示"房间或成员已失效，请退出后重新加入"，不再重试。
- 该路径与 02 模块文档验收场景"重连宽限以服务器 offlineAt 为准"一致，属真实数据点。

## 已知局限

- 场景 1-3 均为房主单机；成员角色、本地暂停隔离、双机同步误差仍挂起（缺第二台手机）。
- 代理只注入延迟与断线；401 注入、缺失 MP3、服务器进程重启复用上一轮记录（m1-session-device）。
- 第二次故障期间 proxy 端 `delayMs=300` 未及时清零属操作顺序问题，不影响结论（恢复后已清零）。
- USB 重插会清空 adb reverse 规则：测试中需重新执行 `adb reverse tcp:3001 tcp:3001`。

## 复现命令

```powershell
cd D:\ListenTogether
.\scripts\start-demo.ps1                                  # 后端 3000
node scripts\fault-proxy.mjs --port 3001 --target http://127.0.0.1:3000   # 代理
node scripts\fault-proxy-selftest.mjs                     # 无手机自测
$adb reverse tcp:3001 tcp:3001                            # 手机地址填 http://127.0.0.1:3001
# 管理命令：http://127.0.0.1:3001/__fault/{status,delay?ms=N,cut?seconds=N,clear}
```
