# 06 后端启动与 HTTP API

## 职责和入口
index.ts：读取MEDIA_DIR、加载曲库、构建应用、监听HOST/PORT、处理SIGINT/SIGTERM。
app.ts：注册限流和WebSocket、创建Rooms、定义HTTP接口、统一错误处理、启动/清理tick定时器。
路由负责输入/身份验证与输出映射，房间业务规则放在Rooms，不在各路由复制。

## 当前接口
- GET /health：进程存活，返回 ok 与 rooms/onlineMembers/wsConnections 三个只读计数（计数由 Rooms 与传输层共同维护）。
- POST /api/rooms，POST /api/rooms/:code/join：昵称入房，返回code/memberId/token。
- GET /api/rooms/:code/catalog：成员鉴权后返回公开曲目数据。
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
