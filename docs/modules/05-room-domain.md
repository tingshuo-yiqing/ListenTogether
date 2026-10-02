# 05 后端房间领域

2026-10-01 最新交付见 [动物头像与双主题报告](../test-results/2026-10-01-animal-avatars/README.md)及 [verification](../verification.md)：server 70/70、安卓 177 项/23 套件、Lint 0；当前 APK 89E90EEB… 已覆盖安装 PHQ110，随机唯一头像、重叠排列与双主题真机通过。ACC 完整设备矩阵与发布仍待验，历史结果及设备版本保留在 [修复报告](../test-results/2026-10-01-queue-chat-fixes/README.md)。

最新领域边界：ChatMessage 下发可空 clientMessageId 以关联原操作。去重在执行前预留结果容量，指纹 SHA256，恰好 issuedAtMs+10 分钟即过期；每房间 4MiB/10000 条、全服 64MiB，以实际存储计费，压力下清理其他房间过期记录，销毁释放。失效队列使用初始长度扫描预算，连续无效前缀后提升有效曲，全无效完整消费并停止。

## 职责与入口
rooms/store.ts 中的 Rooms 管理所有共享房间状态，保持单进程内存模型。
Room 保存 code、creatorIp、hostId、members、currentEntry、queue、queueVersion、chat、chatSeq、playing、positionMs、timestampMs、version。state 从 currentEntry 派生 track 与 entryId，队列/聊天独立快照。
Member 保存身份、令牌、加入/离线时间及当前连接回调；snapshot 只发布公开成员信息。
创建者 IP 只用于存量配额与排障事件，不参与鉴权；snapshot 不下发该字段。

## 当前领域操作

2026-10-01 动物头像：`rooms/avatars.ts` 定义 15 种稳定 ID；create/add 在同步临界区从未被 room.members 占用的池中用 crypto.randomInt 等概率选择。离线成员在宽限内仍占用头像，connect/房主转移不重分配；leave/tick 移除成员后空槽可再用，新入房重新随机（可再次抽中旧头像）。snapshot 下发公开 avatarId，chatSend 从认证成员保存 senderAvatarId 到消息；离房和槽位复用不改变历史聊天身份。协议/安卓资源枚举有一致性回归，满房、重连、离房、清扫、跨房和真实 WS 见 [头像验收](../test-results/2026-10-01-animal-avatars/README.md)。
create/add 校验昵称和容量，最多100房间、每房间15个成员；另按创建者 IP 限存量：同 IP 活跃房间 ≤3（IP_ROOM_QUOTA，超出 Fault 429）。
roomsOf(ip) 遍历内存房间表计数，房间被空房回收后自然释放配额；onlineMembers() 汇总持有 WS 的成员数供 /health 使用。
auth 根据房间和成员令牌鉴权；command 再检查房主权限并验证操作。
connect 替换同一成员旧连接，关闭回调用引用比较保护新连接。
command 先结算现有进度，再应用操作和时间基准，最后递增version并广播（v2 起 select 已移除、play/pause/seek 需当前曲）。
leave 主动移除成员（保留其已点歌曲）；tick 每250ms处理曲终推进（v2 起按队列消费队头）、离线成员和空房清理。
领域事件（events.ts 的 ServerEvent/EventSink）覆盖 room.created/room.deleted、host.transferred、
member.joined/online/offline/left/removed 及 queue.added/removed/moved/skipped/advanced/entry_skipped；
只带房间码与成员 ID，禁止令牌与昵称。

## 生命周期
主动退出房主立即转给最早在线成员；网络断开以服务器close检测时刻记录offlineAt。
60秒宽限到期后离线成员被移除；房主转移给最早加入的在线成员。
无人在线后5分钟删除房间（同时释放该 IP 的存量配额）。没有在线成员时不选离线房主；后续有人在线再决定。
宽限中的成员仍占容量。最后一首自然耗尽清空当前曲并停止；skip-next 消费待播并保留共享播放/暂停意图。
存量配额只算"当前在内存里的活跃房间"：创建者本人退房、房间空置到回收，配额随之释放。

