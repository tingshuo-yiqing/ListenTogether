# 元数据管理器审查与云端发布（2026-09-28）

状态：已部署；操作者：Codex。范围为管理器及其编目校验依赖，不发布安卓包。

## 审查与修复

- 上传音频实际写入 audio/，catalog 却写平铺路径，导致新上传不能通过整库校验；改成 audio/<id>.mp3。
- 替换、移除独立封面原先直接删旧图；现与删曲同样检查其他引用，共享图片保留。引用比较解析真实路径。
- 请求在单进程内串行处理，避免多个标签页读旧快照覆盖对方，列表也不读到尚未校验的中间状态。耗时联网匹配期间其他请求会等待；不支持多个管理器进程或外部脚本同时写同一曲库。
- 校验失败恢复原 catalog 字节，不再重新序列化旧对象；回滚本身失败明确报错，不声称已经成功恢复。
- 回收批次拒绝 . 和 ..；同批次同名文件再次回收使用唯一后缀，保留旧副本。
- 校验 Host 和 Origin，拒绝外站来源；继续仅监听 127.0.0.1。

## 验证

本机服务端 npm run build、npm test：30/30；元数据源离线单测31/31；真实管理进程临时曲库驱动85/85（新增第9组8项）。
云端 Linux 重跑构建、离线单测31/31与驱动85/85。夹具创建临时目录，结束清除，不对生产曲库执行删除测试。
生产管理器 GET /api/tracks 返回23首；GET /api/sources 返回三源。发布前后 catalog 用 cmp 比较完全一致。
ss 确认仅 127.0.0.1:3100；systemctl is-active 返回active；听歌后端 health仍为ok，rooms/onlineMembers/wsConnections均0。

## 发布与恢复

- 管理器版本：20260928-metadata-01，目录 /opt/listen-together/metadata-releases/20260928-metadata-01。
- 当前链接：/opt/listen-together/metadata-manager；服务：listen-together-metadata。
- 制品 SHA256：1380844875d3cef775795e83924f8af342c305a4573a1de8e847c7f0711da55f（上传前后相同）。
- 独立专用账号 listen-metadata，组 listen；可写范围限 media 与 metadata-state，播放服务仍只读。
- 生产编目备份：/opt/listen-together/metadata-state/catalog-before-20260928-metadata-01.json；缓存和回收目录也在metadata-state，跨版本保留。
- 首次安装，无上一版管理器；停用命令 systemctl disable --now listen-together-metadata。没有修改听歌后端链接或重启它，后端仍20260927-1240。
- 访问：本机运行 ssh -N -L 13100:127.0.0.1:3100 aliyun，然后打开 http://127.0.0.1:13100 。

## 边界

没有把本机23首编目、音频或封面覆盖上云。管理器编辑的是云端实际曲库；编目改动仍需维护窗口重启听歌后端才生效，删除正在播放的文件可能导致404，因此写操作应在无人使用时进行。
本轮未做浏览器目视或真机验收；第三方平台实时可用性不由离线测试保证。album/genre/year仍仅保存在编目，现有手机协议不消费。
部署脚本首次因Windows CRLF在set -euo pipefail处失败，未执行安装；转LF后成功，教训补入陷阱记录。
