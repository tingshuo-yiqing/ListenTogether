"""干净复测：新建房间 → 点播放 → 同时轮询界面文案与播放器真实位置。

每个样本的时间戳在读取完成后取值，因此「翻转时刻」被限制在前后两个样本之间。
"""
import os
import re
import subprocess
import time

ADB = os.path.expandvars(r"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe")


def adb(*args):
    return subprocess.run([ADB, "shell", *args], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20).stdout


def ui_label():
    # 动画会让 dump 失败；先删除旧文件，再检查成功标志，禁止把旧树当成新样本。
    adb("rm", "-f", "/sdcard/u.xml")
    result = subprocess.run(
        [ADB, "shell", "uiautomator", "dump", "/sdcard/u.xml"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20
    )
    if result.returncode != 0 or "UI hierchary dumped to:" not in result.stdout:
        return "无效采样"
    x = adb("cat", "/sdcard/u.xml")
    m = re.findall(r'text="(播放中|已暂停|准备中|缓冲中|本机已暂停)"', x)
    return m[0] if m else "无状态文案"


def real_state():
    t = adb("dumpsys", "media_session")
    i = t.find("com.listentogether.app/androidx")
    m = re.search(r"state=PlaybackState \{state=(\w+)\(\d\), position=(\d+)", t[i:i + 2500]) if i >= 0 else None
    return (m.group(1), int(m.group(2))) if m else ("?", 0)


def tap(x, y):
    adb("input", "tap", str(x), str(y))


if __name__ == "__main__":
    print("== 冷启动并新建房间 ==")
    adb("am", "force-stop", "com.listentogether.app")
    time.sleep(1)
    adb("am", "start", "-n", "com.listentogether.app/.MainActivity")
    time.sleep(6)
    tap(330, 723)          # 创建房间 Tab
    time.sleep(2)
    tap(540, 1329)         # 主按钮（无错误提示时在此位置）
    time.sleep(8)
    print("入房后文案:", ui_label(), real_state())

    tap(966, 2190)         # 播放
    t0 = time.time()
    prev = None
    for _ in range(12):
        time.sleep(1.5)
        label = ui_label()
        state, pos = real_state()
        t = time.time() - t0
        truth = "PLAYING" if state == "PLAYING" else state
        mark = "" if (prev == label) else "  <-- 文案变化"
        print(f"点击播放后 {t:5.1f}s  界面={label:6} 播放器={truth} pos={pos/1000:.1f}s{mark}")
        prev = label
