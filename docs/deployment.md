# Ubuntu 部署（本项目未自动部署到云端）

> 2026-09-22 深夜更新：SSH 登录问题已解决（根因是 authorized_keys 此前从未实际写入成功），只读盘点与首次部署已完成，见 [test-results/2026-09-22-m4-first-deploy](test-results/2026-09-22-m4-first-deploy/README.md)。第 0 节排查记录保留存档；第 1 节末尾附实测注记（Node 安装方式、swap、构建权限细节与自检脚本）。

## 0. SSH 登录排查（2026-09-22 部署失败记录）

现象：本机 `ssh aliyun`（8.166.126.136）返回 `Permission denied (publickey,password)`，服务器可达但 root 与 `aliyun` 用户均无法用本机密钥登录。
已尝试：在服务器 `/root/.ssh` 写入本机公钥 `id_ed25519`（指纹 `SHA256:05LmNZqMGfgeYR4r02hBoicM/mkbV7sxKW1nj5BHNWI`），`~/.ssh` 700、`authorized_keys` 600；之后 `ssh -vvv` 显示服务器仍拒绝该公钥（`Offering public key` 后继续列出 `publickey,password`）。
2026-09-22 21:49 复测（BatchMode 非交互）：仍为 `Permission denied (publickey,password)`，与首次记录一致。本机侧无私钥/配置问题（`ssh-keygen -lf` 指纹吻合、`~/.ssh/config` 的 `Host aliyun` 正确）；无法看到服务器端 auth 日志，**排查已到本机能力边界，需走阿里云控制台通道（Workbench/VNC，不依赖 SSH）在服务器端定位**。

下次排查顺序（先不要改后端/系统配置）：
1. 确认实际登录用户：`whoami; echo $HOME`；公钥必须写入该用户的 `~/.ssh/authorized_keys`，而不是别的账号。
2. 校验权限与属主：`ls -ld ~ ~/.ssh; ls -l ~/.ssh/authorized_keys; chown -R $(whoami) ~/.ssh; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys`。
3. 核对指纹：`ssh-keygen -lf ~/.ssh/authorized_keys` 应含 `SHA256:05LmNZqMGfgeYR4r02hBoicM/mkbV7sxKW1nj5BHNWI`。
4. 看服务器拒绝原因：`tail -n 20 /var/log/auth.log` 或 `journalctl -u sshd -n 20 --no-pager`（常见 `bad ownership or modes`）。
5. 检查 `sshd_config` 的 `AuthorizedKeysFile`、`AllowUsers`、`PubkeyAuthentication`。

控制台通道修复（Workbench/VNC 登录后整段粘贴，只动 SSH 入口、不动后端）：
```bash
whoami; echo $HOME
mkdir -p ~/.ssh && chmod 700 ~/.ssh
grep -q '05LmNZqMGfgeYR4r02hBoicM/mkbV7sxKW1nj5BHNWI' <(ssh-keygen -lf ~/.ssh/authorized_keys 2>/dev/null) || \
  echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGaOD9mcRVMTSfE27T+sqO1XPHlpFE6fH1AUIycZIJaC 2917063923@qq.com' >> ~/.ssh/authorized_keys
chown -R $(whoami) ~/.ssh && chmod 600 ~/.ssh/authorized_keys
ssh-keygen -lf ~/.ssh/authorized_keys
journalctl -u ssh -n 40 --no-pager 2>/dev/null | grep -Ei 'publickey|denied|ownership' | tail -10 || tail -n 40 /var/log/auth.log | grep -Ei 'publickey|denied|ownership' | tail -10
```
> 注：上面 echo 的公钥本体以本机 `~/.ssh/id_ed25519.pub` 为准，粘贴前先在本机执行 `cat ~/.ssh/id_ed25519.pub` 核对。
> 若 root 登录被 `PermitRootLogin` 限制，在控制台里改用实际存在的管理员账号写入其 `~/.ssh`，并同步更新本机 `~/.ssh/config` 的 `Host aliyun` 的 `User`。

