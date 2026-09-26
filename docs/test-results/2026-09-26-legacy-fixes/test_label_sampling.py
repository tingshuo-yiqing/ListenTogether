"""离线验证历史采样脚本：失败转储不读取旧 XML，不访问真实设备。"""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("label_lag", Path(__file__).parents[1] / "2026-09-25-night-acceptance" / "label-lag.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class SamplingTest(unittest.TestCase):
    def test_failure_does_not_read_stale_xml(self):
        for code, output in [(1, ""), (0, "ERROR: could not get idle state.")]:
            with self.subTest(code=code), patch.object(module, "adb", return_value='text="已暂停"') as adb, patch.object(module.subprocess, "run", return_value=SimpleNamespace(returncode=code, stdout=output)):
                self.assertEqual("无效采样", module.ui_label())
                adb.assert_called_once_with("rm", "-f", "/sdcard/u.xml")

    def test_success_reads_new_xml(self):
        with patch.object(module, "adb", side_effect=["", '<node text="播放中"/>']) as adb, patch.object(module.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout="UI hierchary dumped to: /sdcard/u.xml")):
            self.assertEqual("播放中", module.ui_label())
            self.assertEqual(2, adb.call_count)

    def test_removed_label_is_not_reported_as_paused(self):
        with patch.object(module, "adb", side_effect=["", '<node text="有何不可"/>']), patch.object(module.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout="UI hierchary dumped to: /sdcard/u.xml")):
            self.assertEqual("无状态文案", module.ui_label())

if __name__ == "__main__":
    unittest.main()
