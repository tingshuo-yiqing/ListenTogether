#!/usr/bin/env bash
# 真机验收小工具：tap / swipe / text / dump / shot
export MSYS_NO_PATHCONV=1
ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
shot() { "$ADB" exec-out screencap -p > "$1"; }
dump() { "$ADB" shell uiautomator dump /sdcard/u.xml >/dev/null 2>&1; "$ADB" shell cat /sdcard/u.xml > "$1"; }
tap() { "$ADB" shell input tap "$1" "$2"; }
text() { "$ADB" shell input text "$1"; }
key() { "$ADB" shell input keyevent "$1"; }
tree() { PYTHONIOENCODING=utf-8 python "$DIR/../show_tree.py" "$1"; }