修复后本机验证：
```powershell
ssh -o BatchMode=yes aliyun "echo SSH-OK; whoami; node --version 2>/dev/null || echo no-node"
```
登录打通后，先跑 `scripts/m4-inventory.sh` 只读盘点基线（M4 首次部署时已执行，脚本可复用），再按第 1 节继续部署。

首次部署与回滚演练均已完成（2026-09-23 晚，见 [验收记录](verification.md)）；本文件保留操作模板供后续升级/迁移复用。

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

### 1.1 实测注记（2026-09-22 首次部署，Ubuntu 26.04）

- **Node 安装**：apt 候选仅 nodejs 22.22.1（universe），不满足 server engines >=24。采用官方二进制：从 npmmirror 下载 `node-v24.9.0-linux-x64.tar.xz` + `SHASUMS256.txt`（`sha256sum -c` 校验，下载文件必须保留清单中的原始文件名，改名会报 FAILED open or read），解压到 `/opt/node24`（`--strip-components=1`），`ln -sf /opt/node24/bin/{node,npm,npx,corepack} /usr/bin/`——ExecStart 的 `/usr/bin/node` 无需修改。
- **swap**：`fallocate -l 2G /swapfile` → mkswap → swapon → 写 fstab。1.7Gi 内存无 swap 时 npm ci/tsc 有 OOM 风险。
- **构建权限**：以 listen 账号构建前先 `chown -R listen:listen` 该 release 目录；npm 需显式 `env HOME=/tmp npm ci --cache /tmp/npm-cache-listen`（/opt 为 root 属主，npm 写不了 `~/.npm`）；构建 + prune 完成后再 `chown -R root:listen` + `chmod -R g+rX` 收回写权限。
- **media 曲库**：把 demo 曲库 mp3 与 demo-media/catalog.json 拷入 /opt/listen-together/media（catalog 未引用的文件不会被 API 提供；不要把个人音频放进 demo-media——已被打包脚本过滤，见陷阱清单第 7 节）。
- **自检脚本**：服务端 `bash scripts/m4-deploy-verify.sh`（上传到服务器运行，health/鉴权/Range/WS 13 项，收尾自动退出临时成员）；本机经隧道 `LT_BASE=http://127.0.0.1:13000 node scripts/tunnel-verify.mjs`（用 server/node_modules 的 ws 以支持 Authorization 头）。

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
**大陆地域的 ECS（实测 cn-guangzhou）自定义域名必须先完成 ICP 备案**：未备案时阿里云在机房入口对 80/443 做域名级拦截（HTTPS 握手被重置、HTTP 返回 `Server: Beaver` 的 "Non-compliance ICP Filing" 403），服务器本机测试全部正常、极易误判为 nginx/证书/安全组问题（见陷阱 8.6）；备案拦截也会挡 HTTP-01 证书续期。非标端口不受影响。
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

## 5. 版本目录与回滚（M4，2026-09-22 准备）

设计约定：systemd 模板固定指向 `/opt/listen-together/server`；
不直接套用未实现的 current 目录方案，因此用**符号链接切换**：systemd 的
`WorkingDirectory` 与 `ExecStart` 路径保持不变，`/opt/listen-together/server` 本身是指向当前版本的链接。

布局：
```text
/opt/listen-together/
├── releases/<id>/            # id = 打包时间戳，如 20260922-2159（tar 包名里的）
│   ├── server/               # 包内 server/（src dist test package*.json tsconfig.json）
│   └── demo-media/           # 合成曲库（个人曲库不自动上传）
├── server -> releases/<id>/server   # 符号链接，systemd 指向这里
├── media/                    # MEDIA_DIR 指向这里，跨版本持久，不在 releases 内
└── current-version.txt       # 当前 release id 与上一版 id，回滚时手工改写
```

