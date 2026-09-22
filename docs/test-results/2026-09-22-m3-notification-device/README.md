# PHQ110 M3 通知栏/息屏真机记录（2026-09-22）

环境：PHQ110（序列号 fbddbe8）通过 USB reverse 访问本机 127.0.0.1:3000 演示后端；合成测试音（demo-soft 30s / demo-high 45s）。
被测版本：APK `D30EE0EE455C6F16102592896EF11236F74907416A8E6A4546A9AE0D877940FB`（通知栏/息屏两项）。
说明：本次仅系统通知栏按钮与息屏两项为真机验证；其余 M3 项未执行，见文末边界。

## 1. 通知栏媒体按钮实际点击（通过）

此前只验证过 `cmd media_session dispatch`，未真正点击通知栏按钮；本次补上。

操作与证据（同一房间 FE6A54C1，曲目 demo-high）：

| 步骤 | 命令/动作 | 结果 |
|---|---|---|
| 展开通知栏 | `cmd statusbar expand-notifications` | 媒体面板出现本应用会话 |
| 定位按钮 | `uiautomator dump` | `com.android.systemui:id/oplus_media_panel_action_play_or_pause`，content-desc=暂停，bounds [258,605][330,677] |
| 点击前 | `dumpsys media_session` | `PLAYING(3)`，position=992，speed=1.0 |
| 点击暂停 | `input tap 294 641` | — |
| 点击后 2s/5s | `dumpsys media_session` | `PAUSED(2)`，position=3108 冻结，speed=0.0 |

设备诊断 JSONL 同时记录房主指令事件，证明通知栏点击走的是 `ControlledPlayer → setPlaying(false) → 房主 command("pause")`，而不是仅本机暂停：

```text
{"type":"connection","event":"command","roomCode":"FE6A54C1","detail":"pause"}
播放快照 version=4 → 点击后 version=5（服务端已广播新状态）
```

无令牌/Authorization 出现在该文件。

## 2. 息屏期间播放（短时，通过）

1. `cmd media_session dispatch play` 恢复播放，position=5719ms。
2. `input keyevent 26` 息屏，`dumpsys power` 为 `mWakefulness=Dozing`。
3. 保持 Dozing 约 75 秒轮询：媒体会话保持 `PLAYING`，无崩溃，无 FATAL/PlaybackException。
4. 曲目 demo-high 于 position=44543ms 自然播完，会话转为 `PAUSED`（符合“自然播完停止”）。

结论：息屏（Dozing）不中断播放，符合此前短时息屏结论。**本次未做 30/60 分钟长时息屏**。

## 3. 本轮新增代码（未做真机音频错误注入）

`PlaybackFailure`：音频失败提示按 HTTP 状态分类——401 提示“登录已失效，请退出房间后重新加入”、404 提示“音乐文件缺失，暂时无法播放”，其余保留 ExoPlayer 错误码并提示点击播放重试。已接入 `PlaybackService.onPlayerError`，4 项 JVM 单测覆盖（合计 25 项）。

未能真机注入音频错误的原因：demo 测试音仅 30/45 秒，ExoPlayer 在本机环回下会一次性缓冲整文件（buffered position=45035 即文件全长），停后端不再发起 HTTP 请求，无法触发 HTTP 错误。需要更长的测试音（取消一次性缓冲）才能真机验证 401/404 提示。该项**仅单测覆盖，真机待验证**。

## 边界与未验证

- 耳机拔出、来电/其他媒体抢占音频焦点：需要物理拔插或真实通话，未执行。
- 30/60 分钟长时息屏与省电策略：需要长测试音，未执行。
- 上述音频错误提示的真机注入：需要长测试音，未执行。
- 双机同步（M2）：缺第二台手机，继续挂起。
