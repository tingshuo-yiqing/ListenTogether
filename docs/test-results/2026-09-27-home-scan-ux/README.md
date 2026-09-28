# 2026-09-27 白天 · 首页与扫码交互调整 + 相册扫码

用户连续三批反馈，本轮一次交付。设备 PHQ110 `fbddbe8`（USB，中途掉线一次并恢复，无序列号枚举异常，见第 4 节）。

## 1. 三批需求与落地

| # | 用户原话（节选） | 落地 |
|---|---|---|
| 1 | 「改一下扫二维码的位置右上角」 | 首页「加入房间」分支的整行 `FilledTonalButton`「扫描邀请二维码」删除，改为顶栏右上角 `IconButton`（`Icons.Outlined.QrCodeScanner`，content-desc「扫描邀请二维码」）；只在该分支出现，入房后该位置由「显示邀请二维码」接管 |
| 2 | 「当前扫二维码还不能扫本地的文件请修改」 | 新增 `ui/LocalQrDecoder.kt`（ZXing core 直接解码，不走 zxing-android-embedded 的相机 Activity）+ 底部弹窗 `ScanSourceSheet` 两个入口：「用相机扫描」「从相册选择图片」；相册走 `ActivityResultContracts.GetContent("image/*")`，**不申请存储权限**，解码在 `Dispatchers.IO` |
| 3 | 「去掉'此刻一起听，和朋友分享同一段旋律'」 | 首页 `JoinForm` 的 `join-heading` 项整体删除（大标题 + 副标题） |
| 4 | 「去掉二维码下面的解释，并缩小'邀请好友一起听'的字使得页面更加匀称」 | `InviteQrDialog`：解释文字删除；标题 `titleMedium`（原默认 `headlineSmall`）；二维码 `fillMaxWidth().padding(horizontal = 12.dp)` 保留呼吸位 |

## 2. 相册扫码真机验收（用户确认「二维码扫描有效果」）

- **用户实测**：相册选图 → 二维码 → **成功入房**（用户原话「有效果二维码扫描有效果」）。
- **本轮自动化取证**：`Log.i` 埋点显示 `bounds=720x720 mime=image/png` → 解码成功返回 65 字符；表单房间码与服务器地址被正确填入。
- **独立反解**：用 `jsQR`（与生成端 `qrcode` 不同实现）对设备截屏反解，成功读出完整口令（四行：来一起听歌 / 房间码 / 服务器 / 提示）。

### 验收过程中的一个真实教训
自动化选图**反复点错**：本轮边测边截屏，截图全部进入相册并占据首屏，且网格位置随每次截图变化，导致多次选中 `1080×2412` 的截图而非 720×720 的二维码图（日志里 `bounds=1080x2412` 即铁证），一度被误判为"解码器有 bug"。清理 `/sdcard/*.png` 后立刻成功。**已回填陷阱 3.10**。

## 3. 邀请二维码弹窗排版（用户点名的匀称度）

改前：`title` 用 AlertDialog 默认（`headlineSmall`）＋ 二维码 `fillMaxWidth()` ＋ 下方两行解释文字，弹窗整体偏高、标题抢视觉重量。
改后：标题 `titleMedium`；无解释文字；二维码横向留 12dp。
验证：截屏反解二维码仍成功（可扫性未被边距影响）；标题/内容/操作三段比例正常，「完成」按钮在屏内。

## 4. 环境与已知问题
- 设备一度从 `adb devices` 消失，重试第 3 次以 `(no serial number) device` 回来：序列号枚举为空但 `adb shell getprop ro.serialno` 仍返回 `fbddbe8`，此时**不带 `-s` 操作唯一设备可正常工作**，`adb reverse` 需重建。已回填陷阱 2.17。
- 本机后端（`MEDIA_DIR=D:\ListenTogether\media`）与电脑侧房主遥控（`scripts/host-remote.mjs`）在验收期间保持运行。
- `uiautomator dump` 在播放中会因进度条动画反复失败（陷阱 3.1 既有记录）；本轮多次改用**截屏 + 像素分析**定位控件（按主题青 RGB 阈值聚类出顶栏三个图标的中心坐标），比 dump 更稳。
- **云端仍未部署**（用户明确「先别动云端」）：试用环境歌词为空，因为云端后端尚无 `/lyrics` 路由——非缺陷。

## 5. 门禁
见 verification.md 本轮「APK 版本历史」行；本轮改动只涉及 `android/app`（MainActivity.kt + 新增 LocalQrDecoder.kt）与新增单测，未动 `server/`、未改协议。