升级（新版本）：
```bash
ID=<时间戳>
sudo tar -xzf listen-together-0.1.0-<时间戳>.tar.gz -C /opt/listen-together/releases/$ID
cd /opt/listen-together/releases/$ID/server && sudo -u listen npm ci && sudo -u listen npm run build && sudo -u listen npm prune --omit=dev
echo "prev=$(readlink /opt/listen-together/server | sed 's|.*/releases/||;s|/server||')" | sudo tee /opt/listen-together/current-version.txt
sudo ln -sfn /opt/listen-together/releases/$ID/server /opt/listen-together/server
sudo systemctl restart listen-together
curl -s http://127.0.0.1:3000/health && sudo systemctl show listen-together -p WorkingDirectory -p ExecStart | head -2
```

回滚（升坏时）：
```bash
PREV=$(grep prev= /opt/listen-together/current-version.txt | cut -d= -f2)
sudo ln -sfn /opt/listen-together/releases/$PREV/server /opt/listen-together/server
sudo systemctl restart listen-together
curl -s http://127.0.0.1:3000/health
```
验收要点：health 恢复 200、`systemctl show` 的 WorkingDirectory/ExecStart 与预期一致；重启会丢失内存房间（协议内行为），验收报告必须标注。

首次部署边界：没有"上一版"，**只验证停用（systemctl stop）与恢复候选（start + health）**，如实记录"未验证版本回滚"，不得记作回滚通过。

打包与上传（本机侧）：
```powershell
cd D:\ListenTogether
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\package-deploy.ps1
# 产出 deploy-artifacts\listen-together-<版本>-<时间戳>.tar.gz + SHA256SUMS-<时间戳>.txt
scp deploy-artifacts\listen-together-*.tar.gz deploy-artifacts\SHA256SUMS-*.txt aliyun:/tmp/
```
服务器端校验：`sha256sum -c SHA256SUMS-*.txt`（tarball 行需在 /tmp 下手工比对）。
已实跑验证（2026-09-22）：tsc 0 错误、tar.gz 20.5MB、含 demo-media 全部 7 个 mp3、
SHA256 清单逐文件生成；制品 `deploy-artifacts/listen-together-0.1.0-20260922-2159.tar.gz`。

### 5.1 升级/回滚演练实测注记（2026-09-23，双向通过）

首次部署只有"停用/恢复候选"，**本节起版本回滚已真实验证**：升级到 `20260923-2157` 再按上面的回滚命令切回
`20260922-2159`，两次 health 200、`WorkingDirectory`/ExecStart 路径不变、13 项功能抽查各 13/0。
完整记录与原始输出见 [test-results/2026-09-23-m4-rollback-drill](test-results/2026-09-23-m4-rollback-drill/README.md)。
照抄本节命令时另注意四点：

1. **SHA256SUMS 的行尾**：PowerShell 旧版脚本产出的清单是 CRLF，服务器上用 `grep '…$'` 过滤会命中 **0 行**并让
   `sha256sum -c` 报 `no properly formatted checksum lines found`（`sha256sum -c` 本身能处理 CRLF）。脚本已修正为
   输出 LF（复跑实测：服务器 GNU grep 由命中 0 行变为命中 1 行）；拿到旧清单先 `tr -d '\r'`。详见[陷阱 8.7](development-pitfalls.md)。
2. **`current-version.txt` 要成对维护**：本节升级命令只写 `prev=`；实测写成 `id=<新ID>` + `prev=<旧ID>` 两行，
   与首次部署的 schema 一致，回滚命令 `grep prev= … | cut -d= -f2` 行为不变。**注意回滚片段只切链接、不改写版本文件**
   —— 回滚后必须按上面的布局注释手工把 `id=` 改为**实际在产**版本，并保证 `prev=` 是 `releases/` 下**真实存在**的 id
   （写成空值或不存在的 id，下次回滚会执行 `ln -sfn /opt/listen-together/releases//server …` 切出**断链**，服务重启即起不来）。
   回滚后自检：`readlink /opt/listen-together/server` 解出的版本 = `id=` 字段，且 `releases/$prev/server` 目录存在。
