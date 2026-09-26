"""真机验收辅助：截图 / 控件树 / 点击 / 输入 / 滑动（PHQ110 无线 adb）。"""
import os
import re
import subprocess
import sys

ADB = os.path.expandvars(r"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def sh(*args, binary=False):
    return subprocess.run([ADB, *args], capture_output=True, text=not binary, encoding=None if binary else "utf-8")


def shot(name):
    out = sh("exec-out", "screencap", "-p", binary=True).stdout
    with open(name, "wb") as f:
        f.write(out)
    print(f"shot -> {name} ({len(out)} bytes)")


def tree():
    sh("shell", "uiautomator", "dump", "/sdcard/u.xml")
    xml = sh("shell", "cat", "/sdcard/u.xml").stdout
    rows = []
    for m in re.finditer(r"<node([^>]*)/?>", xml):
        a = m.group(1)
        get = lambda k: (re.search(k + r'="([^"]*)"', a).group(1) if re.search(k + r'="([^"]*)"', a) else "")
        text, desc, cls = get("text"), get("content-desc"), get("class")
        clickable, enabled = get("clickable"), get("enabled")
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', a)
        if not (text or desc):
            continue
        cx = (int(b.group(1)) + int(b.group(3))) // 2 if b else -1
        cy = (int(b.group(2)) + int(b.group(4))) // 2 if b else -1
        flag = "C" if clickable == "true" else " "
        dis = "" if enabled == "true" else " [disabled]"
        rows.append(f"{text!r:44} desc={desc!r:26} {cls.split('.')[-1]:12} ({cx},{cy}) {flag}{dis}")
    print("\n".join(rows))
    return xml


def tap(x, y):
    sh("shell", "input", "tap", str(x), str(y))
    print(f"tap ({x},{y})")


def text(s):
    sh("shell", "input", "text", s)
    print(f"text -> {s}")


def key(code):
    sh("shell", "input", "keyevent", str(code))


def swipe(x1, y1, x2, y2, dur=450):
    sh("shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(dur))


if __name__ == "__main__":
    cmd = sys.argv[1]
    args = sys.argv[2:]
    {"shot": lambda: shot(args[0]), "tree": tree, "tap": lambda: tap(int(args[0]), int(args[1])),
     "text": lambda: text(args[0]), "key": lambda: key(args[0]),
     "swipe": lambda: swipe(*[int(a) for a in args])}[cmd]()
