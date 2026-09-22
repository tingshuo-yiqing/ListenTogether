#!/usr/bin/env bash
# M4 只读盘点（在云服务器上执行，不修改任何配置）。
# 用法：登录服务器（SSH 或阿里云控制台 Workbench/VNC）后：
#   bash m4-inventory.sh > /tmp/m4-inventory-$(date +%Y%m%d-%H%M%S).txt 2>&1
# 然后把输出文件取回，填入 docs/test-results/<日期>-m4-inventory/README.md。
# 对应 docs/execution-plan.md 第 5 节第 1 步；本项目约定：先只读盘点，不动后端/系统配置。
set -u
say() { printf '\n===== %s =====\n' "$1"; }

say "0. 基本身份"
whoami; echo "HOME=$HOME"; hostname; uname -a; cat /etc/os-release 2>/dev/null | head -2

say "1. CPU / 内存 / 磁盘"
nproc; grep -m1 'model name' /proc/cpuinfo 2>/dev/null
free -h
df -h / /opt 2>/dev/null
df -i / 2>/dev/null | tail -1

say "2. Node.js 与目标目录现状"
command -v node && node --version || echo "node 不存在（部署需 Node 24，见 deployment.md 第 1 节）"
command -v npm && npm --version || true
ls -ld /opt /opt/listen-together /opt/listen-together/server 2>/dev/null || echo "/opt/listen-together 不存在（首次部署）"
id listen 2>/dev/null || echo "listen 账号不存在（首次部署需创建）"

say "3. 端口与现有服务（确认 80/443/3000/22 占用）"
ss -tlnp 2>/dev/null | head -20
systemctl list-units --type=service --state=running --no-pager 2>/dev/null | head -20
systemctl status listen-together --no-pager 2>/dev/null | head -5 || echo "listen-together 服务不存在（首次部署）"

say "4. SSH 排查（对应 deployment.md 第 0 节）"
ls -ld ~ ~/.ssh 2>/dev/null
ls -l ~/.ssh/authorized_keys 2>/dev/null
ssh-keygen -lf ~/.ssh/authorized_keys 2>/dev/null || echo "authorized_keys 无法读取或为空"
sshd -T 2>/dev/null | grep -Ei 'pubkeyauthentication|authorizedkeysfile|passwordauthentication|permitrootlogin' || \
  grep -REi 'PubkeyAuthentication|AuthorizedKeysFile|AllowUsers|PermitRootLogin' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/ 2>/dev/null
echo "--- auth 日志中最近的拒绝记录（定位 publickey 被拒原因）---"
(journalctl -u ssh -n 60 --no-pager 2>/dev/null || journalctl -u sshd -n 60 --no-pager 2>/dev/null || tail -n 60 /var/log/auth.log 2>/dev/null) | grep -Ei 'publickey|Failed|invalid|denied|ownership' | tail -15

say "5. nginx / TLS / 域名现状"
command -v nginx && nginx -v 2>&1 || echo "nginx 未安装"
ls /etc/nginx/sites-enabled/ 2>/dev/null
command -v certbot && certbot --version 2>&1 || echo "certbot 未安装"
ls /etc/letsencrypt/live/ 2>/dev/null || echo "无既有证书"

say "6. 出网与防火墙"
curl -s -m 6 -o /dev/null -w 'egress http code=%{http_code} time=%{time_total}s\n' https://registry.npmjs.org/ || echo "出网到 npm registry 失败"
(systemctl is-active firewalld 2>/dev/null; ufw status 2>/dev/null) | head -3
iptables -L INPUT -n 2>/dev/null | head -8 || echo "无 iptables 查看权限"

say "7. journal 日志占用"
journalctl --disk-usage 2>/dev/null

say "盘点结束（以上全部只读，未修改任何配置）"
