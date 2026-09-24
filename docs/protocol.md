# v1 协议

服务器地址为根地址。JSON 编码 UTF-8；所有时间/进度单位为毫秒。
API 不返回文件系统路径。令牌只传 Authorization: Bearer <token>，不能放进 URL。
错误返回 {"message":"..."}。昵称 1–24 字；邀请码为 8 位大写十六进制字符。

## HTTP

| 方法与路径 | 请求/用途 | 返回 |
|---|---|---|
| GET /health | 存活检查 | {ok:true,rooms,onlineMembers,wsConnections} |
| POST /api/rooms | {nickname} | {code,memberId,token} |
| POST /api/rooms/:code/join | {nickname} | {code,memberId,token} |
| GET /api/rooms/:code/catalog | 成员令牌 | [{id,title,durationMs}] |
| GET /api/rooms/:code/audio/:id | 成员令牌，可选 Range | audio/mpeg |
| DELETE /api/rooms/:code/membership | 成员令牌 | {ok:true} |

创建和加入按 IP/路由每分钟最多 30 次；最多 100 个活跃房间，每房间最多 15 个成员（含重连宽限中的成员）。
`rooms` 为内存房间数，`onlineMembers` 为持有 WS 连接的成员数，`wsConnections` 为当前已升级连接数；
三个计数只用于排障，**不构成曲库可用或链路畅通的证明**。
创建房间除限速外还有存量配额：**同一来源 IP 同时最多 3 个活跃房间**，超出返回 429
`{"message":"同一来源最多同时创建 3 个房间，请先使用已有房间"}`；空房 5 分钟回收后配额自动释放，不按历史累计。
音频支持单段 bytes=start-end、bytes=start-、bytes=-length。正常 200，范围 206，非法/不可满足范围 416。
服务不接受客户端文件路径。没有令牌不能下载曲库或音频。

## WebSocket

连接 /ws/:code，握手请求头携带成员令牌。连接后推送完整 state。
握手限连：同一"成员令牌 + 来源 IP"在 10 秒内最多 5 次升级请求，超出返回 HTTP 429
`{"message":"连接过于频繁，请稍后重试"}`（不进入 WebSocket）。阈值高于客户端 1/2/4/8/16 秒的退避重连节奏，
正常断线重连不会被误伤；无效令牌仍是 401。
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

每次快照校准；漂移超过 500ms 即需纠正，纠正手段分级：500ms–2.5s 用连续变速追赶（不产生声音缺口），超过 2.5s 才 seek（会丢弃缓冲并重新起流）。相同版本可校准时间，较旧版本丢弃。
首次校时前不播放。断线暂停本地播放器，重连恢复完整状态。
缓冲、设备解码和网络不对称都可能产生残余误差，500ms 是验收目标而非保证。
服务器基于真实文件时长推进歌单；手机结束回调不改变全房间状态。

## 生命周期

主动退出房主立即转移；网络掉线 60 秒后转移给按加入顺序最早在线者。
无人在线 5 分钟删除房间。服务重启丢失全部房间。
客户端成员身份只在内存中，不落盘保存令牌；重启 APP 后重新加入。
本地暂停不改变共享状态；恢复跟听直接追到当前房间位置。

音频焦点中断或耳机拔出后，本机保持暂停（房主同样适用），直到明确点击播放。音频错误也会进入本地暂停，点击播放可重新准备播放器重试。周期快照不会解除这些本地暂停。

## JSON Schema（v1 消息契约）

本节的 schema 是上述 WebSocket 消息的机器可读版本（HTTP 错误体是 `{"message":"..."}`，见 HTTP 表，不在本 schema 范围内）。
它由 `server/test/protocol.test.ts` **直接从本文档提取**，用于校验 `buildApp` 产出的真实消息（快照与 sync/clock/command/error）；
`additionalProperties:false` 是有意为之——实现新增/改名任何字段而文档漏改，测试就会失败。校验用仓库内的最小实现
（`server/test/mini-schema.ts`，支持 `$ref/type/const/enum/required/properties/additionalProperties/items/minLength/maxLength/minimum/maximum/maxItems/pattern/oneOf`），
**不引入运行时依赖、不做 codegen**；新增约束请保持在这个关键字集合内。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "一起听歌 v1 WebSocket 消息",
  "oneOf": [
    { "$ref": "#/$defs/state" },
    { "$ref": "#/$defs/clock" },
    { "$ref": "#/$defs/error" },
    { "$ref": "#/$defs/sync" },
    { "$ref": "#/$defs/command" }
  ],
  "$defs": {
    "member": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "name", "online"],
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string", "minLength": 1, "maxLength": 24 },
        "online": { "type": "boolean" }
      }
    },
    "state": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "code", "hostId", "members", "trackId", "playing", "positionMs", "timestampMs", "serverNowMs", "version"],
      "properties": {
        "type": { "const": "state" },
        "code": { "type": "string", "pattern": "^[0-9A-F]{8}$" },
        "hostId": { "type": "string" },
        "members": { "type": "array", "maxItems": 15, "items": { "$ref": "#/$defs/member" } },
        "trackId": { "type": ["string", "null"] },
        "playing": { "type": "boolean" },
        "positionMs": { "type": "number", "minimum": 0 },
        "timestampMs": { "type": "number" },
        "serverNowMs": { "type": "number" },
        "version": { "type": "integer", "minimum": 0 }
      }
    },
    "clock": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "clientTimeMs", "serverTimeMs"],
      "properties": {
        "type": { "const": "clock" },
        "clientTimeMs": { "type": "number" },
        "serverTimeMs": { "type": "number" }
      }
    },
    "error": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "status", "message"],
      "properties": {
        "type": { "const": "error" },
        "status": { "type": "integer", "minimum": 400, "maximum": 599 },
        "message": { "type": "string", "minLength": 1 }
      }
    },
    "sync": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "clientTimeMs"],
      "properties": {
        "type": { "const": "sync" },
        "clientTimeMs": { "type": "number" }
      }
    },
    "command": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "action"],
      "properties": {
        "type": { "const": "command" },
        "action": { "enum": ["play", "pause", "seek", "select"] },
        "trackId": { "type": "string" },
        "positionMs": { "type": "number", "minimum": 0 }
      }
    }
  }
}
```

