"""歌单滚动帧耗时采集：与 2026-09-25 晚 debug 包同手势协议（连续往返 / 带停顿往返）。

用法：python measure.py <包名> <标签>
先重置 gfxinfo，再按协议滑动，最后抓取 Janky frames 与百分位。
"""
import os
import re
import subprocess
import sys
import time

ADB = os.path.expandvars(r"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe")
pkg, label = sys.argv[1], sys.argv[2]
out_path = sys.argv[3] if len(sys.argv) > 3 else f"gfx-{label}.txt"


def adb(*args):
    return subprocess.run([ADB, "shell", *args], capture_output=True, text=True, encoding="utf-8", errors="replace").stdout


def swipe(x, y1, y2, dur):
    adb("input", "swipe", str(x), str(y1), str(x), str(y2), str(dur))


def measure(name, rounds, x, y1, y2, dur, pause_ms):
    adb("dumpsys", "gfxinfo", pkg, "reset")
    for i in range(rounds):
        swipe(x, y1, y2, dur)
        swipe(x, y2, y1, dur)
        if pause_ms:
            time.sleep(pause_ms / 1000)
    time.sleep(1.2)
    raw = adb("dumpsys", "gfxinfo", pkg)
    block = f"=== {name} ===\n" + raw
    with open(out_path, "a", encoding="utf-8") as f:
        f.write(block + "\n")
    frames = re.search(r"Total frames rendered: (\d+)", raw)
    janky = re.search(r"Janky frames: (\d+) \(([\d.]+)%\)", raw)
    pct = re.findall(r"(\d+)th percentile: (\d+)ms", raw)
    print(f"{name}: frames={frames.group(1) if frames else '?'} "
          f"janky={janky.group(1) if janky else '?'} ({janky.group(2) if janky else '?'}%) "
          f"percentiles={pct[:5]}")


open(out_path, "w", encoding="utf-8").close()
print(f"package={pkg} label={label}")
measure("A 连续往返 x=540 y=1850<->850 每次550ms 8轮", 8, 540, 1850, 850, 550, 0)
measure("B 带停顿往返 x=540 y=1800<->1200 每次450ms 间隔1s 4轮", 4, 540, 1800, 1200, 450, 1000)
