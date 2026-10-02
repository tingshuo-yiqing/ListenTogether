# Git 与发布候选审阅（2026-10-02）

本轮固定 APK：`deploy-artifacts/ListenTogether-desktop-041b4295.apk`，SHA256 `041b42955fb8bf6b740960e5032bb3c0c9e8c0e8932304d8ac70e5693aa3c753`，21,787,637 字节；本任务未装机；同哈希 MuMu 证据见独立键盘任务报告。

纯后端候选：`deploy-artifacts/listen-together-server-0.1.0-20261002-013255.tar.gz`，SHA256 `22a58d0379e3b6eb05ca99dd86e2cdea03a1f4795d2df04051ca6d4e1474f94b`，142,792 字节；清单 `deploy-artifacts/SHA256SUMS-20261002-013255.txt`；没有 media/demo-media、Android、日志或测试证据，未上传。

## 当前范围

工作区基线 HEAD `495d3352766024ddeaa655761bf4e7f88bbe7f43`；本轮没有提交/推送。工作区原有 v2/ACC/UI/头像等大批未提交源码与证据，并有聊天键盘任务共享改动。候选包基于全部当前 server 源码构建；固定 APK 基于全部当前 Android 源码构建，不能声称仅包含本轮的小补丁。

本轮新增/修改的功能是：album 加载/公开 toSummary/协议 schema/Android Track 与 Media3 元数据构造；真实 token 失效集成测试；管理器空库指引；ServerOnly/NodePath 打包；部署、模块、路线与验收文档；独立浏览器/Linux/systemd 证据。现有 v2、头像、手势与键盘改动保留。

[完整状态](git-status.txt) 包含未跟踪文件，[已跟踪差异统计](git-diff-stat.txt) 不含未跟踪文件。[源码/编译产物清单](source-hashes.json) 固定实际产品与测试文件（159 个），不拿旧 HEAD 当验收版本。

## 可用的提交说明草案

建议本轮功能标题：`贯通专辑媒体元数据并补齐无设备验收`。

歌曲专辑此前留在 catalog.json，服务端与安卓媒体会话未消费。现在非空手填/ID3 专辑统一进入 catalog、搜索与当前曲，并由安卓 Media3 设置 albumTitle；旧响应缺字段继续兼容。修复管理器空库仍提示选歌的问题，增加不带曲库的后端候选包。

验证：server 74/74、Android 180/24/Lint 0、scripts 51/51；Chrome 删除/恢复 8/8、Linux 共享文件恢复 3/3、真实令牌失效 2 项、WSL systemd 坏 dist/缺依赖与回滚 5/5。没有本轮真机或生产发布结果。

实际提交前必须把原有 v2 所需新增文件纳入相应提交，再确认共享键盘改动已完成归属；不能只提交依赖这些文件的 metadata 修改形成不可构建提交。部署第 5 节已写具体校验/回滚顺序，v2 会拒绝旧 APK，设备矩阵与云端发布仍保持待验。
