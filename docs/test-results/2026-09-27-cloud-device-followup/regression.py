"""暂停歌曲翻页回归：前置为本轮云端房间、《有何不可》0:50、正常字号的展开歌词页。"""
import json
import time
import xml.etree.ElementTree as ET
from device import OUT, adb, capture, dump

line = "別再那麼淘氣"

def bounds(root):
    nodes = [n for n in root.iter("node") if n.get("text") == line]
    return nodes[0].get("bounds") if len(nodes) == 1 else None

expected = bounds(ET.parse(OUT / "05-lyrics-before.xml").getroot())
assert expected is not None
assert bounds(ET.parse(OUT / "06-lyrics-stuck.xml").getroot()) is None
assert bounds(ET.parse(OUT / "14-final-recovered.xml").getroot()) == expected

results = []
for i, duration in enumerate([180, 90, 350], 1):
    adb("shell", "input", "swipe", "540", "2010", "540", "1580", str(duration))
    time.sleep(3)
    root = dump(f"15-recovery-{i}", verbose=False)
    actual = bounds(root)
    assert actual == expected, (i, expected, actual)
    assert any(n.get("text") == "0:50" for n in root.iter("node"))
    results.append({"swipeMs": duration, "waitSeconds": 3, "bounds": actual, "pass": True})
capture("15-recovery-final")
(OUT / "device-regression.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print(json.dumps(results, indent=2))
