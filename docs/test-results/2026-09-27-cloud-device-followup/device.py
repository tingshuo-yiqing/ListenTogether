"""本轮真机取证：二进制截图直读，XML 每次新建且检查转储是否成功。"""
import json
import pathlib
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8")
ADB = r"C:\Users\ting\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = pathlib.Path(__file__).resolve().parent

def adb(*args):
    # USB 重枚举可能丢序列号；用 transport 定位，再由设备内属性核验身份（陷阱 2.17）。
    devices = subprocess.check_output([ADB, "devices", "-l"], timeout=10).decode("utf-8")
    matches = [line for line in devices.splitlines() if re.search(r"\bdevice\b.*\bmodel:PHQ110\b", line)]
    if len(matches) != 1:
        raise RuntimeError("Expected exactly one connected PHQ110: " + devices)
    target = ["-t", re.search(r"transport_id:(\d+)", matches[0]).group(1)]
    identity = subprocess.check_output([ADB, *target, "shell", "getprop", "ro.serialno"], timeout=10).decode().strip()
    if identity != "fbddbe8":
        raise RuntimeError("Unexpected device: " + identity)
    return subprocess.check_output([ADB, *target, *args], timeout=25)

def capture(name):
    (OUT / (name + ".png")).write_bytes(adb("exec-out", "screencap", "-p"))
    print(name + ".png")

def dump(name, verbose=True):
    remote = "/data/local/tmp/lt-ui-" + str(time.time_ns()) + ".xml"
    result = adb("shell", "uiautomator", "dump", remote).decode("utf-8")
    if "UI hierchary dumped to" not in result:
        raise RuntimeError(result)
    data = adb("exec-out", "cat", remote)
    adb("shell", "rm", remote)
    (OUT / (name + ".xml")).write_bytes(data)
    root = ET.fromstring(data)
    for node in root.iter("node") if verbose else []:
        a = node.attrib
        if a.get("text") or a.get("content-desc") or a.get("class", "").endswith("EditText"):
            print(json.dumps({k: a.get(k) for k in ["text", "content-desc", "class", "bounds", "clickable"]}, ensure_ascii=False))
    return root

if __name__ == "__main__":
    command, *args = sys.argv[1:]
    if command == "capture":
        capture(args[0])
    elif command == "dump":
        dump(args[0])
    elif command == "shell":
        print(adb("shell", *args).decode("utf-8"))