## 下一阶段
把时间读取抽为可注入时钟，领域期限不受系统日期调整影响。
保留原子更新：所有验证通过前不改状态，状态更新到广播之间不等待外部IO。
以确定性测试覆盖恰好60秒、房主重连与tick交错、旧close迟到、最后成员退出后新成员加入。
广播回调异常不能影响其他房间；在传输边界隔离异常，不把网络写入失败变成半更新领域状态。
不引入数据库；跨进程共享、服务重启恢复另立需求。
2026-09-30（QC-A）：公开编目索引 `library/catalog-index.ts` 已建立（按 ID O(1) 查找 / 稳定排序 / 内容 revision / 分页检索），供 v2 房间接入；房间队列（QueueEntry、独立 queueVersion、按队列推进、成员点歌权限）与 store.ts 线性 find 的迁移属 QC-B1，此为 QC-A 时点的历史状态；QC-B1 已接 v2 队列与索引，当前实现见下节。

## 接口与错误（v2，2026-09-30 QC-B1）
（2026-09-30 QC-B1 起，后端只创建 v2 队列房间）create 从「无当前曲、空队列」开始；首曲入队提升为当前曲并保持暂停。
队列操作：queueAdd（成员点歌，重复 409 TRACK_ALREADY_QUEUED、队列 100 上限 QUEUE_FULL、普通成员 5 首待播 MEMBER_QUEUE_LIMIT）、
queueAddRandom（服务端全库不放回抽样、候选排除当前/待播、按最终待播占用折算、addedCount 部分成功）、
queueRemove（成员撤自己的、房主任意）、queueMove（仅房主，entryId+beforeEntryId+expectedQueueVersion，冲突 409 QUEUE_VERSION_CONFLICT）、
skipNext（仅房主，消费队头保留原 playing）。自然曲终由 tick 消费队头（playing=true）；无待播则清空当前曲停止。
命令只剩 play/pause/seek（select 已移除）；无当前曲时播放/跳过 409 NO_CURRENT_TRACK。
点歌人离房保留已点歌曲；房主变化不清队列；队列变化广播 queue.state（独立 queueVersion，不递增播放 version），
当前曲变化广播 state。去重记录随房间销毁释放（rooms/dedupe.ts）。
Fault 携带 statusCode + 用户消息 + 可选机器码（NO_CURRENT_TRACK/TRACK_NOT_FOUND/TRACK_ALREADY_QUEUED/QUEUE_FULL/MEMBER_QUEUE_LIMIT/QUEUE_VERSION_CONFLICT 等），
令牌无效 401、非房主 403、房间缺失 404、满员 409。播放 version 每次状态广播递增（含成员变化），queueVersion 独立递增；
客户端不能假设每个 version 都代表播放指令。position 计算必须限制在 duration 范围。

## 验收
通过可控时钟验证每个边界，不通过sleep几十秒等待单元测试。
15席、退出后补位、重连不重复占席、旧连接close不踢掉新连接、连续房主转移均有回归。
同 IP 存量配额（第 4 间被拒、被拒不占额度、换 IP 不受影响、空房回收后释放）与事件日志红线
（覆盖全生命周期且不含令牌/昵称）见 [10 测试](10-testing-observability.md)；真实双机再验证用户体验：另一台显示新房主且权限随之更新。

## 核心注释与记录
Room/Member字段写所有权和单位；command写“先验证再结算”；tick说明检测时间与实际断网时间的区别；connect写旧连接竞态。
2026-09-21：领域实现已存在；补边界测试和时钟抽象为下一阶段任务。
2026-09-24：新增创建者 IP 存量配额与结构化领域事件；事件红线（无令牌/昵称）用单测钉住。

## 2026-09-26 遗留修复：清扫房主与重新接任
全员离线且宽限到期时，tick 将 hostId 清为空串（现有协议允许），不再引用已删除成员；重复 tick 不重复产生转移事件。没有现存房主时，connect 在第一份在线快照广播前选最早加入的在线成员，消除最多 250ms 的无房主权限窗口。仍在宽限中的房主不被抢占。新增 3 项可控时钟回归，后端共 23 项。**已随 release 20260926-1822 部署上云并通过专项验证**（见 [2026-09-26 云端部署](../test-results/2026-09-26-cloud-deploy/README.md)）。
