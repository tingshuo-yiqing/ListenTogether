# 06 后端启动与 HTTP API

## 职责和入口
index.ts：读取MEDIA_DIR、加载曲库、构建应用、监听HOST/PORT、处理SIGINT/SIGTERM。
app.ts：注册限流和WebSocket、创建Rooms、定义HTTP接口、统一错误处理、启动/清理tick定时器。
路由负责输入/身份验证与输出映射，房间业务规则放在Rooms，不在各路由复制。

## 当前接口
- GET /health：进程存活，返回ok。
- POST /api/rooms，POST /api/rooms/:code/join：昵称入房，返回code/memberId/token。
- GET /api/rooms/:code/catalog：成员鉴权后返回公开曲目数据。
- DELETE /api/rooms/:code/membership：主动退出。
- 音频和WS分别由独立模块注册。完整协议见 [协议](../protocol.md)。

当前body上限4096字节，创建/加入每IP每路由每分钟30次。
默认HOST为127.0.0.1；TRUST_PROXY=true仅信任127.0.0.1代理。
原始请求自动日志关闭，避免暴露Authorization。500统一返回不含内部细节的消息。

## 下一阶段
为HTTP路径参数和body加明确类型schema，非法形状在进入领域前返回400；保持现有合法请求兼容。
鉴权封装为统一小函数，供曲库/音频/WS复用，避免多个字符串解析实现漂移。
将关闭过程整理为：停止接收新连接、关闭WS、清理定时器和文件流、退出进程。
/health仍只表示存活，不把它当曲库可用、磁盘容量或网络畅通的证明；部署验收另测受保护音频。
错误日志只记录错误分类与必要上下文，不打印整个请求、token或完整本地文件路径。

## 错误和兼容性
合法v1路径、状态码和返回字段保持不变。协议错误与服务内部异常分开处理。
不把暂时500当作成员身份过期；客户端只在明确401/404会话失效时进入重新加入流程。
HTTP退出失败不能要求APP保留旧身份；服务器仍按离线超时清理。

## 验收
用app.inject测试类型错误、空body、过长昵称、非法房间、缺失Bearer、限流与健康检查。
真实TCP smoke测试保留，用来覆盖监听和WebSocket升级；它不能替代云端Nginx/TLS验证。
SIGTERM后端口释放，重启可正常启动；不能遗留tick和打开的流。

## 核心注释与记录
buildApp的依赖注入/关闭钩子、代理信任、日志裁剪、路由鉴权顺序和环境变量默认值均需注释。
2026-09-21：建档；路由schema和关闭流程加固待实现。
