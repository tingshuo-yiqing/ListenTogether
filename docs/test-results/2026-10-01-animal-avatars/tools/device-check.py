import json, os, pathlib, re, subprocess, sys, time, xml.etree.ElementTree as ET

ROOT = pathlib.Path('D:/ListenTogether')
EVIDENCE = ROOT / 'docs/test-results/2026-10-01-animal-avatars'
ADB = str(pathlib.Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk/platform-tools/adb.exe')
SERIAL = '192.168.43.15:41293'
PACKAGE = 'com.listentogether.app'
checks = []

def adb(*args, timeout=25):
    r = subprocess.run([ADB, '-s', SERIAL, *map(str,args)], capture_output=True, timeout=timeout)
    out = r.stdout.decode('utf-8', errors='replace')
    if r.returncode and 'dumped to:' not in out:
        raise RuntimeError((r.stdout+r.stderr).decode('utf-8',errors='replace'))
    return out

def nodes(name='latest'):
    # 每次删旧树，接受的 XML 必须为本次生成，避免失败时复用陈旧坐标。
    for attempt in range(3):
        try:
            adb('shell','rm','-f','/data/local/tmp/lt-avatar.xml')
            adb('shell','uiautomator','dump','/data/local/tmp/lt-avatar.xml')
            raw=adb('shell','cat','/data/local/tmp/lt-avatar.xml')
            tree=ET.fromstring(raw)
            (EVIDENCE / (name+'.xml')).write_text(raw,encoding='utf-8')
            return list(tree.iter('node'))
        except (RuntimeError,ET.ParseError):
            if attempt==2: raise
            time.sleep(.5)

def tap(label, prefix=False):
    found=[n for n in nodes() if (n.get('text')==label or n.get('content-desc')==label or
        (prefix and n.get('content-desc','').startswith(label)))]
    if not found: raise RuntimeError('缺少控件：'+label)
    x1,y1,x2,y2=map(int,re.findall(r'\d+',found[-1].get('bounds')))
    adb('shell','input','tap',(x1+x2)//2,(y1+y2)//2)
    time.sleep(.6)

def shot(name):
    time.sleep(1)
    path='/data/local/tmp/lt-avatar-'+name+'.png'
    adb('shell','screencap','-p',path)
    adb('pull',path,str(EVIDENCE/(name+'.png')))
    print('截图 '+name,flush=True)

def theme(label):
    tap('选择主题，当前：',prefix=True)
    menu=nodes('theme-menu')
    options=[n.get('text') for n in menu if n.get('text') in ['浅色','深色','跟随系统']]
    assert sorted(options)==['浅色','深色'],options
    tap(label)

peer=None
try:
    adb('reverse','tcp:3000','tcp:3000')
    if '--resume' not in sys.argv:
        tap('选择主题，当前：',prefix=True)
        menu=nodes('home-theme-menu')
        assert {n.get('text') for n in menu if n.get('text') in ['浅色','深色','跟随系统']}=={'浅色','深色'}
        shot('home-theme-menu')
        tap('深色')
        adb('shell','am','force-stop',PACKAGE)
        adb('shell','am','start','-n',PACKAGE+'/.MainActivity')
        time.sleep(2)
        assert any(n.get('content-desc')=='选择主题，当前：深色' for n in nodes('dark-after-restart'))
        shot('dark-after-restart')
        theme('浅色')
        # 首页沿用已存昵称和本机地址；先切创建，再点真正的提交按钮。
        tap('创建房间')
        tap('创建房间')
        time.sleep(2)
    else:
        # 从同一个已创建房间续验；首页证据须确实存在且独立验证，不重复占用建房配额。
        archived=list(ET.parse(EVIDENCE/'home-theme-menu.xml').getroot().iter('node'))
        assert {n.get('text') for n in archived if n.get('text') in ['浅色','深色','跟随系统']}=={'浅色','深色'}
        assert any(n.get('content-desc')=='选择主题，当前：深色' for n in ET.parse(EVIDENCE/'dark-after-restart.xml').getroot().iter('node'))
    checks.append('菜单仅两项且深色冷启动保存')
    assert any(n.get('text')=='1 人一起听' for n in nodes('one-member'))
    raw_log=(EVIDENCE/'backend.log').read_bytes()
    backend_log=raw_log.decode('utf-16' if raw_log.startswith(b'\xff\xfe') else 'utf-8')
    code=[json.loads(line)['code'] for line in backend_log.splitlines()
        if line.startswith('{') and json.loads(line).get('event')=='room.created'][-1]
    ready=ROOT/'.workbuddy/avatar-peers-ready.json'
    ready.unlink(missing_ok=True)
    peer=subprocess.Popen(['node',str(EVIDENCE/'tools/peers.mjs'),code,str(ready)],stdin=subprocess.PIPE,
        stdout=open(EVIDENCE/'peers.log','w',encoding='utf-8'),stderr=subprocess.STDOUT)
    until=time.time()+12
    while not ready.exists():
        if time.time()>until: raise RuntimeError('脚本成员连接超时')
        time.sleep(.2)
    time.sleep(2)
    assert any(n.get('text')=='3 人一起听' for n in nodes('room-light'))
    shot('room-light')
    tap('3 人一起听')
    listing=nodes('members-light')
    assert all(any(n.get('text')==name for n in listing) for name in ['小王','小李'])
    shot('members-light')
    tap('关闭成员面板')
    tap('聊天',prefix=True)
    time.sleep(1)
    listing=nodes('chat-light')
    assert any(n.get('text')=='今天听什么？' for n in listing)
    shot('chat-light')
    theme('深色')
    shot('chat-dark')
    tap('待播队列')
    shot('room-dark')
    tap('3 人一起听')
    shot('members-dark')
    tap('关闭成员面板')
    theme('浅色')
    checks.extend(['三成员摘要轻微重叠，浅/深截图','成员面板与聊天头像浅/深截图'])
    # 令牌只存在脚本内存，退出后删除脚本身份；手机房主留在房间供继续调试。
    peer.stdin.write(b'leave\n'); peer.stdin.flush(); peer.wait(timeout=12); peer=None
    time.sleep(1)
    assert any(n.get('text')=='1 人一起听' for n in nodes('final-one-member'))
    checks.append('脚本成员离房收尾，手机房主保留')
    shot('final-room-light')
    installed=adb('shell','pm','path',PACKAGE).strip().split('package:')[-1]
    adb('pull',installed,str(ROOT/'.workbuddy/animal-avatar-installed.apk'),timeout=30)
    import hashlib
    expected=hashlib.sha256((ROOT/'android/app/build/outputs/apk/debug/app-debug.apk').read_bytes()).hexdigest()
    actual=hashlib.sha256((ROOT/'.workbuddy/animal-avatar-installed.apk').read_bytes()).hexdigest()
    assert actual==expected
    checks.append('已安装 APK 回拉 SHA256 与构建一致')
    (EVIDENCE/'device-results.json').write_text(json.dumps({'device':'PHQ110','code':code,'sha256':actual,
        'checks':checks},ensure_ascii=False,indent=2),encoding='utf-8')
    print('通过 '+str(len(checks))+' 组设备检查；APK '+actual,flush=True)
finally:
    if peer:
        peer.stdin.write(b'leave\n'); peer.stdin.flush(); peer.wait(timeout=12)
