# 一起听歌 v2 协议（点歌队列）

服务器地址为根地址。JSON 编码 UTF-8；所有时间/进度单位为毫秒。
API 不返回文件系统路径。令牌只传 Authorization: Bearer <token>，不能放进 URL。
错误返回 {"message":"..."}（部分 409 另带机器可读 "code"）。昵称 1–24 字；邀请码为 8 位大写十六进制字符。

v2 切换说明：新后端只创建 v2 队列房间，不再支持全曲库顺播与 select。
兼容矩阵：旧 APK 访问新后端时，建房/加入/受保护 HTTP/WS 握手返回 426 PROTOCOL_UNSUPPORTED（正文含 message）；
新 APK 访问旧服务端时，能力探测 404 或缺头 426，客户端给出「不支持点歌队列，请升级服务端」终态，不进入无限重连。
协议版本按支持集合判定，不比较日期字符串。

## HTTP

| 方法与路径 | 请求/用途 | 返回 |
|---|---|---|
| GET /health | 存活检查 | {ok:true,rooms,onlineMembers,wsConnections} |
| GET /api/capabilities | 无需鉴权 | {protocol:2,features:{queue,catalogSearch,chat},serverNowMs}；404 表示旧服务端 |
| POST /api/rooms ▲ | {nickname} | {code,memberId,token} |
| POST /api/rooms/:code/join ▲ | {nickname} | {code,memberId,token} |
| GET /api/rooms/:code/catalog ▲ | 成员令牌 | [{id,title,durationMs,artist,hasCover,coverVer,hasLyrics,lyricsVer,album}]，未知字段值为 null/false；`lyricsVer` 为歌词内容版本（内容哈希+mtime），客户端歌词缓存键 = id + lyricsVer，无歌词为 null。仅供诊断脚本迁移，新 APK 首屏不整库加载 |
| GET /api/rooms/:code/catalog/search ▲ | 成员令牌 | {catalogRevision,total,offset,items:[同 catalog 字段]}。q≤100 码点、offset 非负安全整数、limit 1–50（默认 30），非法 400；q 规范化（NFKC+小写+合并空白）后对歌名/歌手子串匹配，按规范化歌名→歌手→id 稳定排序；带 revision 且与当前不一致 → 409 {"message","code":"CATALOG_CHANGED"}。catalogRevision 由公开编目内容生成（含封面/歌词版本），同内容恒定（含专辑） |
| GET /api/rooms/:code/audio/:id | 成员令牌，可选 Range | audio/mpeg |
| GET /api/rooms/:code/cover/:id | 成员令牌 | 图片字节（image/jpeg \| image/png \| image/webp，Cache-Control: private, max-age=86400）；无封面 → 404 {"message":"该歌曲没有封面"}。catalog 独立封面优先，未配置时回退 MP3 内嵌封面。封面字节按需读取（QC-D）：不随 catalog 常驻内存，读盘/内嵌重解析经全服 32MiB 字节 LRU、≤4 路并发与同资源在途合并；文件缺失/换坏 → 404 {"message":"封面文件缺失，请联系管理员"}，文件恢复后无需重启 |
| GET /api/rooms/:code/lyrics/:id | 成员令牌 | LRC 原文（text/plain; charset=utf-8，Cache-Control: private, no-store，整读不做 Range）；无歌词 → 404 {"message":"该歌曲没有歌词"}；引用文件已被删除 → 404 {"message":"歌词文件缺失，请联系管理员"} |
| DELETE /api/rooms/:code/membership | 成员令牌 | {ok:true} |

▲ 标记的业务端点要求请求头 `X-ListenTogether-Protocol: 2`，缺失或不支持返回 426 {"message":"..."}；校验先于创建成员。已鉴权的媒体资源（audio/cover/lyrics）与退出清理保持现有可用语义，不要求协议头。
歌词来源为曲库内维护的 `.lrc` 文件（catalog.json 可选 `lyrics` 相对路径；上架时校验 realpath 在库根内、≤256KB，安卓按 `[mm:ss.xx]` 时间戳渲染）。`hasLyrics` 只是布尔提示，歌词文本与磁盘路径都只经该路由按需下发。

