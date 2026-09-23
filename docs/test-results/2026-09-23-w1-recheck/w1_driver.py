#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""W1 真机验收驱动：单个进程内完成 连接 -> reverse -> UI 操作 -> 采样 -> 导出诊断。

设计约束（来自 docs/development-pitfalls.md 2.7/2.8/3.1/3.2/3.4）：
- 沙箱每次工具调用回收 adb server，因此 reverse 与后续操作必须在同一进程内完成；
- 连接断开时首页会插入横幅，布局整体下移，复用上一个进程的坐标必然点错 -> 每步重新 dump 取坐标；
- 播放中 SeekBar 动画会让 uiautomator dump 失败，因此只在暂停态取坐标。

本脚本只通过 adb 驱动 UI 与采集证据，不修改任何产品代码。
"""

import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ADB = r"C:\Users\ting\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "com.listentogether.app"
WORK = r"D:\ListenTogether\.workbuddy"
LOG = os.path.join(WORK, "w1-run.log")
SERIAL = None


def log(msg):
    line = "[%s] %s" % (time.strftime("%H:%M:%S"), msg)
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def adb(args, timeout=120):
    return subprocess.run([ADB] + args, capture_output=True, timeout=timeout)


def sh(cmd, timeout=120):
    return adb(["-s", SERIAL, "shell", cmd], timeout=timeout)


def out(p):
    return p.stdout.decode("utf-8", "replace") + p.stderr.decode("utf-8", "replace")


def connect(timeout_s=150):
    """等设备就绪；mDNS 自动重连较慢时，用 mdns services 报出的地址显式 connect 兜底。"""
    global SERIAL
    adb(["kill-server"])
    adb(["start-server"])
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        time.sleep(2)
        m = re.search(r"(?m)^(\S+)\s+device\s*$", out(adb(["devices"])))
        if m:
            SERIAL = m.group(1)
            log("connected serial=%s" % SERIAL)
            return True
        md = out(adb(["mdns", "services"]))
        mm = re.search(r"_adb-tls-connect\._tcp\s+(\S+):(\d+)", md)
        if mm:
            log("mdns says %s:%s -> explicit connect" % (mm.group(1), mm.group(2)))
            adb(["connect", "%s:%s" % (mm.group(1), mm.group(2))])
    log("ERROR: device not found after %ds" % timeout_s)
    return False


def setup_tunnel():
    p = adb(["-s", SERIAL, "reverse", "tcp:3000", "tcp:3000"])
    log("reverse: %s" % out(p).strip())
    time.sleep(1)
    body = out(sh("curl -s -m 5 http://127.0.0.1:3000/health")).strip()
    log("device-side health: %s" % body)
    return '{"ok":true}' in body


def dump(name, retries=4):
    local = os.path.join(WORK, "w1-%s.xml" % name)
    if os.path.exists(local):
        os.remove(local)
    for _ in range(retries):
        sh("uiautomator dump /sdcard/%s.xml" % name)
        adb(["-s", SERIAL, "pull", "/sdcard/%s.xml" % name, local])
        if os.path.exists(local):
            try:
                return ET.parse(local)
            except Exception as e:
                log("  dump %s parse fail: %s" % (name, e))
        time.sleep(1.5)
    log("  dump %s FAILED" % name)
    return None


def nodes(tree, cls=None, text=None, cdesc=None):
    res = []
    for n in tree.iter("node"):
        a = n.attrib
        if cls and cls not in a.get("class", ""):
            continue
        if text is not None and text not in a.get("text", ""):
            continue
        if cdesc is not None and a.get("content-desc", "") != cdesc:
            continue
        res.append(a)
    return res


def center(a):
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", a.get("bounds", ""))
    x1, y1, x2, y2 = [int(v) for v in m.groups()]
    return (x1 + x2) // 2, (y1 + y2) // 2


def tap(x, y, settle=1.0):
    sh("input tap %d %d" % (x, y))
    time.sleep(settle)


def media_state():
    """返回 (state, position, buffered, speed, updated)；解析失败返回 None。"""
    txt = out(sh("dumpsys media_session"))
    m = re.search(
        r"package=com\.listentogether\.app[\s\S]{0,800}?state=(\w+)\((-?\d+)\), position=(\d+), "
        r"buffered position=(\d+), speed=([\d.\-]+), updated=(\d+)",
        txt,
    )
    if not m:
        return None
    return (m.group(1), int(m.group(3)), int(m.group(4)), float(m.group(5)), int(m.group(6)))


def start_app():
    sh("am force-stop %s" % PKG)
    time.sleep(1)
    sh("am start -n %s/.MainActivity" % PKG)
    time.sleep(5)


def join_room(dump_tag):
    """填昵称并创建房间；返回 (room_code, tree)。"""
    t = dump(dump_tag + "-form")
    if t is None:
        return None, None
    edits = [a for a in nodes(t, cls="EditText")]
    if not edits:
        log("ERROR: no EditText in join form")
        return None, None
    # 昵称是入房页第一个输入框（创建模式下唯一一个可编辑框）
    name_box = None
    for a in edits:
        if a.get("text", "") == "":
            name_box = a
            break
    if name_box is None:
        log("ERROR: nickname box not empty")
        return None, None
    x, y = center(name_box)
    tap(x, y, 1.5)
    sh("input text W1")
    time.sleep(1.0)
    sh("input keyevent 111")
    time.sleep(1.5)

    t = dump(dump_tag + "-filled")
    if t is None:
        return None, None
    btns = [a for a in nodes(t, cls="Button")]
    if not btns:
        log("ERROR: no Button")
        return None, None

    def width(a):
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", a.get("bounds", ""))
        return int(m.group(3)) - int(m.group(1))

    main = max(btns, key=width)
    x, y = center(main)
    tap(x, y, 8.0)
    t = dump(dump_tag + "-room")
    if t is None:
        return None, None
    code = None
    for a in nodes(t, cls="TextView"):
        v = a.get("text", "")
        if re.fullmatch(r"[0-9A-F]{8}", v):
            code = v
            break
    log("room code = %s" % code)
    return code, t


def find_fab(tree):
    for cd in ("播放", "暂停"):
        got = nodes(tree, cdesc=cd)
        if got:
            return got[0], cd
    return None, None


def export_diag(tag):
    txt = out(sh("run-as %s ls files/diagnostics/" % PKG))
    names = re.findall(r"(diag-\d{8}-\d{6}\.jsonl)", txt)
    if not names:
        log("ERROR: no diag file")
        return None
    latest = sorted(set(names))[-1]
    raw = sh("run-as %s cat files/diagnostics/%s" % (PKG, latest), timeout=180).stdout.decode(
        "utf-8", "replace"
    )
    path = os.path.join(WORK, "w1-%s-%s" % (tag, latest))
    with open(path, "w", encoding="utf-8") as f:
        f.write(raw)
    log("diag exported: %s (%d bytes, file=%s)" % (path, len(raw), latest))
    return path


def flinger(tag):
    txt = out(sh("dumpsys media.audio_flinger"))
    keep = [l.strip() for l in txt.splitlines() if "underrun" in l.lower() or "empty=" in l]
    log("flinger[%s]: %s" % (tag, " || ".join(keep[:6])))
    return keep


def analyze(path, tag):
    if not path or not os.path.exists(path):
        return
    recs = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            import json

            recs.append(json.loads(line))
        except Exception:
            pass
    pb = [r for r in recs if r.get("type") == "playback"]
    if not pb:
        log("analyze[%s]: no playback records" % tag)
        return
    from collections import Counter

    corr = Counter(r.get("correction", "") for r in pb)
    log("analyze[%s]: playback=%d window=%.1fs corrections=%s" % (
        tag, len(pb), (pb[-1]["wallClockMs"] - pb[0]["wallClockMs"]) / 1000.0, dict(corr)))
    seeks = [r["wallClockMs"] for r in pb if r.get("correction") == "seek"]
    if len(seeks) > 1:
        diffs = [round((seeks[i + 1] - seeks[i]) / 1000.0, 2) for i in range(len(seeks) - 1)]
        log("analyze[%s]: seek count=%d intervals(s)=%s" % (tag, len(seeks), diffs[:40]))
    else:
        log("analyze[%s]: seek count=%d" % (tag, len(seeks)))
    sp = [r["wallClockMs"] for r in pb if r.get("correction") == "speed"]
    log("analyze[%s]: speed count=%d" % (tag, len(sp)))
    log("analyze[%s]: buffering true count=%d" % (tag, sum(1 for r in pb if r.get("buffering"))))
    # 位置推进速率：取相邻两条 correction 为空且位置在推进的记录
    rates = []
    for i in range(1, len(pb)):
        a, b = pb[i - 1], pb[i]
        if a.get("correction") or b.get("correction"):
            continue
        if a.get("buffering") or b.get("buffering"):
            continue
        dt = (b["wallClockMs"] - a["wallClockMs"]) / 1000.0
        dp = b["playerPositionMs"] - a["playerPositionMs"]
        if 0.5 <= dt <= 5.0 and dp >= 0:
            rates.append(dp / dt)
    if rates:
        rates.sort()
        log("analyze[%s]: position rate median=%.3f p10=%.3f p90=%.3f n=%d" % (
            tag, rates[len(rates) // 2], rates[int(len(rates) * 0.1)], rates[int(len(rates) * 0.9)], len(rates)))
    drift = [abs(r.get("driftMs", 0)) for r in pb]
    if drift:
        log("analyze[%s]: |drift| median=%dms max=%dms" % (
            tag, sorted(drift)[len(drift) // 2], max(drift)))
    sy = [r for r in recs if r.get("type") == "sync"]
    if sy:
        rtts = sorted(r.get("rttMs", 0) for r in sy)
        offs = [r.get("offsetMs", 0) for r in sy]
        log("analyze[%s]: sync samples=%d rtt median=%dms max=%dms offset spread=%dms" % (
            tag, len(sy), rtts[len(rtts) // 2], rtts[-1], max(offs) - min(offs)))
    vers = sorted(set(r.get("version", 0) for r in pb if r.get("version") is not None))
    log("analyze[%s]: room versions seen = %s" % (tag, vers))


def sample_loop(seconds, interval=15.0, label=""):
    t0 = time.time()
    rows = []
    while time.time() - t0 < seconds:
        time.sleep(interval)
        st = media_state()
        el = int(time.time() - t0)
        el_ms = 0
        if st:
            if rows:
                el_ms = st[1] - rows[-1][2]
            rate = ""
            if rows and rows[-1][0] == st[1] and el_ms:
                rate = " (Δpos=%dms)" % el_ms
            rows.append((el, st[0], st[1]))
            log("sample[%s] t=+%ds state=%s pos=%d buf=%d speed=%.2f updated=%d%s" % (
                label, el, st[0], st[1], st[2], st[3], st[4], rate))
        else:
            log("sample[%s] t=+%ds PARSE_FAIL" % (label, el))
    if len(rows) >= 2:
        dpos = rows[-1][2] - rows[0][2]
        dt = (rows[-1][0] - rows[0][0])
        if dt > 0:
            log("sample[%s] overall position rate = %.3f x (%dms over %ds)" % (
                label, dpos / float(dt * 1000), dpos, dt))
    return rows


def phase_close():
    """W1-2：关省电播放长曲，采样并导出诊断。"""
    if not connect() or not setup_tunnel():
        return 1
    log("low_power=" + out(sh("settings get global low_power")).strip())
    flinger("before")
    start_app()
    code, t = join_room("a")
    if not code or t is None:
        return 1
    rows = [a for a in nodes(t, cls="TextView", text="40 分钟")]
    if not rows:
        log("ERROR: 40min row not found")
        return 1
    row = max(rows, key=lambda a: center(a)[1])
    tap(*center(row), settle=2.0)
    t = dump("a-after-select") or t
    fab, label = find_fab(t)
    if not fab:
        log("ERROR: FAB not found")
        return 1
    log("FAB(%s) at %s" % (label, center(fab)))
    tap(*center(fab), settle=8.0)
    st = media_state()
    log("state after play: %s" % (st,))
    if not st or st[0] != "PLAYING":
        log("WARN: not PLAYING, continue sampling anyway")
    sample_loop(180, 15.0, "close")
    path = export_diag("close")
    analyze(path, "close")
    flinger("after")
    return 0


def phase_open():
    """W1-3：开省电复测。"""
    if not connect() or not setup_tunnel():
        return 1
    # OPPO 上 shell 无 WRITE_SECURE_SETTINGS，settings put global low_power 被拒；
    # cmd power set-mode 1 是官方 shell 通路（1=low power on）。
    sh("dumpsys battery reset")
    log("cmd power set-mode 1 -> %s" % out(sh("cmd power set-mode 1")).strip())
    time.sleep(3)
    lp = out(sh("settings get global low_power")).strip()
    st = out(sh("settings get global low_power_sticky")).strip()
    log("low_power=%s sticky=%s" % (lp, st))
    if lp != "1":
        log("ERROR: cannot enable low_power")
        return 1
    flinger("before")
    start_app()
    code, t = join_room("b")
    if not code or t is None:
        return 1
    rows = [a for a in nodes(t, cls="TextView", text="40 分钟")]
    row = max(rows, key=lambda a: center(a)[1])
    tap(*center(row), settle=2.0)
    t = dump("b-after-select") or t
    fab, label = find_fab(t)
    if not fab:
        log("ERROR: FAB not found")
        return 1
    tap(*center(fab), settle=8.0)
    log("state after play: %s" % (media_state(),))
    sample_loop(180, 15.0, "open")
    path = export_diag("open")
    analyze(path, "open")
    flinger("after")
    sh("cmd power set-mode 0")
    time.sleep(2)
    log("low_power restored to " + out(sh("settings get global low_power")).strip())
    return 0


def screencap(tag):
    sh("screencap -p /sdcard/%s.png" % tag)
    local = os.path.join(WORK, "%s.png" % tag)
    adb(["-s", SERIAL, "pull", "/sdcard/%s.png" % tag, local])
    log("screenshot: %s (%s bytes)" % (local, os.path.getsize(local) if os.path.exists(local) else -1))
    return local


def analyze_transitions(path, tag):
    """按 trackId 分组，报告切歌时刻与切歌后首次出现推进位置（≈出声）的耗时。"""
    if not path or not os.path.exists(path):
        return
    import json

    recs = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line:
            try:
                recs.append(json.loads(line))
            except Exception:
                pass
    pb = [r for r in recs if r.get("type") == "playback"]
    segs = []
    for r in pb:
        if not segs or segs[-1][0] != r.get("trackId"):
            segs.append((r.get("trackId"), []))
        segs[-1][1].append(r)
    for i, (tid, rs) in enumerate(segs):
        log("seg[%d] track=%s records=%d t=[%.1fs..%.1fs]" % (
            i, tid, len(rs), (rs[0]["wallClockMs"] - pb[0]["wallClockMs"]) / 1000.0,
            (rs[-1]["wallClockMs"] - pb[0]["wallClockMs"]) / 1000.0))
        if i > 0:
            prev = segs[i - 1][1][-1]
            t_end = prev["wallClockMs"]
            first_sound = None
            for r in rs:
                if r["playerPositionMs"] > 300 and not r.get("buffering"):
                    first_sound = r
                    break
            if first_sound:
                log("  -> 切歌后首个推进位置: +%.2fs (pos=%dms, buffering=%s, corr=%r)" % (
                    (first_sound["wallClockMs"] - t_end) / 1000.0, first_sound["playerPositionMs"],
                    first_sound.get("buffering"), first_sound.get("correction", "")))
            else:
                log("  -> WARN: 未在记录中观察到切歌后的推进位置")
            n_seek = sum(1 for r in rs if r.get("correction") == "seek")
            log("  -> 新段内 correction 记录: seek=%d speed=%d buffering=%d" % (
                n_seek, sum(1 for r in rs if r.get("correction") == "speed"),
                sum(1 for r in rs if r.get("correction") == "buffering")))


def phase_advance():
    """W1-4：自然播完一首 -> 自动切歌，观察切歌后出声与是否连环 seek；顺带取亮色截图。"""
    if not connect() or not setup_tunnel():
        return 1
    log("low_power=" + out(sh("settings get low_power")).strip())
    start_app()
    code, t = join_room("c")
    if not code or t is None:
        return 1
    rows = [a for a in nodes(t, cls="TextView", text="30 秒")]
    if not rows:
        log("ERROR: 30s row not found")
        return 1
    row = max(rows, key=lambda a: center(a)[1])
    tap(*center(row), settle=2.0)
    t = dump("c-after-select") or t
    fab, label = find_fab(t)
    if not fab:
        log("ERROR: FAB not found")
        return 1
    tap(*center(fab), settle=6.0)
    log("state after play: %s" % (media_state(),))
    screencap("light-playing")
    sample_loop(130, 5.0, "advance")
    path = export_diag("advance")
    analyze(path, "advance")
    analyze_transitions(path, "advance")
    return 0


def play_track(tag, match):
    """起播指定曲目（按曲名片段匹配歌单行），返回首个 media_session 状态。"""
    start_app()
    code, t = join_room(tag)
    if not code or t is None:
        return None
    rows = [a for a in nodes(t, cls="TextView", text=match)]
    if not rows:
        log("ERROR: playlist row %r not found" % match)
        return None
    row = max(rows, key=lambda a: center(a)[1])
    tap(*center(row), settle=2.0)
    t2 = dump(tag + "-sel") or t
    fab, label = find_fab(t2)
    if not fab:
        log("ERROR: FAB not found")
        return None
    tap(*center(fab), settle=7.0)
    st = media_state()
    log("state after play: %s" % (st,))
    return st


def phase_ui():
    """W1-4/W1-5：亮/暗两套主题下目视进度条端点并实测拖动（真实 seek 应只发生一次）。"""
    if not connect() or not setup_tunnel():
        return 1
    log("low_power=" + out(sh("settings get low_power")).strip())
    orig = out(sh("cmd uimode night")).strip()
    log("uimode night (orig) = %r" % orig)
    for theme, night in (("light", "no"), ("dark", "yes")):
        log("=== theme=%s (uimode night %s) ===" % (theme, night))
        sh("cmd uimode night %s" % night)
        time.sleep(2)
        st = play_track("e-%s" % theme, "40 分钟")
        if st is None:
            return 1
        time.sleep(6)
        screencap("%s-playing" % theme)
        before = media_state()
        log("%s before drag: %s" % (theme, (before,)))
        sh("input swipe 300 860 800 860 700")
        time.sleep(5)
        after = media_state()
        log("%s after drag: %s" % (theme, (after,)))
        if before and after:
            log("%s drag: position %.1fs -> %.1fs (target=%.1fs)" % (
                theme, before[1] / 1000.0, after[1] / 1000.0, 40 * 60 * 0.77))
        screencap("%s-after-drag" % theme)
        time.sleep(2)
    sh("cmd uimode night %s" % ("auto" if "auto" in orig else "no"))
    log("uimode night restored: %s" % out(sh("cmd uimode night")).strip())
    path = export_diag("ui")
    analyze(path, "ui")
    return 0


def write_base_url(url):
    """ConnectionStore 即 SharedPreferences connection.xml 的 baseUrl；直接写存储层，
    避开 Compose 文本框的自动化缺陷（陷阱 3.4）。"""
    import base64

    xml = ("<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n"
           "    <string name=\"baseUrl\">%s</string>\n</map>\n" % url)
    b64 = base64.b64encode(xml.encode("utf-8")).decode("ascii")
    sh("run-as %s sh -c 'echo %s | base64 -d > shared_prefs/connection.xml'" % (PKG, b64))
    got = out(sh("run-as %s cat shared_prefs/connection.xml" % PKG))
    log("baseUrl written: %s" % ("OK" if url in got else "FAILED"))
    return url in got


def playlist_rows(tree):
    """返回歌单标题 TextView（排除时长、顶部当前歌曲卡片）。"""
    label = None
    for a in nodes(tree, cls="TextView", text="歌单"):
        label = center(a)[1]
        break
    if label is None:
        return []
    res = []
    for a in nodes(tree, cls="TextView"):
        t = a.get("text", "")
        if not t or re.fullmatch(r"\d+:\d{2}(:\d{2})?", t):
            continue
        if re.fullmatch(r"[0-9A-F]{8}", t):
            continue
        x, y = center(a)
        if y > label + 20:
            res.append(a)
    return res


def phase_e2e():
    """W2：公网 E2E（建房->选歌->播放->暂停->拖动->切歌->退出）。"""
    if not connect():
        return 1
    cloud = "http://8.166.126.136:3000"
    if not setup_tunnel():
        log("WARN: local reverse not verified (not required for public path)")
    log("device-side public health: %s" % out(sh("curl -s -m 8 %s/health" % cloud)).strip())
    write_base_url(cloud)
    start_app()
    code, t = join_room("w2")
    if not code or t is None:
        return 1
    rows = playlist_rows(t)
    log("playlist rows: %s" % [a.get("text") for a in rows])
    if len(rows) < 2:
        log("ERROR: need >=2 songs in cloud library")
        return 1
    order = [rows[1], rows[0], rows[-1]]
    log("=== step: select+play '%s' ===" % order[0].get("text"))
    tap(*center(order[0]), settle=2.5)
    t = dump("w2-after-select") or t
    fab, label = find_fab(t)
    if not fab:
        log("ERROR: FAB not found")
        return 1
    fabc = center(fab)
    log("FAB(%s) at %s" % (label, fabc))
    tap(*fabc, settle=9.0)
    st = media_state()
    log("play: %s" % (st,))
    for i in range(3):
        time.sleep(5)
        log("  playing sample %d: %s" % (i + 1, (media_state(),)))
    log("=== step: pause ===")
    tap(*fabc, settle=4.0)
    p1 = media_state()
    log("after tap1(pause): %s" % (p1,))
    log("=== step: drag ===")
    sh("input swipe 300 860 700 860 700")
    time.sleep(5)
    p2 = media_state()
    log("after drag: %s" % (p2,))
    log("=== step: switch track to '%s' ===" % order[1].get("text"))
    tap(*center(order[1]), settle=3.0)
    t2 = dump("w2-after-switch")
    if t2:
        rows2 = playlist_rows(t2)
        log("rows after switch: %s" % [a.get("text") for a in rows2])
        fab2, l2 = find_fab(t2)
        if fab2:
            log("FAB after switch: %s %s" % (l2, center(fab2)))
            if l2 == "播放":
                tap(*center(fab2), settle=8.0)
    st = media_state()
    log("after switch play: %s" % (st,))
    for i in range(2):
        time.sleep(5)
        log("  post-switch sample %d: %s" % (i + 1, (media_state(),)))
    log("=== step: exit room ===")
    ex = nodes(t, cdesc="退出房间")
    if ex:
        tap(*center(ex[0]), settle=3.0)
        t3 = dump("w2-confirm")
        if t3:
            btn = [a for a in nodes(t3, cls="TextView", text="退出房间")]
            if btn:
                tap(*center(btn[0]), settle=5.0)
            else:
                log("ERROR: confirm dialog button not found")
        t4 = dump("w2-after-exit")
        if t4:
            form = nodes(t4, cls="EditText")
            log("exit -> EditText count after exit = %d (入房页应为 %d)" % (len(form), 1))
    else:
        log("ERROR: exit icon not found")
    path = export_diag("e2e")
    analyze(path, "e2e")
    return 0


def find_text(tree, text):
    for a in nodes(tree, cls="TextView"):
        if a.get("text", "") == text:
            return a
    return None


def phase_e2e2():
    """W2 补做：真正的切歌（换另一首）+ 退出房间。"""
    if not connect():
        return 1
    t = dump("w2b-now")
    if t is None:
        return 1
    log("playlist rows now: %s" % [a.get("text") for a in playlist_rows(t)])
    target = find_text(t, "痴心绝对")
    if target is None:
        log("ERROR: 痴心绝对 row not found")
        return 1
    log("=== step: switch track to 痴心绝对 (tap %s) ===" % (center(target),))
    tap(*center(target), settle=3.0)
    t2 = dump("w2b-after-switch")
    fab, label = find_fab(t2) if t2 else (None, None)
    if not fab:
        log("ERROR: FAB not found after switch")
        return 1
    log("FAB after switch = %s at %s" % (label, center(fab)))
    if label == "播放":
        tap(*center(fab), settle=9.0)
    log("after switch: %s" % (media_state(),))
    for i in range(3):
        time.sleep(5)
        log("  playing sample %d: %s" % (i + 1, (media_state(),)))
    log("=== step: exit room ===")
    t3 = dump("w2b-before-exit")
    if t3 is None:
        log("ERROR: dump before exit failed")
        return 1
    ex = nodes(t3, cdesc="退出房间")
    log("exit icon candidates: %s" % [(a.get("bounds"), a.get("class")) for a in ex])
    if not ex:
        return 1
    tap(*center(ex[0]), settle=3.5)
    t4 = dump("w2b-confirm")
    btns = [a for a in nodes(t4, cls="TextView")] if t4 else []
    log("dialog texts: %s" % [a.get("text") for a in btns if a.get("text")])
    conf = [a for a in btns if a.get("text", "") == "退出房间"]
    if not conf:
        log("ERROR: confirm button not found")
        return 1
    tap(*center(conf[0]), settle=6.0)
    t5 = dump("w2b-after-exit")
    if t5:
        edits = nodes(t5, cls="EditText")
        texts = [a.get("text") for a in nodes(t5, cls="TextView") if a.get("text")]
        log("after exit: EditText=%d texts=%s" % (len(edits), texts[:8]))
    path = export_diag("e2e2")
    analyze(path, "e2e2")
    analyze_transitions(path, "e2e2")
    return 0


def phase_w2shot():
    """W2 取证：公网房间内播放真实歌曲的现场截图 + 退出清理。"""
    if not connect():
        return 1
    start_app()
    code, t = join_room("w2c")
    if not code or t is None:
        return 1
    target = find_text(t, "单车")
    if target is None:
        log("ERROR: 单车 row not found")
        return 1
    tap(*center(target), settle=2.5)
    t2 = dump("w2c-after-select") or t
    fab, label = find_fab(t2)
    if not fab:
        return 1
    tap(*center(fab), settle=9.0)
    log("public play: %s" % (media_state(),))
    time.sleep(4)
    screencap("public-playing")
    log("public sample: %s" % (media_state(),))
    ex = nodes(t2, cdesc="退出房间")
    if ex:
        tap(*center(ex[0]), settle=3.0)
        t3 = dump("w2c-confirm")
        conf = [a for a in nodes(t3, cls="TextView", text="退出房间")] if t3 else []
        if conf:
            tap(*center(conf[0]), settle=5.0)
            log("exited public room %s" % code)
    path = export_diag("w2c")
    analyze(path, "w2c")
    analyze_transitions(path, "w2c")
    return 0


def main():
    phase = sys.argv[1] if len(sys.argv) > 1 else "close"
    if phase == "close":
        return phase_close()
    if phase == "open":
        return phase_open()
    if phase == "advance":
        return phase_advance()
    if phase == "ui":
        return phase_ui()
    if phase == "e2e":
        return phase_e2e()
    if phase == "e2e2":
        return phase_e2e2()
    if phase == "w2shot":
        return phase_w2shot()
    log("unknown phase %s" % phase)
    return 2


if __name__ == "__main__":
    sys.exit(main())
