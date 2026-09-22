# Ubuntu 部署（本项目未自动部署到云端）

## 0. SSH 登录排查（2026-09-22 部署失败记录）

现象：本机 `ssh aliyun`（8.166.126.136）返回 `Permission denied (publickey,password)`，服务器可达但 root 与 `aliyun` 用户均无法用本机密钥登录。
已尝试：在服务器 `/root/.ssh` 写入本机公钥 `id_ed25519`（指纹 `SHA256:05LmNZqMGfgeYR4r02hBoicM/mkbV7sxKW1nj5BHNWI`），`~/.ssh` 700、`authorized_keys` 600；之后 `ssh -vvv` 显示服务器仍拒绝该公钥（`Offering public key` 后继续列出 `publickey,password`）。

下次排查顺序（先不要改后端/系统配置）：
1. 确认实际登录用户：`whoami; echo $HOME`；公钥必须写入该用户的 `~/.ssh/authorized_keys`，而不是别的账号。
2. 校验权限与属主：`ls -ld ~ ~/.ssh; ls -l ~/.ssh/authorized_keys; chown -R $(whoami) ~/.ssh; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys`。
3. 核对指纹：`ssh-keygen -lf ~/.ssh/authorized_keys` 应含 `SHA256:05LmNZqMGfgeYR4r02hBoicM/mkbV7sxKW1nj5BHNWI`。
4. 看服务器拒绝原因：`tail -n 20 /var/log/auth.log` 或 `journalctl -u sshd -n 20 --no-pager`（常见 `bad ownership or modes`）。
5. 检查 `sshd_config` 的 `AuthorizedKeysFile`、`AllowUsers`、`PubkeyAuthentication`。

云服务器登录打通后，再按下面第 1 节继续部署；本轮云端部署就此挂起，不改变服务器配置、不提升资源。

## 1. 准备目录和账号

先安装 Node.js 24，并用 node --version 确认。服务模板假设可执行文件位于 /usr/bin/node；
如果 command -v node 返回其他位置，修改 ExecStart，不能依赖交互式 shell 的 nvm 环境。

```bash
sudo useradd --system --home /opt/listen-together --shell /usr/sbin/nologin listen
sudo mkdir -p /opt/listen-together
```

将项目上传到 /opt/listen-together；不上传 node_modules、Android 构建缓存或密钥。
音乐放 media，编辑 catalog.json，详见 media/README.md。
以部署账号在 server 下执行 npm ci 和 npm run build，再执行 npm prune --omit=dev。
服务账号需要读取代码和音频，不需要写目录权限：
```bash
sudo chown -R root:listen /opt/listen-together
sudo chmod -R g+rX /opt/listen-together
sudo cp deploy/server.env.example /etc/listen-together.env
sudo cp deploy/listen-together.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now listen-together
curl http://127.0.0.1:3000/health
sudo journalctl -u listen-together -n 50 --no-pager
```

复制命令从项目根目录运行。若操作系统已存在 listen 账号，不重复创建。
更换音乐或升级代码后 systemctl restart listen-together；这会结束当前所有内存房间。

## 2. 先在受限网络联调

可使用 SSH 隧道将本机 3000 转发到云服务器 127.0.0.1:3000，避免直接暴露后端：
```powershell
ssh -L 3000:127.0.0.1:3000 root@你的服务器IP
```
本机 Android 模拟器填写 http://10.0.2.2:3000。
真机通过局域网直连调试需要显式绑定 HOST=0.0.0.0 并配置安全组，测试完成后恢复回环地址。
HTTP 会明文传输成员令牌，只用于受控 debug 环境；好友公网使用 TLS。

## 3. HTTPS/WSS

准备一个指向云服务器的域名，并按实际地域及服务要求完成必要配置。
安装 nginx、certbot；允许公网 TCP 80/443，SSH 仅向管理来源开放，3000 不对公网开放。
首次申请证书时先建立仅监听 80 的临时 Nginx 站点，根目录设为 /var/www/html，然后运行：

```bash
sudo certbot certonly --webroot -w /var/www/html -d music.example.com
```

将 deploy/nginx.conf 中所有 music.example.com 替换为你的域名。
复制到 /etc/nginx/sites-available/listen-together，再链接到 sites-enabled。
不要覆盖已有站点；先检查同域名或端口配置冲突。

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

配置证书续期成功后的 Nginx reload hook，确保新证书被加载。APP 填 https://你的域名。
Nginx 只反向代理，不需要公开 media 目录；音频必须经过后端令牌检查。
TRUST_PROXY=true 只信任回环代理。保持后端绑定 127.0.0.1，防止绕过代理伪造来源。

## 4. 运行与费用

只有单进程服务，不能用 PM2 cluster 或多个副本共享此内存状态。
日志使用 journalctl；不记录令牌。可用 journalctl --disk-usage 检查日志占用。
关注磁盘、内存、重启次数和阿里云出网流量。15 人、192kbps 连续一小时理论音频流量约 1.30GB。
实际带宽、TLS、缓存及重试仍需实测；设置账单预警。
云服务器配置、域名、音乐和真机由实际环境提供，本模板不包含任何服务器密码或 SSH 私钥。
