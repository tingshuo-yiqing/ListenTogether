# M4 公网真机链路测试 + 图标更换（2026-09-22 深夜，E2E 按用户指示暂停）

- 标识：M4-ACCESS 公网验证第一步 + UI 图标变更；操作者：AI 助手；结果：**部分完成**——无线链路与手机→公网连通性实测通过、新图标 APK 已装机；真机公网 E2E（建房→播放）UI 自动化连续失败，**按用户指示暂停**，问题已回填陷阱清单 3.4。

## 已通过项（实测数据）

| 检查 | 实测 |
| --- | --- |
| 无线 adb 链路 | 用户给的 192.168.43.15:37765 已失效（拒绝连接 10061，疑似已关闭的配对端口）；配对码 904907 未用到——本机有历史配对记录，mDNS 通道 `adb-fbddbe8-WFMDTR._adb-tls-connect._tcp` 自动出现且 state=device（GUID 与此前一致） |
| **手机 → 公网服务器** | 设备端 `curl http://8.166.126.136:3000/health` → **`{"ok":true}`**（安全组 3000 已放行；M4 公网路径首个真机数据点） |
| 图标更换 | 背景 `#5143B8`（紫）→ `#1A73E8`（Google 蓝，与主题一致），前景换白色双音符+淡蓝声波（自适应 vector，minSdk 26 无需 PNG 回退）；构建成功 |
| 新 APK | SHA256 `BE545EEFE1C3260A8F4E00C88D8C4C14A62F1A442E7D717978107E79B4E60924`（仅图标资源变更，单测/Lint 结论不变）；`adb install -r` Success |
| 云端 | 服务 active、5 首真实曲库不变；《目及皆是你》按用户指示放弃，无需改曲库 |

## 未通过项与问题记录（暂停原因）

真机公网 E2E（填地址→昵称→创建房间→选歌→播放）连续 6 轮自动化失败，链条：

1. uiautomator dump 节点属性顺序是 **text 在 class 前**，`class="..."[^>]*text="..."` 型定位永远匹配空 → 坐标空、tap 抛异常。
2. 字段顺序靠猜（max-y=昵称）选错——源码实序为 地址→昵称→创建房间→8位邀请码→加入房间。
3. **地址框残留默认值无法清干净**：tap 后光标停在点击处，`KEYCODE_MOVE_END(123)` 在 Compose TextField 无效，DEL 只删光标前内容；多轮输入后地址框成为 `"http://8.166.126.136:3000Hosthttp://127.0.0.1:3001"` 拼接体。
4. `pm clear` 被 OPPO 拒绝（SecurityException：shell 无 CLEAR_APP_USER_DATA）。
5. 兜底方案 `run-as … sed -i` 改写 `shared_prefs/connection.xml` 的 baseUrl **静默失败**（before/after 输出完全相同，文件未变；toybox sed -i 在 run-as 下的行为待排查）。
6. 阶段性输出（两次拼接体见 [01-join-screen.png](01-join-screen.png) 与 [diag-addr.png](diag-addr.png)——均为入房页截图，记录字段实际状态）。

规避方向（下次恢复的推荐路径，已写入陷阱清单 3.4）：
- 首选 **`run-as rm shared_prefs/connection.xml`**（删除而非改写）→ 重启 app → 地址框为空 → 空框输入无拼接问题；或手机上手动输入地址（最快）。
- 定位一律在 IME 收起后 dump；节点先 `grep -o '<node[^>]*>'` 拆分再按属性独立过滤。
- 播放验证以 `dumpsys media_session` PlaybackState 位置推进为准；播放 FAB 为 content-desc="播放"，点曲目行只选曲不播。

## 边界与当前状态

- 手机当前状态：新图标 APK 已装；app 停在入房页，地址框预填旧值 `http://127.0.0.1:3001`（存储未改成功）、昵称空；**尚未在公网路径上建房/播放**；`svc power stayon true` 已设（仅充电时生效）。
- 云端无需回滚：服务与曲库正常，仅有一个来自测试会话的空房间会自动回收。
- 双机同步（M2）与公网建房播放验证仍开放；下次恢复从"地址预填修正"开始，之后步骤已验证可行（服务器侧 13/13、隧道 9/9 的等价链路在服务端成立）。
