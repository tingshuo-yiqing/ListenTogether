# 06 后端启动与 HTTP API

## 当前元数据与真实令牌补验（2026-10-02）

catalog/search/当前曲共用 `CatalogIndex.toSummary`：固定公开九字段 id/title/durationMs/artist/hasCover/coverVer/hasLyrics/lyricsVer/album。album=null 或非空字符串，不含 path/size；revision 纳入 album。协议 schema 与真实应用响应对照通过。

token-revocation.test.ts 通过实际主动退出/60 秒离线清扫制造旧身份失效，HTTP catalog/media 与真实 TCP WS 握手均 401；新 join 换发 token 后 HTTP/WS 成功，房主不受影响。不新增公网管理员作废接口，不用 fault-proxy 假 401 替代此结论。设备失效横幅与重新加入另验。server 74/74；[证据](../test-results/2026-10-02-desktop-tasks/README.md)。

## 职责和入口
index.ts：读取MEDIA_DIR、加载曲库、构建应用、监听HOST/PORT、处理SIGINT/SIGTERM。
app.ts：注册限流和WebSocket、创建Rooms、定义HTTP接口、统一错误处理、启动/清理tick定时器。
路由负责输入/身份验证与输出映射，房间业务规则放在Rooms，不在各路由复制。

## 当前接口
- GET /health：进程存活，返回 ok 与 rooms/onlineMembers/wsConnections 只读计数（QC-D 起追加 eventLoop: {p50Ms,p99Ms,maxMs}，累计口径，Node 24 直方图随 onClose disable）。
- POST /api/rooms，POST /api/rooms/:code/join：昵称入房，返回code/memberId/token。
- GET /api/rooms/:code/catalog：成员鉴权后返回公开曲目数据（id/title/durationMs/artist/hasCover/coverVer/hasLyrics/lyricsVer/album，无磁盘路径）。
- GET /api/rooms/:code/catalog/search?q&offset&limit&revision（2026-09-30 QC-A）：成员鉴权后的分页检索。q≤100 码点、offset 非负安全整数、limit 1–50（默认 30），非法 400；返回 {catalogRevision,total,offset,items}（公开字段口径同 catalog，无路径/字节）；请求带 revision 且与当前不一致 → 409 {"message","code":"CATALOG_CHANGED"}。实现走 `library/catalog-index.ts` 的 CatalogIndex（O(N) 过滤 + 稳定排序 + 内容 revision），千首内存夹具与 45 首真实编目形态均已覆盖单测。
- GET /api/rooms/:code/cover/:id、GET /api/rooms/:code/lyrics/:id：成员令牌鉴权后分别下发封面字节与LRC文本；封面支持 JPG/PNG/WebP，缺失各自404。封面字节按 QC-D 改按需读取（CoverCache：32MiB 全服 LRU、≤4 路并发、同资源在途合并），文件缺失/换坏 404 且不进缓存，恢复后无需重启。
- DELETE /api/rooms/:code/membership：主动退出。
- 音频和WS分别由独立模块注册。完整协议见 [协议](../protocol.md)。

当前body上限4096字节，创建/加入每IP每路由每分钟30次；创建另有存量配额（同 IP 活跃房间 ≤3，超出429），
限速与限量是两道独立防线，路由把 req.ip 传给 Rooms.create。
默认HOST为127.0.0.1；TRUST_PROXY=true仅信任127.0.0.1代理。
原始请求自动日志关闭，避免暴露Authorization；排障事件走独立结构化字段（event/code/memberId），同样不含令牌与昵称。
500统一返回不含内部细节的消息。

## 下一阶段
为HTTP路径参数和body加明确类型schema，非法形状在进入领域前返回400；保持现有合法请求兼容。
鉴权封装为统一小函数，供曲库/音频/WS复用，避免多个字符串解析实现漂移。
将关闭过程整理为：停止接收新连接、关闭WS、清理定时器和文件流、退出进程。
/health 的计数是排障读数，不是业务健康证明（曲库可用、磁盘容量、网络畅通仍需另测）；计数在重启后归零属协议内行为。
错误日志只记录错误分类与必要上下文，不打印整个请求、token或完整本地文件路径。

## 错误和兼容性
合法v1路径、状态码和返回字段保持不变。协议错误与服务内部异常分开处理。
不把暂时500当作成员身份过期；客户端只在明确401/404会话失效时进入重新加入流程。
HTTP退出失败不能要求APP保留旧身份；服务器仍按离线超时清理。

## 验收
用app.inject测试类型错误、空body、过长昵称、非法房间、缺失Bearer、限流与健康检查。
健康检查断言 ok 与计数（rooms/onlineMembers/wsConnections）随建房与 WS 连接/断开变化；房间配额断言按 req.ip 隔离。
真实TCP smoke测试保留，用来覆盖监听和WebSocket升级；它不能替代云端Nginx/TLS验证。
SIGTERM后端口释放，重启可正常启动；不能遗留tick和打开的流。

## 核心注释与记录
buildApp的依赖注入/关闭钩子、代理信任、日志裁剪、路由鉴权顺序和环境变量默认值均需注释。
2026-09-21：建档；路由schema和关闭流程加固待实现。
2026-09-24：/health 追加只读计数（保持 ok 兼容）；create 传入 req.ip 接存量配额；事件通过 EventSink 注入，测试构建下为空操作。
2026-09-26：catalog 扩至 7 字段；新增 cover/lyrics 两个只读路由（同一鉴权模板，见模块 08）。
2026-09-27：封面从临时占位恢复为 catalog 独立图片优先、ID3 回退；客户端继续按 coverVer 缓存。
2026-09-30（QC-A）：buildApp 内构建 CatalogIndex 并挂 /catalog/search 检索路由；既有 v1 路由与序列化零改动。store.ts 播放路径的线性 find 迁移到按 ID 查找属 QC-B1（随 v2 队列一起切）。
2026-09-30（QC-D）：cover/lyrics/audio 三路由改 byId O(1) 查找；封面经 CoverCache 按需读取（32MiB 全服 LRU、≤4 路并发、同资源在途合并，失败不缓存）；/health 追加 eventLoop 只读诊断。