创建和加入按 IP/路由每分钟最多 30 次；最多 100 个活跃房间，每房间最多 15 个成员（含重连宽限中的成员）。
`rooms` 为内存房间数，`onlineMembers` 为持有 WS 连接的成员数，`wsConnections` 为当前已升级连接数；三个计数只用于排障，**不构成曲库可用或链路畅通的证明**。
创建房间除限速外还有存量配额：**同一来源 IP 同时最多 3 个活跃房间**，超出返回 429；空房 5 分钟回收后配额自动释放，不按历史累计。
音频支持单段 bytes=start-end、bytes=start-、bytes=-length。正常 200，范围 206，非法/不可满足范围 416。
服务不接受客户端文件路径。没有令牌不能下载曲库或音频。

专辑 `album` 为可空字符串，非空手填值优先于 ID3；未知值为 null。它随全量曲库、搜索结果与当前曲 state 下发并参与 catalogRevision。新增响应字段沿用协议 v2；旧 v2 客户端忽略，新客户端兼容旧 v2 缺字段为 null。

## 房间与队列规则

- 建房从「无当前曲、空队列」开始，不预选任何歌曲。首曲入队时提升为当前曲并保持暂停（positionMs=0、playing=false），房主明确播放后开始。
- 所有成员可点歌：queue.add / queue.addRandom。点歌追加到待播队尾，不替换当前曲；有当前曲时点歌不影响时间基准与播放状态。
- 重复规则：同一歌曲已在当前曲或待播队列时不重复加入（409 TRACK_ALREADY_QUEUED）；当前曲播完后允许再次点。
- 容量与配额：待播队列最多 100 首（409 QUEUE_FULL）；普通成员同时待播最多 5 首（409 MEMBER_QUEUE_LIMIT），当前曲不计个人配额；房主不受个人上限，但受队列总容量约束。房主降为普通成员时不删已有点歌，超限期间只禁止继续添加。
- 随机加入由服务端从完整曲库不放回抽样（同批不重复），候选排除当前曲与待播曲；抽样数量先按最终待播占用（个人配额 + 队列容量）折算，返回实际添加数 addedCount（含空态提升为当前曲的那首）；一首都加不了返回明确原因。重试同一 requestId 返回同一批结果。
- 点歌人离房保留已点歌曲；房主变化不清队列、不清聊天。
- 成员可撤回自己未播放的点歌（queue.remove）；房主可移除任意待播条目、调整顺序（queue.move）、跳过当前曲（skip-next）。重排用 entryId + 锚点 beforeEntryId（null=移到队尾）+ expectedQueueVersion；版本冲突回 409 QUEUE_VERSION_CONFLICT 并随 error 附最新 queue.state，客户端按新状态显示，不静默重放旧排序。
- 当前曲结束：服务端从待播队头取下一项（跳过曲目已失效的条目，扫描次数受队列长度上限约束），positionMs=0、playing=true；没有下一项则清空当前曲并停止。手动跳过同样取队头，保留原 playing。
- 无当前曲时的播放/跳过/回到开头不改状态，返回 409 NO_CURRENT_TRACK。select 已移除：任何人都不能绕过队列直接选歌。
- 「上一首」固定为回到当前曲开头（保留播放/暂停意图），不实现播放历史。

| 触发 | 当前曲/待播变化 | 共享播放结果 |
|---|---|---|
| 当前曲为空时点歌 | 第一项提升为当前曲，其余追加 | positionMs=0、playing=false |
| 有当前曲时点歌/撤回/排序 | 仅改待播队列 | 时间基准、播放状态不变 |
| 自然曲终且有有效待播 | 消费队头，换新 entryId | positionMs=0、playing=true |
| 房主跳过且有有效待播 | 消费队头，换新 entryId | positionMs=0、保留原 playing |
| 曲终或跳过且无有效待播 | 当前曲与待播清空 | positionMs=0、playing=false |
| 没有当前曲时播放/跳过/回到开头 | 不改变状态 | 409 NO_CURRENT_TRACK |

