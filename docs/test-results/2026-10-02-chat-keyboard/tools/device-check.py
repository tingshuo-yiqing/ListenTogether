"""MuMu 真实 IME 前后对照；每步新树定位，保留截图、IME/播放状态与安装哈希。"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[4]
REPORT = Path(__file__).resolve().parents[1]
ADB = str(Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk/platform-tools/adb.exe')
SERIAL = '127.0.0.1:16384'
ADB_PORT = '5038'
PACKAGE = 'com.listentogether.app'
TITLE = '合成长测试音 · 40 分钟'
records = []

def adb(*args, timeout=30, allow_failure=False):
    for attempt in range(2):
        result = subprocess.run([ADB, '-P', ADB_PORT, '-s', SERIAL, *map(str, args)], capture_output=True, timeout=timeout)
        out = result.stdout.decode('utf-8', errors='replace')
        error = (result.stdout + result.stderr).decode('utf-8', errors='replace')
        if result.returncode and attempt == 0 and any(marker in error for marker in ('cannot connect to daemon', 'device offline', 'not found', 'transport closed')):
            subprocess.run([ADB,'-P',ADB_PORT,'connect',SERIAL],capture_output=True,timeout=20)
            continue
        if result.returncode and not allow_failure and 'dumped to:' not in out: raise RuntimeError(error)
        return out

def nodes(name='latest'):
    for attempt in range(3):
        try:
            adb('shell', 'rm', '-f', '/data/local/tmp/lt-keyboard.xml')
            adb('shell', 'uiautomator', 'dump', '/data/local/tmp/lt-keyboard.xml')
            raw = adb('shell', 'cat', '/data/local/tmp/lt-keyboard.xml')
            tree = ET.fromstring(raw)
            (REPORT / f'{name}.xml').write_text(raw, encoding='utf-8')
            return list(tree.iter('node'))
        except (RuntimeError, ET.ParseError):
            if attempt == 2: raise
            time.sleep(.5)

def bounds(node):
    return tuple(map(int, re.findall(r'\d+', node.get('bounds'))))

def tap(label, prefix=False):
    matched = [n for n in nodes() if n.get('text') == label or n.get('content-desc') == label or (prefix and n.get('content-desc', '').startswith(label))]
    if not matched: raise RuntimeError('缺少控件：' + label)
    x1, y1, x2, y2 = bounds(matched[-1])
    adb('shell', 'input', 'tap', (x1+x2)//2, (y1+y2)//2)
    time.sleep(.6)

def focus_editor():
    editor = [n for n in nodes() if n.get('class') == 'android.widget.EditText'][-1]
    x1, y1, x2, y2 = bounds(editor)
    adb('shell', 'input', 'tap', (x1+x2)//2, (y1+y2)//2)
    wait_ime(True)

def ime_state():
    raw = adb('shell', 'dumpsys', 'input_method')
    # MuMu 自带输入法会把零高窗口标成 visible；必须同时确认真实占用高度。
    window = adb('shell', 'dumpsys', 'window')
    frame = re.search(r'type=ime frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\][^\r\n]*? visible=(true|false)', window)
    visible = bool(frame and frame[5] == 'true' and int(frame[4]) > int(frame[2]))
    return visible, raw

def wait_ime(expected):
    until = time.monotonic() + 8
    while time.monotonic() < until:
        visible, _ = ime_state()
        if visible == expected:
            time.sleep(.8)
            return
        time.sleep(.4)
    (REPORT/'failed-ime.txt').write_text(adb('shell','dumpsys','input_method'),encoding='utf-8')
    (REPORT/'failed-window.txt').write_text(adb('shell','dumpsys','window'),encoding='utf-8')
    adb('shell','screencap','-p','/data/local/tmp/lt-keyboard-failed.png')
    adb('pull','/data/local/tmp/lt-keyboard-failed.png',str(REPORT/'failed-ime.png'))
    raise RuntimeError(f'IME visible did not reach {expected}')

def hide_ime():
    if ime_state()[0]:
        adb('shell', 'input', 'keyevent', '4')
        wait_ime(False)

def capture(name, player, keyboard):
    time.sleep(.8)
    tree = nodes(name)
    # 点歌页也显示同名曲目；按播放器专属控制的语义识别，避免把歌名当作歌曲栏。
    has_player = any(n.get('content-desc') in {'播放', '暂停播放', '暂停本机', '恢复跟听'} for n in tree)
    visible, raw = ime_state()
    assert has_player == player, (name, has_player)
    assert visible == keyboard, (name, visible)
    (REPORT / f'{name}-ime.txt').write_text(raw, encoding='utf-8')
    window = adb('shell', 'dumpsys', 'window')
    (REPORT / f'{name}-window.txt').write_text(window, encoding='utf-8')
    path = f'/data/local/tmp/lt-keyboard-{name}.png'
    adb('shell', 'screencap', '-p', path)
    adb('pull', path, str(REPORT / f'{name}.png'))
    editors = [bounds(n) for n in tree if n.get('class') == 'android.widget.EditText']
    frame = re.search(r'type=ime frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\][^\r\n]*? visible=(true|false)', window)
    top = int(frame[2]) if keyboard else None
    gap = top - editors[-1][3] if keyboard and editors else None
    if keyboard and not player and (name.startswith('after-light') or name.startswith('after-dark')):
        assert gap is not None and 0 <= gap <= 50, (name, gap)
    row = dict(case=name, imeVisible=visible, playerVisible=has_player, editorBounds=editors, imeTopPx=top, editorClearancePx=gap)
    records.append(row)
    print(json.dumps(row, ensure_ascii=False), flush=True)

def write_pref(file, value):
    encoded = base64.b64encode(value.encode()).decode()
    adb('shell', f"run-as {PACKAGE} sh -c 'mkdir -p shared_prefs; echo {encoded} | base64 -d > shared_prefs/{file}'")

def setting(space, name, value):
    if value == 'null': adb('shell', 'settings', 'delete', space, name)
    else: adb('shell', 'settings', 'put', space, name, value)

def theme(label):
    hide_ime()
    tap('选择主题，当前：', prefix=True)
    tap(label)

def get_state():
    return json.load(urllib.request.urlopen('http://127.0.0.1:3002/__keyboard/state', timeout=5))

def control(action):
    req = urllib.request.Request('http://127.0.0.1:3002/__keyboard/'+action, data=b'{}', headers={'Content-Type': 'application/json'})
    urllib.request.urlopen(req, timeout=5).close()

def install(apk):
    adb('shell', 'am', 'force-stop', PACKAGE)
    print(adb('install', '-r', str(apk), timeout=90), flush=True)
    # MuMu 安装会重写旋转设置；每次安装后重新锁定竖屏。
    setting('system', 'accelerometer_rotation', '0')
    setting('system', 'user_rotation', '0')
    adb('shell', 'wm', 'user-rotation', 'lock', '0')

def join(code):
    write_pref('connection.xml', f'<map><string name="baseUrl">http://127.0.0.1:3002</string><string name="lastRoomCode">{code}</string><string name="lastNickname">MuMu</string></map>')
    write_pref('appearance.xml', '<map><string name="themeMode">Light</string></map>')
    adb('shell', 'am', 'start', '-n', PACKAGE+'/.MainActivity')
    time.sleep(2)
    tap('加入，一起听')
    time.sleep(2)
    tap('聊天', prefix=True)

def leave():
    hide_ime()
    tap('退出房间')
    tap('退出房间')

backend = None
original = {}
prefs = {}
test_ime_added = False
ready = ROOT / '.workbuddy/keyboard-fixture-ready.json'
try:
    # 使用独立服务端口，避免其它调试会话重启 5037 干扰这轮证据。
    subprocess.run([ADB,'-P',ADB_PORT,'connect',SERIAL],capture_output=True,check=True,timeout=25)
    for space, name in [('secure','show_ime_with_hard_keyboard'),('system','user_rotation'),('system','accelerometer_rotation')]:
        original[(space, name)] = adb('shell','settings','get',space,name).strip()
    original['wm'] = adb('shell','wm','user-rotation').strip()
    original['inputMethod'] = adb('shell','settings','get','secure','default_input_method').strip()
    # 前一次默认 ADB 中断导致 finally 未走完；以本任务最初已存设置恢复。
    initial = json.loads((REPORT/'initial-zero-height-ime/emulator-settings-before.json').read_text())
    for key in list(original):
        if isinstance(key, tuple): original[key] = initial[f'{key[0]}/{key[1]}']
    original['wm'] = initial['wm']
    original['inputMethod'] = 'com.sohu.inputmethod.sogou.chuizi/com.sohu.inputmethod.sogou.SogouIME'
    for file in ('connection.xml', 'appearance.xml'):
        prefs[file] = adb('shell', 'run-as', PACKAGE, 'cat', 'shared_prefs/'+file, allow_failure=True)
        (REPORT/('emulator-pref-before-'+file)).write_text(prefs[file],encoding='utf-8')
    (REPORT/'emulator-settings-before.json').write_text(json.dumps({f'{key[0]}/{key[1]}' if isinstance(key, tuple) else key: value for key, value in original.items()}, indent=2), encoding='utf-8')
    setting('secure', 'show_ime_with_hard_keyboard', '1')
    package_present = bool(adb('shell','pm','path','rkr.simplekeyboard.inputmethod',allow_failure=True).strip())
    test_ime_added = True  # 首轮 ime list 只有 MuMu 自带 Sogou，本任务首次安装的测试依赖。
    if not package_present:
        print(adb('install',str(ROOT/'.workbuddy/keyboard-test-ime.apk'),timeout=60),flush=True)
        test_ime_added = True
    adb('shell','ime','enable','rkr.simplekeyboard.inputmethod/.latin.LatinIME')
    adb('shell','ime','set','rkr.simplekeyboard.inputmethod/.latin.LatinIME')
    adb('reverse', 'tcp:3002', 'tcp:3002')
    ready.unlink(missing_ok=True)
    backend = subprocess.Popen(['node', str(REPORT/'tools/fixture-backend.mjs'), str(ready)], cwd=ROOT, stdin=subprocess.PIPE, stdout=(REPORT/'fixture.log').open('w', encoding='utf-8'), stderr=(REPORT/'fixture.err.log').open('w', encoding='utf-8'))
    until = time.monotonic()+12
    while not ready.exists():
        if backend.poll() is not None: raise RuntimeError('测试后端退出')
        if time.monotonic()>until: raise RuntimeError('测试后端未就绪')
        time.sleep(.2)
    code = json.loads(ready.read_text())['code']
    install(ROOT/'.workbuddy/keyboard-before.apk')
    adb('shell','ime','set','rkr.simplekeyboard.inputmethod/.latin.LatinIME')
    join(code)
    capture('before-closed', True, False)
    focus_editor()
    capture('before-keyboard', True, True)
    leave()

    apk = ROOT/'.workbuddy/chat-keyboard-debug.apk'
    install(apk)
    adb('shell','ime','set','rkr.simplekeyboard.inputmethod/.latin.LatinIME')
    join(code)
    capture('after-light-closed', True, False)
    focus_editor()
    capture('after-light-keyboard', False, True)
    for letter in 'draft':
        adb('shell','input','text',letter)
        time.sleep(.15)
    capture('after-light-draft', False, True)
    assert any(n.get('text') == 'draft' for n in nodes())
    tap('发送消息')
    assert any(entry['text']=='draft' for entry in get_state()['messages'])
    capture('after-light-sent', False, True)
    hide_ime()
    capture('after-light-restored', True, False)
    tap('待播队列')
    capture('after-queue', True, False)
    tap('点歌')
    capture('after-catalog', True, False)
    focus_editor()
    capture('after-catalog-keyboard', False, True)
    hide_ime()
    capture('after-catalog-restored', True, False)
    tap('聊天', prefix=True)
    theme('深色')
    capture('after-dark-closed', True, False)
    focus_editor()
    capture('after-dark-keyboard', False, True)
    hide_ime()
    capture('after-dark-restored', True, False)

    # 连续播放时 UI 转储可能拿不到 idle，只用键盘/MediaSession 与截图核对，避免重读旧 XML。
    editor = [n for n in nodes() if n.get('class') == 'android.widget.EditText'][-1]
    x1, y1, x2, y2 = bounds(editor)
    control('play')
    time.sleep(3)
    media_before = adb('shell','dumpsys','media_session')
    adb('shell','input','tap',(x1+x2)//2,(y1+y2)//2)
    wait_ime(True)
    time.sleep(3)
    media_open = adb('shell','dumpsys','media_session')
    adb('shell','screencap','-p','/data/local/tmp/lt-keyboard-playing.png')
    adb('pull','/data/local/tmp/lt-keyboard-playing.png',str(REPORT/'playing-keyboard.png'))
    hide_ime()
    time.sleep(2)
    media_closed = adb('shell','dumpsys','media_session')
    for name, raw in [('playing-before',media_before),('playing-keyboard',media_open),('playing-restored',media_closed)]:
        (REPORT/f'{name}-media.txt').write_text(raw,encoding='utf-8')
        assert re.search(r'state=(?:3\b|PLAYING\s*\(3\))',raw),name
    positions = [int(re.findall(r'position=(\d+)',raw)[0]) for raw in (media_before,media_open,media_closed)]
    assert positions[0] < positions[1] < positions[2],positions
    control('pause')
    capture('after-playback-restored', True, False)
    theme('浅色')
    leave()
    installed = adb('shell','pm','path',PACKAGE).strip().split('package:')[-1]
    pulled = ROOT/'.workbuddy/keyboard-mumu-installed.apk'
    adb('pull',installed,str(pulled),timeout=60)
    assert pulled.stat().st_size == apk.stat().st_size
    digest=hashlib.sha256(apk.read_bytes()).hexdigest()
    assert hashlib.sha256(pulled.read_bytes()).hexdigest()==digest
    result = dict(device='MuMu Android 15 / API 35', serial=SERIAL, resolution='1080x1920', sha256=digest, cases=records, playbackPositionsMs=positions, sentMessageConfirmed=True)
    (REPORT/'device-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('MuMu IME checks passed; installed APK hash matched',flush=True)
finally:
    if backend and backend.poll() is None:
        backend.stdin.write(b'stop\n'); backend.stdin.flush()
        try: backend.wait(timeout=8)
        except subprocess.TimeoutExpired: backend.terminate(); backend.wait(timeout=5)
    adb('shell','am','force-stop',PACKAGE,allow_failure=True)
    for file,value in prefs.items():
        if value: write_pref(file,value)
        else: adb('shell','run-as',PACKAGE,'rm','-f','shared_prefs/'+file,allow_failure=True)
    for key,value in original.items():
        if isinstance(key,tuple): setting(*key,value)
    if original.get('inputMethod'): adb('shell','ime','set',original['inputMethod'])
    if test_ime_added: adb('uninstall','rkr.simplekeyboard.inputmethod',allow_failure=True)
    if original.get('wm','').startswith('free'): adb('shell','wm','user-rotation','free')
    elif original.get('wm','').startswith('lock'): adb('shell','wm','user-rotation','lock',original['wm'].split()[-1])
    adb('reverse','--remove','tcp:3002',allow_failure=True)
    ready.unlink(missing_ok=True)
    print('Emulator keyboard/rotation/preferences restored; isolated backend stopped',flush=True)
