# USB 真机联调

此方式通过 USB 把手机请求转发到电脑，不需要购买域名或开放 Windows 防火墙。

1. 安卓手机开启开发者选项及 USB 调试，连接电脑，在手机上允许调试。
2. PowerShell 执行：
```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb devices
```
设备状态应为 device。unauthorized 表示还需在手机上确认；列表为空时检查数据线、USB 模式或驱动。

3. 在一个 PowerShell 窗口启动演示后端：
```powershell
cd D:\ListenTogether
.\scripts\start-demo.ps1
```
保持窗口运行。曲库是两段合成测试音，不改动 media。

4. 在另一个 PowerShell 窗口安装和转发：
```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb reverse tcp:3000 tcp:3000
& $adb install -r "D:\ListenTogether\android\app\build\outputs\apk\debug\app-debug.apk"
& $adb shell am start -n com.listentogether.app/.MainActivity
```
若连接多台设备，每条 adb 命令使用 -s 设备序列号，分别设置 reverse。
拔掉 USB 或重启手机后可能需要重新执行 reverse。

5. APP 服务器地址填写 http://127.0.0.1:3000，昵称随意填写，创建房间。
先测试选歌、播放、拖动与切歌，再让第二台已转发的手机用邀请码加入。

6. 验证通知栏暂停、锁屏播放、拔耳机后的暂停；网络断开后应暂停并显示重连提示。

测试完成后可停止后端（Ctrl+C），移除转发：
```powershell
& $adb reverse --remove tcp:3000
```

USB 联调成功不能替代公网延迟和带宽测试。第一版仍需两台真机验证同步偏差。