## 即时聊天（QC-C）

- 纯文本，仅房间内广播：服务端统一生成消息 ID、顺序号 seq 与时间戳；同一房间按服务端接受顺序展示。身份由握手与当前成员校验得出，不接受客户端伪造昵称/发送者。
- 限长 500 个 Unicode 码点且 UTF-8 ≤2048 字节（另受单条 WS 输入帧 4096 字节约束）；空白消息拒绝；允许换行和普通表情。每成员聊天限频 10 秒 5 条（滑动窗口，独立于队列/播放配额）。
- 保留本房间最近 100 条内存消息；房间销毁或服务重启即清空，不提供长期历史。seq 连续递增；客户端携带 lastSeq 调 chat.sync 时，服务端在快照中标注 gap（lastSeq < oldestSeq-1 表示中间消息已不可恢复）。
- chat.send 用 clientMessageId 去重（同键重试回放原 ack，不重复发送）；确认与 chat.message 广播可能任意顺序到达，客户端按 messageId/seq 去重，pending 气泡以 senderId+clientMessageId 对齐。
- 快照为逻辑完整快照，按实际 JSON UTF-8 字节分块（每块 ≤32KiB，带 snapshotId/chunkIndex/chunkCount/latestSeq），客户端收齐全部块后原子替换，缺块/超时 5 秒丢弃并请求一次恢复；按 latestSeq 判新旧，snapshotId 只用于归组；旧会话与已退休快照的块不再接收。队列同理按 queueVersion，两个组装器合计 UTF-8 缓冲预算 ≤512KiB。

## 操作去重（所有 v2 有副作用操作）

- 统一带操作 ID 与 issuedAtMs（客户端估计的服务端时间，需先校时）：chat.send 用 clientMessageId，其余用 requestId；ID 为 UUID，重试保留原 ID、时间与输入。
- 去重键 = 房间 + 成员 + 操作 ID；指纹含消息 type、issuedAtMs 与规范化业务输入。同 ID 不同输入 → 409 IDEMPOTENCY_CONFLICT。
- 有效期 = issuedAtMs + 10 分钟；首次接收拒绝超过未来 30 秒（400）或已过期的时间，过期返回 409 REQUEST_EXPIRED，绝不重新执行。操作有效期使用不倒退的服务端时基（不影响播放校时公式）。确认带 expiresAtMs，客户端不能刷新原操作时间延长重试。
- 去重结果覆盖通过身份/校验/时间检查并预留容量后的确定性业务成功或失败（含业务失败如队列满）；解析错误、限频、容量不足不占结果槽位且无副作用，可在未过期时用原 ID 重试。已缓存的业务失败不随条件变化翻盘；用户再次点击是新的操作（新 ID）。
- 容量：每房间最多 10000 条记录 / 4MiB、全服最多 64MiB（D 阶段实测校准）；未过期记录不因 LRU 提前淘汰，满时拒绝新操作并返回 429 DEDUP_CAPACITY（无副作用），已记录操作的重试仍返回原结果；过期清理与房间销毁释放计数。
- 客户端确认超时 5 秒：请求一次对应状态恢复，展示待确认/重试入口，不自动重放；不在重连后盲目重放所有点歌。

## WebSocket

连接 /ws/:code，握手请求头携带成员令牌与 `X-ListenTogether-Protocol: 2`（缺失返回 426）。
连接后推送完整 state 与 queue.state。

握手限连：同一"成员令牌 + 来源 IP"在 10 秒内最多 5 次升级请求，超出返回 HTTP 429（不进入 WebSocket）。
阈值高于客户端 1/2/4/8/16 秒的退避重连节奏，正常断线重连不会被误伤；无效令牌仍是 401。

### 分类限流（滑动窗口，重连不清配额；429 带 retryAfterMs）

