#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""暗色冷启动白闪取证（screenrecord 在本机 segfault，改用快速连拍）。

方法：force-stop -> 基线帧 -> am start -> 尽快连拍若干帧，记录每帧相对 am start 的时刻，
再逐帧求平均亮度；若存在窗口白底闪烁，会表现为启动瞬间出现高亮度帧。
"""
import os
import re
import subprocess
import time

ADB = r"C:\Users\ting\AppData\Local\Android\Sdk\platform-tools\adb.exe"
FF = r"C:\Users\ting\ffmpeg-8.0-full_build\bin\ffmpeg.exe"
WORK = r"D:\ListenTogether\.workbuddy"
SERIAL = None


def call(args, timeout=200):
    p = subprocess.run([ADB] + args, capture_output=True, timeout=timeout)
    return p.stdout.decode("utf-8", "replace") + p.stderr.decode("utf-8", "replace")


def sh(cmd, timeout=200):
    return call(["-s", SERIAL, "shell", cmd], timeout=timeout)


for i in range(40):
    time.sleep(2)
    m = re.search(r"(?m)^(\S+)\s+device\s*$", call(["devices"]))
    if m:
        SERIAL = m.group(1)
        break
print("serial:", SERIAL)
print("screenrecord size test:",
      call(["-s", SERIAL, "shell", "screenrecord", "--size", "480x800", "--time-limit", "2",
            "/data/local/tmp/r3.mp4"])[:200])

orig = sh("cmd uimode night").strip()
print("orig uimode night:", orig)
sh("cmd uimode night yes")
time.sleep(2)
sh("am force-stop com.listentogether.app")
sh("rm -f /sdcard/flash*.png")
time.sleep(2)

frames = []
t0 = time.time()
sh("screencap -p /sdcard/flash_base.png")
frames.append(("base", time.time() - t0))
print("am start:", sh("am start -n com.listentogether.app/.MainActivity").strip()[:80])
tstart = time.time()
for i in range(9):
    sh("screencap -p /sdcard/flash%d.png" % i)
    frames.append(("flash%d" % i, time.time() - tstart))
print("--- 每帧相对 am start 的耗时(s) ---")
for name, dt in frames:
    print("  %-8s +%.2fs" % (name, dt))

names = " ".join(os.path.join("/sdcard", n + ".png") for n, _ in frames)
print("pull:", call(["-s", SERIAL, "pull"] + [n for n, _ in frames] and
                    ["/sdcard/"] + [WORK + "\\"] ) if False else "")
for n, _ in frames:
    call(["-s", SERIAL, "pull", "/sdcard/%s.png" % n, os.path.join(WORK, "%s.png" % n)])

print("--- 逐帧平均亮度（scale=1:1 灰度均值，0-255）---")
for n, dt in frames:
    p = os.path.join(WORK, "%s.png" % n)
    if not os.path.exists(p):
        print("  %-8s MISSING" % n)
        continue
    out = subprocess.run([FF, "-v", "error", "-i", p, "-vf", "scale=1:1", "-f", "rawvideo",
                          "-pix_fmt", "gray", "-"], capture_output=True).stdout
    v = out[0] if out else -1
    flag = "   <== 疑似白底窗口" if v > 200 else ""
    print("  %-8s +%.2fs  mean=%d%s" % (n, dt, v, flag))

sh("cmd uimode night %s" % ("auto" if "auto" in orig else "no"))
print("restored uimode night:", sh("cmd uimode night").strip())
