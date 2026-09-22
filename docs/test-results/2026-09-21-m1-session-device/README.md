# M1 会话状态机真机复测记录

日期：2026-09-21
应用：一起听歌 0.1.0 debug（APK SHA256 139EC36C38A729351833DE01526B9904A2D5483E7E93F44826CE8628D059D839）
环境：PHQ110 真机（OPPO，USB reverse 访问电脑 127.0.0.1:3000）；demo-media 合成曲库；后端进程被测试主动终止一次并重启。
本次为 0.2.0 首批开发任务（SessionContext / ConnectionStatus / ClockEstimator / 诊断 JSONL / 会话边界）的真机回归，不是双机同步验收。

## 测试步骤与证据

| # | 操作 | 实际结果 |
|---|---|---|
| 1 | 卸载旧包后全新安装、USB 转发、启动 | adb install Success；应用进入入房表单 |
| 2 | UI 自动化填写地址/昵称，创建房间 | 邀请码 8EEAC902，房主身份，曲库 2 首，状态显示“已同步”（Ready） |
| 3 | 检查诊断文件 | files/diagnostics/diag-20260921-230813.jsonl 生成；join/socket-open/sync/playback 事件齐全，含 rttMs=307、offsetMs、buffering、correction 字段；全文无 token/Authorization |
| 4 | 选歌 A、播放、暂停 | 媒体会话 PLAYING(3) position=10642 speed=1.0 → PAUSED(2) position=11535 |
| 5 | 强制结束后端进程（模拟服务器死亡） | 状态机进入 Reconnecting，UI 出现“立即重试”按钮，房间信息保留 |
| 6 | 后端保持停止约 30 秒 | 指数退避重连 6 次（1/2/4/8/16 秒，诊断 EOFException/IOException attempt=0..5），无并行连接泄漏 |
| 7 | 重启后端（房间已随进程丢失），等待自动重连 | 重连握手遇 404 → 进入 Expired，提示“房间或成员已失效，请退出后重新加入”，不再无限重试；诊断 event=expired |
| 8 | 点击退出房间 → 重新创建房间 | 新房间 8CDD4EB0（会话代次 generation=3），状态“已同步” |
| 9 | 新会话播放、暂停 | PLAYING(3) position=2284 → PAUSED(2) position=4441 |
| 10 | 全程日志检查 | 诊断事件序列与上述操作一一对应；无 FATAL 异常 |

## 结论

- 连接状态机 Joining → Connecting → Calibrating → Ready / Reconnecting / Expired / 重新加入全链路在真机按预期工作。
- 会话代次隔离：旧会话（gen=1）终止后新会话（gen=3）正常建立，未受旧回调影响。
- 诊断 JSONL 可作为双机测试的采集基础；校时、缓冲、纠正字段均已在真实设备产出。

## 本次不代表已通过

- 第二台手机的真实音频同步误差（M2，仍挂起）。
- 成员本地暂停隔离、房主转移、中途加入（需要第二台手机或更多成员）。
- 长时间锁屏、耳机拔出、音频焦点抢占、弱网代理注入（延迟/受控断线）。
- 云端部署与公网验证。

## 复现命令

```powershell
cd D:\ListenTogether
.\scripts\start-demo.ps1        # 保持窗口运行
.\scripts\install-debug.ps1     # 安装并打开 APP，地址填 http://127.0.0.1:3000
```

故障注入复现：直接结束后端 node 进程观察重连；重启后端观察 404 → 过期提示。
诊断文件位于手机 `files/diagnostics/`（debug 包可用 `adb shell run-as com.listentogether.app …` 读取）。