| 类别 | 消息 | 配额 |
|---|---|---|
| 播放命令 | command、skip-next | 房主语义，每成员每秒 10 次 |
| 队列操作 | queue.add、queue.addRandom、queue.remove、queue.move | 每成员 10 秒 5 次 |
| 聊天 | chat.send | 每成员 10 秒 5 条 |
| 同步 | sync、queue.sync、chat.sync | 各自每成员每秒 2 次 |
| 硬保护 | 每连接全部输入消息（含未知/重复） | 每秒 100 条，超出以 1008 关闭该连接 |

WS ping/pong 控制帧不进业务配额。重复请求返回已缓存确认时不重复消耗业务配额，但仍受硬保护。schema 校验错误不广播；错误响应同样受发送容量约束。

### 客户端消息

```json
{"type":"sync","clientTimeMs":12345}
{"type":"command","requestId":"<uuid>","issuedAtMs":1790000000000,"action":"play"}
{"type":"command","requestId":"<uuid>","issuedAtMs":1790000000000,"action":"pause"}
{"type":"command","requestId":"<uuid>","issuedAtMs":1790000000000,"action":"seek","positionMs":30000}
{"type":"queue.add","requestId":"<uuid>","issuedAtMs":1790000000000,"trackId":"song-01"}
{"type":"queue.addRandom","requestId":"<uuid>","issuedAtMs":1790000000000,"count":5}
{"type":"queue.remove","requestId":"<uuid>","issuedAtMs":1790000000000,"entryId":"<entry-uuid>"}
{"type":"queue.move","requestId":"<uuid>","issuedAtMs":1790000000000,"entryId":"<entry-uuid>","beforeEntryId":null,"expectedQueueVersion":7}
{"type":"skip-next","requestId":"<uuid>","issuedAtMs":1790000000000}
{"type":"queue.sync"}
{"type":"chat.send","clientMessageId":"<uuid>","issuedAtMs":1790000000000,"text":"大家好"}
{"type":"chat.sync","lastSeq":41}
```

仅房主可发有效 command 与 skip-next。select 已移除。

### 服务端消息

state 字段（entryId 为当前队列条目身份，空曲为 null）：
- type="state"，protocol:2，code，hostId。
- members=[{id,name,online,avatarId}]，不包含令牌。avatarId 由服务端从 15 种内置动物头像中随机分配，在房成员互不重复；离线宽限内保留，同身份重连不重分配，主动退出或清扫后释放。重新加入是新成员身份，再从空闲头像池随机选择（可能再次抽中此前头像）。
- 聊天记录的 senderAvatarId 保存发送时的头像，发送者离房或头像槽位复用不改变历史消息。avatarId / senderAvatarId 在 v2 schema 中可选以兼容此前本地 v2；当前服务端始终下发，客户端缺失或未知 ID 回退昵称字素。
- track：当前曲公开元数据 {id,title,durationMs,artist,hasCover,coverVer,hasLyrics,lyricsVer,album} 或 null；entryId：当前点歌条目 ID 或 null；playing：布尔。
- positionMs：基准进度；timestampMs：基准服务端时间；serverNowMs：快照发送时间；version：递增状态版本（成员或播放状态改变时递增；点歌追加与聊天不使其递增）。

```json
{"type":"clock","clientTimeMs":12345,"serverTimeMs":1790000000000}
{"type":"queue.state","serverNowMs":1790000000000,"queueVersion":7,"entries":[{"entryId":"<uuid>","trackId":"song-01","title":"歌名","artist":"歌手","durationMs":240000,"hasCover":true,"coverVer":123,"requestedBy":"<memberId>","requestedByName":"昵称","requestedAtMs":1790000000000,"source":"manual"}]}
{"type":"ack","requestId":"<uuid>","ok":true,"result":{},"expiresAtMs":1790000600000}
{"type":"ack","requestId":"<uuid>","ok":false,"error":{"status":409,"message":"该歌曲已在队列中"},"expiresAtMs":1790000600000}
{"type":"chat.message","message":{"messageId":"<uuid>","clientMessageId":"<uuid>","seq":42,"senderId":"<memberId>","senderName":"昵称","senderAvatarId":"panda","text":"大家好","createdAtMs":1790000000000}}
{"type":"chat.snapshot","snapshotId":"<uuid>","chunkIndex":0,"chunkCount":1,"latestSeq":42,"oldestSeq":1,"gap":false,"messages":[…同 chat.message.message]}
{"type":"error","status":429,"message":"操作过于频繁","requestId":"<uuid>","retryAfterMs":1200}
```

