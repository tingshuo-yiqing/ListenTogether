"""最终交互回归：无返回按钮，继续滚动重置三秒等待；暂停曲目仍能自动归位。"""
import json
import xml.etree.ElementTree as ET
from PIL import Image, ImageChops, ImageStat
from device import OUT, adb, dump

# 前置：PHQ110 默认字号，《有何不可》暂停于 0:50，歌词展开且当前句居中。
region = (72, 1524, 1008, 2184)
stages = ["baseline", "early", "continued", "settled"]
commands = [
    "screencap -p /data/local/tmp/lt-three-baseline.png",
    "input swipe 540 2010 540 1580 800",
    "sleep 1",
    "screencap -p /data/local/tmp/lt-three-early.png",
    "input swipe 540 2010 540 1580 800",
    "sleep 1",
    "screencap -p /data/local/tmp/lt-three-continued.png",
    "sleep 5",
    "screencap -p /data/local/tmp/lt-three-settled.png",
]
adb("shell", "; ".join(commands))
for stage in stages:
    adb("pull", f"/data/local/tmp/lt-three-{stage}.png", str(OUT / f"26-three-{stage}.png"))

baseline = Image.open(OUT / "26-three-baseline.png").convert("RGB").crop(region)
differences = {}
for stage in stages[1:]:
    sample = Image.open(OUT / f"26-three-{stage}.png").convert("RGB").crop(region)
    differences[stage] = sum(ImageStat.Stat(ImageChops.difference(baseline, sample)).mean) / 3
assert differences["early"] > 1, differences
assert differences["continued"] > 1, differences
assert differences["settled"] < 0.1, differences
root = dump("26-three-settled", verbose=False)
texts = [n.get("text") for n in root.iter("node")]
assert "0:50" in texts and "別再那麼淘氣" in texts
assert "回到当前歌词" not in texts
result = {"earlyStillBrowsing": True, "continuedStillBrowsing": True,
          "settledMatchesBaseline": True, "pixelMeanDifference": differences,
          "pausePosition": "0:50", "returnButtonPresent": False}
(OUT / "three-second-regression.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
