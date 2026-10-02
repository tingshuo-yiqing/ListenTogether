# GitHub 与云端 v2 发布（2026-10-02）

用户明确授权“提交到 github 和云端，在使用过程中发现了问题再修改”。本轮按当前已验源码发布 v2、ACC 修复、原生界面、动物头像、键盘与专辑元数据；完整真机/双机矩阵仍保持待验，以试用反馈继续修复。

## 发布准备

- 本地 server 74/74、安卓 180/24、scripts 51/51、Lint 0，当前产品与此前 159 文件哈希快照一致；没有重新宣称尚缺的真机结论。
- GitHub remote main 为 `34b53ec`，本地主线有尚未推送的历史提交与本轮未提交源码/证据；推送使用已存在 main，禁止 force。原代理 7892 已失效，本次用当前监听 7890 覆盖。
- 发布审阅未发现私钥、GitHub 凭据或字面成员令牌；单文件均低于 GitHub 限制。[审阅结果](publish-audit.json)。
- 云端旧后端 `20260928-1815`、管理器 `20260928-metadata-03`，发布前 health rooms/online/ws 全为 0；真实曲库 45 首，catalog SHA256 `216fc9ba9dcffd73e563652c56bc18a3eaa8a29691202e670cd140e4c0ea601c`。
- 后端候选 `20261002-013255`，无 media/demo-media；管理器候选 `20261002-metadata-v2`，包含当前三视图/Hi 搜索/音频导入/回收恢复与 pinyin-pro 依赖，同样不带 media。hash 见 [管理器包](metadata-package.json) 与上一轮 [后端制品](../2026-10-02-desktop-tasks/delivery.json)。

## 验收工具

[cloud-v2-verify.mjs](cloud-v2-verify.mjs) 用真实 HTTP/WS 测能力协商、旧 HTTP/WS 426、45 首九字段与 album、分页/revision、鉴权/Range/封面歌词、校时、动物头像唯一、点歌与同 ID 重放、成员权限、聊天/去重、播放/skip/空曲；21 项本地隔离检查通过，[结果](verifier-local.json)。令牌仅在内存，不落日志；临时成员最终主动退出。

初版仪器误把业务拒绝当 error 帧，又错误读取 ack.status；按现有 protocol.md 的 `ack.ok=false/error.status` 更正，不修改产品权限实现。两次失败保留：[第一次](verifier-local-first-attempt.json)、[第二次](verifier-local-second-attempt.json)。chat ack 关联使用 clientMessageId，不混用 requestId。

发布时发现日常 `member-sim.mjs` HTTP/WS 缺 v2 头，已补齐；v1 后端仍可忽略该头。旧 `tunnel-verify.mjs` 硬编码 demo 曲库与旧协议，此轮不拿它判 v2 发布。当前发布执行器 [cloud-release.sh](cloud-release.sh) 分 prepare/publish：独立 release + npm ci/build/测试 + 33002 端口实测，正式切换前再次核对无活跃房间；失败恢复旧代码/管理器链接与版本文件，不覆盖真实曲库。

## 当前状态

GitHub 主线首批提交 `48b9a71` 已推送。云端准备期间，服务端 73/74 的首次失败是后端包刻意未包含安卓契约测试资源；追加独立 15 张头像/映射夹具后 74/74。管理器首轮 47/51 同样缺少合成 demo-soft.mp3，已补测试夹具；保留首轮日志，夹具在验收后移除，不写真实 media。

安装审计报告 Ajv `$data` ReDoS 已知问题；产品未启用该选项，本轮仍将同主版本依赖锁到修补版 8.18.0，并重跑本地 server 74/74。依据 [GitHub 官方公告](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6)，不执行全库 npm audit fix。更新后的后端包见 [backend-package.json](backend-package.json)，替代准备阶段原后端包；APK 无改动。

准备与本地验证已完成。真实云端切换、Git 提交/远端确认与 APK 下载结果将在执行后追加；此段不作为发布成功证据。

新协议需要配套 APK `041b4295…`（debug 开发试用），旧 APK 收到 426 为设计行为。该 APK 已有独立 MuMu 布局实测，PHQ110 新包未安装；系统通知元数据显示、真实弱网/权限手势/字号小屏与 M2 双真机/声音仍待验。TLS/域名继续遵循已决定的试用路线 A；本轮未变更同步参数、真实曲库或手机。