- queue.state 仅在加入/重连、队列改变或 queue.sync 时下发，entries 为完整待播队列快照（带显示所需元数据与点歌人昵称）。
- ack 是操作 ID 对应的确认结果（command/queue/skip 用 requestId；chat.send 用 clientMessageId，二者必居其一；成功含 result；确定性业务失败 ok:false 并带 error）。聊天广播与快照携带原 clientMessageId，供发送者在 ack 丢失时对账；429 错误也携带输入中的对应 ID，不猜测失败操作。
- 队列与聊天快照均按完整封装后的 JSON UTF-8 字节分块（每块 ≤32KiB，带 snapshotId/chunkIndex/chunkCount），条数上限不替代字节上限。领域层保留完整数组，真实传输层负责分块；尚未开始的同类快照仅保留最新一份，已经发送第一块的快照继续完整发送，事件保持原队列顺序。
- 发送背压硬限：每连接应用层待发 ≤512KiB、全服 ≤64MiB（待发完整批次先计费，send 回调完成后回落）；一帧在途，下一帧会使 socket 缓冲越过 128KiB 时等待回调/drain，已有缓冲 >128KiB 或应用预算超限才以 1013 关闭。同步抛错/回调错误以 1011 关闭；close 释放预算且迟到回调不重复减账，不影响其他成员广播或回滚领域状态。

sync 消息依次回 clock 与 state；重连后立即同步，不重放离线期间按钮操作。断线重连不清成员配额。
成员失效时提示重新加入。服务端 ping 每 15 秒检测死连接。客户端重连等待 1、2、4、8、16 秒，上限 16 秒。

## 校时与播放器

手机采用 elapsedRealtime 单调时钟，避免用户修改日期影响播放。
offset = serverTime - (sent + received)/2。serverNow = elapsedRealtime + offset。
target = clamp(positionMs + (playing ? max(0,serverNow-timestampMs) : 0),0,durationMs)。

每次快照校准；漂移超过 500ms 即需纠正，纠正手段分级：500ms–2.5s 用连续变速追赶（不产生声音缺口），超过 2.5s 才 seek（会丢弃缓冲并重新起流）。相同版本可校准时间，较旧版本丢弃。
首次校时前不播放。断线暂停本地播放器，重连恢复完整状态。
缓冲、设备解码和网络不对称都可能产生残余误差，500ms 是验收目标而非保证。
服务器基于队列推进播放：当前曲按真实文件时长结束即消费队头；手机结束回调不改变全房间状态。
当前曲清空时客户端必须 pause/stop、clearMediaItems、复位实际倍速、清旧封面/歌词/时长与待确认 seek；通知栏不保留旧曲标题或可用的切歌按钮；保留房间连接与聊天。同一 trackId 再次入队按新的 entryId 建立一次播放；媒体身份与资源缓存键分开（资源缓存仍用 trackId+内容版本）。

## 生命周期

主动退出房主立即转移；网络掉线 60 秒后转移给按加入顺序最早在线者。
无人在线 5 分钟删除房间。服务重启丢失全部房间。
客户端成员身份只在内存中，不落盘保存令牌；重启 APP 后重新加入。
本地暂停不改变共享状态；恢复跟听直接追到当前房间位置。用户主动暂停时后续点歌不恢复声音；成员本机暂停具有最高优先级。

