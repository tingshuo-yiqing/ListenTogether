# M4 只读盘点（2026-09-22 22:17，SSH 打通后首跑）

- 标识：M4-ACCESS 第 1 步（execution-plan 第 5 节）；操作者：AI 助手；结果：**完成（只读，未改任何配置）**
- 前置：SSH 公钥登录已打通——用户经云控制台文件管理在 `/root/.ssh/authorized_keys` 写入本机公钥
  （auth 日志 22:17:46 起记录 `Accepted publickey ... SHA256:05LmNZ...`，即本机 id_ed25519）。
  **此前"公钥被拒"的根因确认：authorized_keys 当时并未实际写入成功**（服务器端文件时间戳 Sep 22 22:17）。
  另见日志中 100.104.128.x（阿里云 Assistant/Workbench 内网通道，指纹 9hcgkrEk…）的成功登录，与本机密钥无关。
- 原始输出：[2026-09-22-m4-inventory-raw.txt](2026-09-22-m4-inventory-raw.txt)（scripts/m4-inventory.sh 生成）

## 关键结论

| 项 | 现状 | 对部署的影响 |
| --- | --- | --- |
| 系统 | Ubuntu 26.04.1 LTS，主机 iZ640bdwb4odxlZ | 模板适用 |
| 资源 | 2 vCPU Xeon Platinum / **内存 1.7Gi、Swap 0** / 磁盘 40G 已用 10% | 内存紧张且无 swap：单实例 Node 够用，但需关注 OOM 风险；建议后续加 1-2G swap（部署阶段再做） |
| Node | **未安装** | 部署前需装 Node 24（deployment.md 第 1 节） |
| 目标目录 | /opt/listen-together 不存在、listen 账号不存在 | 首次部署（回滚验收只到"停用/恢复候选"） |
| 端口 | 仅 22/53/33243 监听，80/443/3000 空闲 | 无端口冲突 |
| sshd | permitrootlogin yes / pubkey yes / authorized_keys 权限 700/600 正确 | 登录问题关闭 |
| nginx/certbot | 均未安装、无证书 | TLS 阶段需全新安装 |
| 出网 | npm registry 200（1.86s） | npm ci 可行 |
| 防火墙 | ufw/firewalld inactive、INPUT ACCEPT | 端口开放由安全组控制（控制台侧，部署时确认） |
| journal | 8MB | 无压力 |

## 边界与下一步

- 未做：任何安装/配置修改（本轮严格只读）；域名与 TLS 未盘点（用户尚未提供域名）。
- 下一步（按 execution-plan 第 5 节）：安装 Node 24 → 创建 listen 账号与 /opt/listen-together →
  上传 20260922-2159 部署包（SHA256 校验）→ 首次部署（systemd + health + 鉴权音频/Range/WS 验证）→
  本地 SSH 隧道受控联调 → 公网验证（需先解决 0.0.0.0 绑定/安全组或 TLS）。
- 门槛说明：M2 双机仍阻塞（缺第二台手机）；M3 已通过部分见 verification.md（M3-LONG 用户指示挂起）。
  单实例候选部署不依赖 M2。
