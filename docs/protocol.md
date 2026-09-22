# v1 协议

服务器地址为根地址。JSON 编码 UTF-8；所有时间/进度单位为毫秒。
API 不返回文件系统路径。令牌只传 Authorization: Bearer <token>，不能放进 URL。
错误返回 {"message":"..."}。昵称 1–24 字；邀请码为 8 位大写十六进制字符。

## HTTP

| 方法与路径 | 请求/用途 | 返回 |
|---|---|---|
| GET /health | 存活检查 | {ok:true} |
| POST /api/rooms | {nickname} | {code,memberId,token} |
| POST /api/rooms/:code/join | {nickname} | {code,memberId,token} |
| GET /api/rooms/:code/catalog | 成员令牌 | [{id,title,durationMs}] |
| GET /api/rooms/:code/audio/:id | 成员令牌，可选 Range | audio/mpeg |
| DELETE /api/rooms/:code/membership | 成员令牌 | {ok:true} |

创建和加入按 IP/路由每分钟最多 30 次；最多 100 个活跃房间，每房间最多 15 个成员（含重连宽限中的成员）。
音频支持单段 bytes=start-end、bytes=start-、bytes=-length。正常 200，范围 206，非法/不可满足范围 416。
服务不接受客户端文件路径。没有令牌不能下载曲库或音频。

## WebSocket

连接 /ws/:code，握手请求头携带成员令牌。连接后推送完整 state。
客户端每 5 秒发：
```json
{"type":"sync","clientTimeMs":12345}
```
服务器依次回 clock 与 state：
```json
{"type":"clock","clientTimeMs":12345,"serverTimeMs":1790000000000}
```

state 字段：
- type="state"，code，hostId。
- members=[{id,name,online}]，不包含令牌。
- trackId：字符串或 null；playing：布尔。
- positionMs：基准进度；timestampMs：基准服务端时间。
- serverNowMs：快照发送时间；version：递增状态版本。

指令示例：
```json
{"type":"command","action":"play"}
{"type":"command","action":"pause"}
{"type":"command","action":"select","trackId":"song-01"}
{"type":"command","action":"seek","positionMs":30000}
```
仅房主可发有效控制指令。错误回 {type:"error",status,message}。连接每秒最多 20 条消息，最大消息 4KiB。
断线重连后立即同步，不重放离线期间按钮操作。成员失效时提示重新加入。
服务端 ping 每 15 秒检测死连接。客户端重连等待 1、2、4、8、16 秒，上限 16 秒。

## 校时与播放器

手机采用 elapsedRealtime 单调时钟，避免用户修改日期影响播放。
offset = serverTime - (sent + received)/2。
serverNow = elapsedRealtime + offset。
target = clamp(positionMs + (playing ? max(0,serverNow-timestampMs) : 0),0,durationMs)。

每次快照校准；超过 500ms 时 seek。相同版本可校准时间，较旧版本丢弃。
首次校时前不播放。断线暂停本地播放器，重连恢复完整状态。
缓冲、设备解码和网络不对称都可能产生残余误差，500ms 是验收目标而非保证。
服务器基于真实文件时长推进歌单；手机结束回调不改变全房间状态。

## 生命周期

主动退出房主立即转移；网络掉线 60 秒后转移给按加入顺序最早在线者。
无人在线 5 分钟删除房间。服务重启丢失全部房间。
客户端成员身份只在内存中，不落盘保存令牌；重启 APP 后重新加入。
本地暂停不改变共享状态；恢复跟听直接追到当前房间位置。

音频焦点中断或耳机拔出后，本机保持暂停（房主同样适用），直到明确点击播放。音频错误也会进入本地暂停，点击播放可重新准备播放器重试。周期快照不会解除这些本地暂停。