音频焦点中断或耳机拔出后，本机保持暂停（房主同样适用），直到明确点击播放。音频错误也会进入本地暂停，点击播放可重新准备播放器重试。周期快照不会解除这些本地暂停。单个客户端的断网/解码失败不能替全房跳歌。

运行时从本节生成校验模块，构建制品无需读取 Markdown；客户端入站严格校验，ID 为 UUID。queue.state 与 chat.snapshot 均按完整 JSON UTF-8 ≤32KiB 分块，收齐后按 queueVersion / latestSeq 原子替换。聊天消息携带 clientMessageId（领域直接造样本时可为 null），用于 ack 丢失时对账。

## JSON Schema（v2 消息契约）

本节的 schema 是 v2 WebSocket 消息的机器可读版本（HTTP 错误体是 `{"message":"..."}`，不在本 schema 范围内）。
它由 `server/test/protocol.test.ts` **直接从本文档提取**，用于校验 `buildApp` 产出的真实消息（state/clock/error/sync/queue.state/ack 与各类客户端消息）；
`additionalProperties:false` 是有意为之——实现新增/改名任何字段而文档漏改，测试就会失败。校验用仓库内的最小实现
（`server/test/mini-schema.ts`），**不引入运行时依赖、不做 codegen**；新增约束请保持在这个关键字集合内。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "一起听歌 v2 WebSocket 消息",
  "oneOf": [
    {
      "$ref": "#/$defs/state"
    },
    {
      "$ref": "#/$defs/clock"
    },
    {
      "$ref": "#/$defs/error"
    },
    {
      "$ref": "#/$defs/sync"
    },
    {
      "$ref": "#/$defs/queueSync"
    },
    {
      "$ref": "#/$defs/command"
    },
    {
      "$ref": "#/$defs/queueAdd"
    },
    {
      "$ref": "#/$defs/queueAddRandom"
    },
    {
      "$ref": "#/$defs/queueRemove"
    },
    {
      "$ref": "#/$defs/queueMove"
    },
    {
      "$ref": "#/$defs/skipNext"
    },
    {
      "$ref": "#/$defs/queueState"
    },
    {
      "$ref": "#/$defs/chatSend"
    },
    {
      "$ref": "#/$defs/chatSync"
    },
    {
      "$ref": "#/$defs/chatMessage"
    },
    {
      "$ref": "#/$defs/chatSnapshot"
    },
    {
      "$ref": "#/$defs/ack"
    }
  ],
  "$defs": {
    "member": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "name",
        "online"
      ],
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 24
        },
        "online": {
          "type": "boolean"
        },
        "avatarId": {
          "$ref": "#/$defs/avatarId"
        }
      }
    },
    "trackSummary": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "title",
        "durationMs",
        "artist",
        "hasCover",
        "coverVer",
        "hasLyrics",
        "lyricsVer",
        "album"
      ],
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "title": {
          "type": "string",
          "minLength": 1
        },
        "durationMs": {
          "type": "integer",
          "minimum": 0
        },
        "artist": {
          "type": [
            "string",
            "null"
          ]
        },
        "hasCover": {
          "type": "boolean"
        },
        "coverVer": {
          "type": [
            "integer",
            "null"
          ]
        },
        "hasLyrics": {
          "type": "boolean"
        },
        "lyricsVer": {
          "type": [
            "integer",
            "null"
          ]
        },
        "album": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "queueEntry": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "entryId",
        "trackId",
        "title",
        "artist",
        "durationMs",
        "hasCover",
        "coverVer",
        "requestedBy",
        "requestedByName",
        "requestedAtMs",
        "source"
      ],
      "properties": {
        "entryId": {
          "type": "string",
          "minLength": 1
        },
        "trackId": {
          "type": "string",
          "minLength": 1
        },
        "title": {
          "type": "string",
          "minLength": 1
        },
        "artist": {
          "type": [
            "string",
            "null"
          ]
        },
        "durationMs": {
          "type": "integer",
          "minimum": 0
        },
        "hasCover": {
          "type": "boolean"
        },
        "coverVer": {
          "type": [
            "integer",
            "null"
          ]
        },
        "requestedBy": {
          "type": "string",
          "minLength": 1
        },
        "requestedByName": {
          "type": "string",
          "minLength": 1
        },
        "requestedAtMs": {
          "type": "integer"
        },
        "source": {
          "enum": [
            "manual",
            "random"
          ]
        }
      }
    },
    "state": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "protocol",
        "code",
        "hostId",
        "members",
        "track",
        "playing",
        "positionMs",
        "timestampMs",
        "serverNowMs",
        "version",
        "entryId"
      ],
      "properties": {
        "type": {
          "const": "state"
        },
        "protocol": {
          "const": 2
        },
        "code": {
          "type": "string",
          "pattern": "^[0-9A-F]{8}$"
        },
        "hostId": {
          "type": "string"
        },
        "members": {
          "type": "array",
          "maxItems": 15,
          "items": {
            "$ref": "#/$defs/member"
          }
        },
        "track": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/trackSummary"
            }
          ]
        },
        "playing": {
          "type": "boolean"
        },
        "positionMs": {
          "type": "number",
          "minimum": 0
        },
        "timestampMs": {
          "type": "number"
        },
        "serverNowMs": {
          "type": "number"
        },
        "version": {
          "type": "integer",
          "minimum": 0
        },
        "entryId": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "clock": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "clientTimeMs",
        "serverTimeMs"
      ],
      "properties": {
        "type": {
          "const": "clock"
        },
        "clientTimeMs": {
          "type": "number"
        },
        "serverTimeMs": {
          "type": "number"
        }
      }
    },
    "error": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "status",
        "message"
      ],
      "properties": {
        "type": {
          "const": "error"
        },
        "status": {
          "type": "integer",
          "minimum": 400,
          "maximum": 599
        },
        "message": {
          "type": "string",
          "minLength": 1
        },
        "code": {
          "type": "string",
          "minLength": 1
        },
        "requestId": {
          "type": "string",
          "minLength": 1
        },
        "retryAfterMs": {
          "type": "integer",
          "minimum": 0
        },
        "clientMessageId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        }
      }
    },
    "sync": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "clientTimeMs"
      ],
      "properties": {
        "type": {
          "const": "sync"
        },
        "clientTimeMs": {
          "type": "number"
        }
      }
    },
    "queueSync": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type"
      ],
      "properties": {
        "type": {
          "const": "queue.sync"
        }
      }
    },
    "command": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "action",
        "requestId",
        "issuedAtMs"
      ],
      "properties": {
        "type": {
          "const": "command"
        },
        "action": {
          "enum": [
            "play",
            "pause",
            "seek"
          ]
        },
        "positionMs": {
          "type": "number",
          "minimum": 0
        },
        "requestId": {
          "type": "string",
          "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
        },
        "issuedAtMs": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      }
    },
    "queueAdd": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "requestId",
        "issuedAtMs",
        "trackId"
      ],
      "properties": {
        "type": {
          "const": "queue.add"
        },
        "requestId": {
          "type": "string",
          "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
        },
        "issuedAtMs": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "trackId": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    "queueAddRandom": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "requestId",
        "issuedAtMs",
        "count"
      ],
      "properties": {
        "type": {
          "const": "queue.addRandom"
        },
        "requestId": {
          "type": "string",
          "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
        },
        "issuedAtMs": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "count": {
          "enum": [
            1,
            5
          ]
        }
      }
    },
    "queueRemove": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "requestId",
        "issuedAtMs",
        "entryId"
      ],
      "properties": {
        "type": {
          "const": "queue.remove"
        },
        "requestId": {
          "type": "string",
          "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
        },
        "issuedAtMs": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "entryId": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    "queueMove": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "requestId",
        "issuedAtMs",
        "entryId",
        "beforeEntryId",
        "expectedQueueVersion"
      ],
      "properties": {
        "type": {
          "const": "queue.move"
        },
        "requestId": {
          "type": "string",
          "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
        },
        "issuedAtMs": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "entryId": {
          "type": "string",
          "minLength": 1
        },
        "beforeEntryId": {
          "type": [
            "string",
            "null"
          ]
        },
        "expectedQueueVersion": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "skipNext": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "requestId",
        "issuedAtMs"
      ],
      "properties": {
        "type": {
          "const": "skip-next"
        },
        "requestId": {
          "type": "string",
          "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
        },
        "issuedAtMs": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      }
    },
    "queueState": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "serverNowMs",
        "queueVersion",
        "entries"
      ],
      "properties": {
        "type": {
          "const": "queue.state"
        },
        "serverNowMs": {
          "type": "number"
        },
        "queueVersion": {
          "type": "integer",
          "minimum": 0
        },
        "entries": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/queueEntry"
          }
        },
        "snapshotId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "chunkIndex": {
          "type": "integer",
          "minimum": 0,
          "maximum": 99
        },
        "chunkCount": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        }
      }
    },
    "chatSend": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "clientMessageId",
        "issuedAtMs",
        "text"
      ],
      "properties": {
        "type": {
          "const": "chat.send"
        },
        "clientMessageId": {
          "type": "string",
          "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
        },
        "issuedAtMs": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      }
    },
    "chatSync": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type"
      ],
      "properties": {
        "type": {
          "const": "chat.sync"
        },
        "lastSeq": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "chatMessage": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "message"
      ],
      "properties": {
        "type": {
          "const": "chat.message"
        },
        "message": {
          "$ref": "#/$defs/chatEntry"
        }
      }
    },
    "chatSnapshot": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "snapshotId",
        "chunkIndex",
        "chunkCount",
        "latestSeq",
        "oldestSeq",
        "gap",
        "messages"
      ],
      "properties": {
        "type": {
          "const": "chat.snapshot"
        },
        "snapshotId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "chunkIndex": {
          "type": "integer",
          "minimum": 0,
          "maximum": 99
        },
        "chunkCount": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "latestSeq": {
          "type": "integer",
          "minimum": 0
        },
        "oldestSeq": {
          "type": [
            "integer",
            "null"
          ]
        },
        "gap": {
          "type": "boolean"
        },
        "messages": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/chatEntry"
          }
        }
      }
    },
    "chatEntry": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "messageId",
        "seq",
        "senderId",
        "senderName",
        "text",
        "createdAtMs",
        "clientMessageId"
      ],
      "properties": {
        "messageId": {
          "type": "string",
          "minLength": 1
        },
        "seq": {
          "type": "integer",
          "minimum": 1
        },
        "senderId": {
          "type": "string",
          "minLength": 1
        },
        "senderName": {
          "type": "string",
          "minLength": 1
        },
        "text": {
          "type": "string",
          "minLength": 1
        },
        "createdAtMs": {
          "type": "integer"
        },
        "clientMessageId": {
          "type": [
            "string",
            "null"
          ]
        },
        "senderAvatarId": {
          "$ref": "#/$defs/avatarId"
        }
      }
    },
    "ack": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "ok",
        "expiresAtMs"
      ],
      "properties": {
        "type": {
          "const": "ack"
        },
        "requestId": {
          "type": "string",
          "minLength": 1
        },
        "clientMessageId": {
          "type": "string",
          "minLength": 1
        },
        "ok": {
          "type": "boolean"
        },
        "result": {
          "type": "object"
        },
        "error": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "status",
            "message"
          ],
          "properties": {
            "status": {
              "type": "integer",
              "minimum": 400,
              "maximum": 599
            },
            "message": {
              "type": "string",
              "minLength": 1
            },
            "code": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "expiresAtMs": {
          "type": "integer"
        }
      }
    },
    "avatarId": {
      "type": "string",
      "enum": [
        "panda",
        "cat",
        "corgi",
        "rabbit",
        "fox",
        "bear",
        "koala",
        "penguin",
        "otter",
        "red_panda",
        "hamster",
        "deer",
        "hedgehog",
        "seal",
        "tiger"
      ]
    }
  }
}
```
