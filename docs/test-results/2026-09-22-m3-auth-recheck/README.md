# M3-AUTH 横幅持久性复验（APK 832FB65E）—— 无线通道，PASS

- 日期：2026-09-22 21:16–21:40
- 设备：OPPO PHQ110（Android 14），无线 adb `192.168.43.15:41145`（端口随 adbd 重启轮换，见陷阱清单 2.8）
- 装机确认：拉取 `/data/app/.../base.apk`（24,417,854 字节），SHA256
  `832fb65ea4b606eb1c3ebfce0eeaa887c585097d30219c1b11ed3884f907d09b`，
  与 verification.md 记录的 832FB65E 完全一致（复验对象正确）。
- 链路：APP 填 `http://127.0.0.1:3001`（故障代理，reverse tcp:3001）→ `127.0.0.1:3000` 演示后端。
  代理自检 `__fault/status` 正常；设备端 curl 3000/health 返回 `{"ok":true}`。

## 步骤与实测数据

1. 房间 6903C8E6（昵称 BannerTest，房主）；选择曲目 `demo-load`（合成负载测试音 11 分钟 192kbps）。
2. 点播放 FAB 开播（发现：**点曲目行只选曲不播**，见下"流程发现"）。媒体会话 PLAYING(3)，speed=1.0。
3. 注入 `__fault/audio401?seconds=120` → 滑动 seek 到 10:47（未缓冲区，buffered 仅 ~64s 前瞻）。
4. 媒体会话 `state=ERROR(7)`，position 冻结 647193ms，error=Source error；代理统计 `audio401:4`——
   **4 次 401 即停，无无限重试**，与首轮 M3-AUTH（8CF98CE1）结论一致。
5. 横幅持久性采样 ×5（间隔 ~5s，**全部在注入窗口过期后**，横跨 ≥5 个校时周期）：
   - `重新加入`（401 文案）**5/5**；`已同步` **0/5** → **BANNER VERDICT: PASS**。
   - 832FB65E 的修复（周期校时保留 localPause 原提示，不覆盖为"已同步"）成立。
6. 诊断 JSONL（diag-20260922-211705.jsonl，1011 行）：错误沿记录
   `{"type":"playback",...,"playerPositionMs":647193,"localPause":true,"correction":"error:ERROR_CODE_IO_BAD_HTTP_STATUS"}`——
   401 边沿正确记录（localPause 诊断盲区修复成立），error 条目仅 1 条。
7. 清除注入 → 明确点击播放 FAB → PLAYING(3) 恢复，横幅回到"已同步"（PASS）。
8. 退出房间，回到入房页；`svc power stayon false`。

## 结论

| 验收项 | 结果 |
| --- | --- |
| seek 未缓冲区触发 401，4 次即停 | PASS（代理 audio401:4，ERROR(7)，无无限重试） |
| 横幅持续显示 401 文案（≥5 采样） | PASS（5/5，含窗口过期后） |
| 周期校时不覆盖为"已同步" | PASS（0/5 回归） |
| JSONL localPause 边沿 + 401 错误分类 | PASS（correction:error:ERROR_CODE_IO_BAD_HTTP_STATUS） |
| 清除后明确播放续播、横幅恢复已同步 | PASS |

**832FB65E 的 M3-AUTH 横幅持久性复验通过；verification.md 对应挂起项关闭。**

## 流程发现（已回填脚本）

1. 点曲目行 = 选曲（version+1，保持暂停），必须再点 content-desc="播放" FAB 才开播——
   `m3-auth-recheck.sh` 已加"选曲后点 FAB"兜底。
2. 连接状态横幅可能被"正在播放"卡片遮挡（dump 完全看不到文案，截图可见残影）——
   采样前先向下滑动露出横幅（脚本已加）；横幅出现后布局下移，FAB 坐标需重新 dump。
3. 无线链路受 OPPO 息屏影响：屏幕超时 shell 修改被拒（WRITE_SETTINGS 权限），原值 30 分钟够用；
   长测试仍建议亮屏操作（陷阱 2.8）。

## 证据文件

- `device-run.log` —— 全程时间线（含 21:01 无线通道失联与 21:16 恢复）
- `shots/01-initial.png`（入房页）、`02-room.png`（建房）、`04-after-401.png`（ERROR 态，横幅被卡片遮挡形态）、
  `05-banner-1..5.png`（横幅"登录已失效，请退出房间后重新加入"持续显示）、`06-resumed.png`（续播）
- `diagnostics.jsonl` —— 客户端诊断（1011 行，含 401 错误沿）
- `ui.xml` —— 过程中的 UI dump 快照