3. **服务端自检脚本**：`scripts/m4-deploy-verify.sh` 会从云端 `media/catalog.json` 动态取抽查曲目（可用 `TRACK_ID=` 覆盖），
   不再硬编码演示曲目（见[陷阱 8.8](development-pitfalls.md)）。**先在一份已知良好版本上跑基线**，再对被测版本跑。
4. **两次 restart 各清空一次全部内存房间**：演练用受控房间实测 `catalog 200 → restart → 404「房间不存在或已过期」`。
   执行前用 `ss -tn state established '( sport = :3000 )'` 确认零条 ESTABLISHED、并看 `journalctl -n 20` 无房间活动；
   在有人使用期间执行会造成全员掉线（协议内行为，需重新建房）。
5. **自检脚本已升到 14 项（2026-09-24）**：`/health` 现返回 `{ok,rooms,onlineMembers,wsConnections}`，脚本第 1 项
   改为按字段解析（旧版本没有计数时会打印 SKIP、不计失败）；并在建房前用 `rooms` 计数做**存量配额前置检查**——
   `POST /api/rooms` 现在限制"同一来源最多 3 个活跃房间"，而脚本每次运行留下的房间要等 5 分钟空房回收才释放配额，
   所以**连续重跑第 4 次**会在建房步拿到 429（不要误判成新版本缺陷，见[陷阱 8.9](development-pitfalls.md)）。
   要在重启前确认无活跃房间，直接看 `/health` 的 `rooms/onlineMembers/wsConnections` 三个计数即可（比 `ss` 更直观）。

## 6. 云端曲库管理：上传与转码（2026-09-23 新增）

曲库文件在 `/opt/listen-together/media/`（跨版本持久层），`catalog.json` 条目为
`{id, title, file}`，id 限 `[a-zA-Z0-9_-]{1,64}`；时长/大小由后端**启动时**用
music-metadata 解析并缓存（audio 路由的 Range size 是每请求实时 stat，但时长缓存
必须靠重启刷新）。**替换或新增音频后必须 `systemctl restart listen-together`，
重启会清空内存房间。**

工具（两个脚本配对使用，2026-09-23 首次实跑即完成 5 首 320k→192k 全量替换）：

- `scripts/add-media.ps1`（本机驱动）：本地 ffmpeg 转码（默认 192k CBR、保留 ID3、
  失败自动去元数据重转）→ ffprobe 校验时长 ±1.5s 与码率 → scp 以 ASCII 临时名
  `/tmp/lt-up-<id>.mp3` 上传 → 调服务端脚本安装，可选 `-Restart` 顺带重启并验证。
  新增歌曲加 `-Title "中文名"`（经 UTF-8 manifest 文件流转，不进命令行）。
- `/opt/listen-together/bin/media-manage.sh`（服务端，源码在 scripts/media-manage.sh）：
  `has|install|verify|list`。install 对已有 id 按 catalog 映射**原位替换**（先把原文件
  备份到 `/opt/listen-together/media-originals/<时间戳>/`），对新 id 按 manifest 落盘
  `<标题>.mp3` 并用 node 追加 catalog 条目；verify 用后端同款 music-metadata 输出
  时长/大小/码率表。

示例：
```powershell
# 替换已有歌曲（320k 重转 192k）
.\scripts\add-media.ps1 -File "C:\path\单车.mp3" -Id dan-che
# 新增歌曲（转码 + 上传 + 追加 catalog + 重启）
.\scripts\add-media.ps1 -File "D:\新歌.mp3" -Id xin-ge -Title "新歌" -Restart
```

批量替换时只在最后一首加 `-Restart`；重启后验收：health 200、`media-manage.sh verify`
码率/时长表、公网 catalog API 5 首时长不变、Range 0-1023 返回 206 且 total 为新文件
大小、无令牌 401。设计约束：中文文件名/标题只在文件内容（脚本、manifest）里流转，
绝不进 ssh/scp/ffmpeg 的命令行参数（Windows 侧代码页转换会乱码，见陷阱 1.6）。
