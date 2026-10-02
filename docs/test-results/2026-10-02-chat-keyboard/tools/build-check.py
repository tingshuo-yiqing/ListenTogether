"""强制执行本轮安卓门禁，并固定测试、Lint、APK 及源码版本证据。"""
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[4]
REPORT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / 'android'
for suffix in ('xml', 'html', 'txt'):
    (ANDROID / f'app/build/reports/lint-results-debug.{suffix}').unlink(missing_ok=True)
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
args = [str(ANDROID / 'gradlew.bat'), ':app:cleanTestDebugUnitTest', ':app:testDebugUnitTest', ':app:assembleDebug', ':app:lintDebug']
with (REPORT / 'android-check.log').open('w', encoding='utf-8') as out, (REPORT / 'android-check.err.log').open('w', encoding='utf-8') as err:
    result = subprocess.run(args, cwd=ANDROID, stdout=out, stderr=err)
if result.returncode:
    print(f'Android gate failed: {result.returncode}', flush=True)
    sys.exit(result.returncode)
counts = dict(tests=0, failures=0, errors=0, skipped=0, suites=0)
(REPORT / 'junit').mkdir(exist_ok=True)
for file in (ANDROID / 'app/build/test-results/testDebugUnitTest').glob('TEST-*.xml'):
    suite = ET.parse(file).getroot()
    for name in ('tests', 'failures', 'errors', 'skipped'):
        counts[name] += int(suite.get(name, '0'))
    counts['suites'] += 1
    shutil.copy2(file, REPORT / 'junit' / file.name)
lint = ANDROID / 'app/build/reports/lint-results-debug.xml'
shutil.copy2(lint, REPORT / lint.name)
apk = ANDROID / 'app/build/outputs/apk/debug/app-debug.apk'
source = ANDROID / 'app/src/main/java/com/listentogether/app/MainActivity.kt'
counts.update(startedUtc=started, completedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(), lintIssues=len(ET.parse(lint).getroot().findall('issue')), apkBytes=apk.stat().st_size, sha256=hashlib.sha256(apk.read_bytes()).hexdigest(), mainActivitySha256=hashlib.sha256(source.read_bytes()).hexdigest())
(REPORT / 'build-results.json').write_text(json.dumps(counts, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(counts, ensure_ascii=False), flush=True)
