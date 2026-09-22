#!/usr/bin/env bash
# M3-AUTH banner persistence re-verification - wireless all-in-one driver.
# Everything runs in ONE process: the adb server/daemon only survives within a
# single command's lifetime in this environment, and a wireless transport dies
# with the server (see docs/development-pitfalls.md 2.7).
# Evidence: docs/test-results/2026-09-22-m3-auth-recheck/
set -u
export LC_ALL=C
ADB="${ADB:-$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe}"
HOST="192.168.43.15"
SERIAL="${SERIAL:-fbddbe8}"       # USB serial by default; pass SERIAL=ip:port for wireless
OUT_DIR="D:/ListenTogether/docs/test-results/2026-09-22-m3-auth-recheck"
SHOT_DIR="$OUT_DIR/shots"
LOG="$OUT_DIR/device-run.log"
XML="$OUT_DIR/ui.xml"
mkdir -p "$SHOT_DIR"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
fail() { say "FATAL: $*"; exit 1; }
DEV() { "$ADB" -s "$SERIAL" "$@"; }

# --- 0. transport up ---------------------------------------------------------
if [[ "$SERIAL" == *:* ]]; then
  "$ADB" start-server >/dev/null 2>&1
  sleep 1
  "$ADB" connect "$SERIAL" >/dev/null 2>&1
  STATE=""
  for i in $(seq 1 15); do
    STATE=$("$ADB" devices | grep "$HOST" | awk '{print $2}')
    [ "$STATE" = "device" ] && break
    if [ "$STATE" = "offline" ]; then "$ADB" connect "$SERIAL" >/dev/null 2>&1; fi
    sleep 2
  done
  if [ "$STATE" != "device" ]; then
    say "port $SERIAL not usable ($STATE); scanning $HOST 30000-60000 for the debug port"
    PORT=$(node -e "
const net=require('net');const start=30000,end=60000,conc=400;let cur=start,open=[],done=0;
function w(){if(cur>end)return;const p=cur++;const s=net.connect({host:'$HOST',port:p,timeout:400});
s.on('connect',()=>{open.push(p);s.destroy();n()});s.on('timeout',()=>{s.destroy();n()});s.on('error',()=>n())}
function n(){done++;if(cur<=end)w();else if(done>=end-start+1)console.log(open.sort((a,b)=>a-b).join(','))}
for(let i=0;i<conc;i++)w();" | tr ',' '\n' | head -1)
    [ -z "$PORT" ] && fail "no open port found on $HOST"
    say "scan found $PORT; connecting"
    SERIAL="$HOST:$PORT"
    "$ADB" connect "$SERIAL" >/dev/null 2>&1
    for i in $(seq 1 15); do
      STATE=$("$ADB" devices | grep "$HOST" | awk '{print $2}')
      [ "$STATE" = "device" ] && break
      sleep 2
    done
  fi
  [ "$STATE" = "device" ] || fail "wireless device not authorized (state=$STATE)"
  say "wireless link up: $SERIAL"
else
  STATE=""
  for i in $(seq 1 12); do
    STATE=$("$ADB" devices | grep "^$SERIAL" | awk '{print $2}')
    [ "$STATE" = "device" ] && break
    sleep 2
  done
  [ "$STATE" = "device" ] || fail "usb device $SERIAL not in device state ($STATE)"
  say "usb link up: $SERIAL"
fi

DEV shell svc power stayon true >/dev/null 2>&1
DEV shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
DEV reverse tcp:3001 tcp:3001 || fail "reverse 3001 failed"
DEV reverse tcp:3000 tcp:3000 >/dev/null 2>&1
say "reverse: $(DEV reverse --list | tr '\n' ' ')"

HEALTH=$(curl -s -m 5 --noproxy '*' http://127.0.0.1:3001/__fault/status) || fail "fault proxy not answering on 3001"
say "proxy: $HEALTH"

# --- helpers -----------------------------------------------------------------
dump_ui() {
  DEV shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || return 1
  DEV pull /sdcard/ui.xml "$XML" >/dev/null 2>&1 || return 1
}
shot() {
  DEV shell screencap -p /sdcard/shot.png >/dev/null 2>&1
  DEV pull /sdcard/shot.png "$SHOT_DIR/$1.png" >/dev/null 2>&1
}
bounds_of() { # $1=xml $2=attr(exact text or content-desc substring) -> "x1 y1 x2 y2"
  local line b
  line=$(grep -o "text=\"[^\"]*$2[^\"]*\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"\|content-desc=\"[^\"]*$2[^\"]*\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"\|bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"[^>]*\(text=\"[^\"]*$2[^\"]*\"\|content-desc=\"[^\"]*$2[^\"]*\"\)" "$1" | head -1)
  [ -z "$line" ] && { echo ""; return 1; }
  b=$(echo "$line" | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"' | head -1 | sed 's/bounds="//;s/"$//;s/"//')
  echo "$b" | sed 's/\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]/\1 \2 \3 \4/'
}
center_of() { local b; b=$(bounds_of "$1" "$2"); [ -z "$b" ] && { echo ""; return 1; }
  echo "$b" | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'; }
tap_text() { local xy; xy=$(center_of "$XML" "$1"); [ -z "$xy" ] && return 1; DEV shell input tap $xy >/dev/null 2>&1; }
tap_exact() { # exact text match (avoid hitting subtitle TextViews that contain the same words)
  local line b
  line=$(grep -o "text=\"$1\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"\|content-desc=\"$1\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"\|bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"[^>]*\(text=\"$1\"\|content-desc=\"$1\"\)" "$XML" | head -1)
  [ -z "$line" ] && return 1
  b=$(echo "$line" | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"' | head -1 | sed 's/bounds="//;s/"$//;s/"//')
  local xy
  xy=$(echo "$b" | sed 's/\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]/\1 \2 \3 \4/' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}')
  DEV shell input tap $xy >/dev/null 2>&1
}
media_line() { DEV shell dumpsys media_session 2>/dev/null | tr -d '\r' | grep -a "state=PlaybackState" | head -1; }
wait_playing() {
  local deadline=$(( $(date +%s) + $1 )) n=0
  while [ "$(date +%s)" -lt "$deadline" ]; do
    local ml; ml=$(media_line)
    [ $(( n % 3 )) -eq 0 ] && say "  waiting PLAYING: ${ml:-no-session}"
    n=$((n+1))
    echo "$ml" | grep -q "state=3" && return 0
    sleep 2
  done
  return 1
}

# --- 1. app to join page ------------------------------------------------------
DEV shell am start -n com.listentogether.app/.MainActivity >/dev/null 2>&1
sleep 3
dump_ui || fail "initial dump failed"
shot "01-initial"
if grep -q "退出房间" "$XML"; then
  say "already in a room; leaving"
  tap_text "退出房间"; sleep 3; dump_ui
fi
grep -q "创建房间" "$XML" || fail "not on join page"

# --- 2. nickname + create room -------------------------------------------------
NICK_B=$(grep -o 'class="android.widget.EditText"[^>]*' "$XML" | sed -n 2p | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"' | sed 's/bounds="//;s/"$//;s/"//')
[ -z "$NICK_B" ] && fail "nickname field not found"
echo "$NICK_B" | sed 's/\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]/\1 \2 \3 \4/' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}' | while read NX NY; do
  DEV shell input tap $NX $NY >/dev/null 2>&1
done
sleep 1
DEV shell input keyevent 123 >/dev/null 2>&1
for i in $(seq 1 30); do DEV shell input keyevent 67 >/dev/null 2>&1; done
DEV shell input text "BannerTest" >/dev/null 2>&1
DEV shell input keyevent 111 >/dev/null 2>&1
sleep 1
dump_ui
if ! grep -q "BannerTest" "$XML"; then
  say "nickname retry"
  DEV shell input tap 540 863 >/dev/null 2>&1; sleep 1
  DEV shell input keyevent 123 >/dev/null 2>&1
  for i in $(seq 1 30); do DEV shell input keyevent 67 >/dev/null 2>&1; done
  DEV shell input text "BannerTest" >/dev/null 2>&1
  DEV shell input keyevent 111 >/dev/null 2>&1; sleep 1; dump_ui
fi
grep -q "BannerTest" "$XML" || fail "nickname not entered"
say "nickname entered"
# IME is still open (ESC does not close it on this device): BACK closes the IME
# without navigating away, restoring the original button layout.
DEV shell input keyevent 4 >/dev/null 2>&1
sleep 1
dump_ui
tap_exact "创建房间" || fail "create button tap failed"
sleep 6
dump_ui || fail "post-create dump failed"
shot "02-room"
ROOMCODE=$(grep -o 'text="房间 [0-9A-F]\{8\}"' "$XML" | head -1 | sed 's/text="房间 //;s/"//')
say "room code: ${ROOMCODE:-unknown}"

# --- 3. play demo-load -----------------------------------------------------------
# scroll the playlist so the last row (demo-load) is fully clear of the nav bar
DEV shell input swipe 540 1900 540 800 300 >/dev/null 2>&1
sleep 1
dump_ui
TRACK_XY=$(center_of "$XML" "负载测试音")
if [ -z "$TRACK_XY" ]; then
  DEV shell input swipe 540 1900 540 800 300 >/dev/null 2>&1; sleep 1; dump_ui
  TRACK_XY=$(center_of "$XML" "负载测试音")
fi
[ -z "$TRACK_XY" ] && fail "demo-load row not found"
TY=$(echo "$TRACK_XY" | cut -d' ' -f2)
if [ "$TY" -gt 2150 ]; then
  say "row too low (y=$TY); scrolling more"
  DEV shell input swipe 540 1900 540 1100 300 >/dev/null 2>&1; sleep 1; dump_ui
  TRACK_XY=$(center_of "$XML" "负载测试音")
fi
[ -z "$TRACK_XY" ] && fail "demo-load row not found after scroll"
say "tapping demo-load at $TRACK_XY"
DEV shell input tap $TRACK_XY >/dev/null 2>&1
# 2026-09-22 实测：点曲目行只"选曲"（服务端 version+1、保持暂停），播放必须再点
# content-desc="播放" 的 FAB。tap_exact 精确匹配，避免命中"正在播放"文案。
if ! wait_playing 25; then
  say "track tap did not start playback; tapping play FAB (select != play)"
  dump_ui
  tap_exact "播放" || fail "play FAB not found after track select"
  wait_playing 25 || fail "not PLAYING even after play FAB tap"
fi
say "PLAYING: $(media_line)"
shot "03-playing"

# --- 4. inject + seek into unbuffered area ---------------------------------------
curl -s -m 5 --noproxy '*' "http://127.0.0.1:3001/__fault/audio401?seconds=120" >/dev/null
say "audio401 injected 120s"
sleep 2
dump_ui || fail "pre-seek dump failed"
SB_B=$(grep -o 'class="android.widget.SeekBar"[^>]*bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"\|bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"[^>]*class="android.widget.SeekBar"' "$XML" | head -1 | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"' | sed 's/bounds="//;s/"$//;s/"//')
[ -z "$SB_B" ] && fail "seekbar not found"
SB=$(echo "$SB_B" | sed 's/\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]/\1 \2 \3 \4/')
SX1=$(echo "$SB" | cut -d' ' -f1); SY1=$(echo "$SB" | cut -d' ' -f2); SX2=$(echo "$SB" | cut -d' ' -f3); SY2=$(echo "$SB" | cut -d' ' -f4)
SY=$(( (SY1 + SY2) / 2 ))
say "seekbar [$SX1,$SY1][$SX2,$SY2]; swiping to ~99%"
DEV shell input swipe $((SX1 + 30)) $SY $((SX2 - 8)) $SY 800 >/dev/null 2>&1
sleep 8
ML=$(media_line); say "media after seek: $ML"
echo "$ML" | grep -q "state=7" || say "WARNING: expected ERROR(7)"
shot "04-after-401"

# --- 5. banner persistence samples (+8s then every 5s x5) -------------------------
sleep 3
# 2026-09-22 实测：连接状态横幅可能被"正在播放"卡片盖住（dump 里完全看不到文案）。
# 先向下滑一点把横幅露出来，再开始采样；采样期间不要再滚动。
DEV shell input swipe 540 350 540 800 400 >/dev/null 2>&1
sleep 1
dump_ui || fail "banner reveal dump failed"
HIT=0; SYNC=0
for i in 1 2 3 4 5; do
  dump_ui
  if grep -q "重新加入" "$XML"; then HIT=$((HIT+1)); say "sample $i: banner=401-text"; else say "sample $i: banner missing 401-text"; fi
  if grep -q "已同步" "$XML"; then SYNC=$((SYNC+1)); say "sample $i: banner=已同步 (would-be regression)"; fi
  shot "05-banner-$i"
  sleep 5
done
say "BANNER RESULT: 401-text $HIT/5, 已同步 $SYNC/5"
[ "$HIT" -ge 4 ] && [ "$SYNC" -eq 0 ] && say "BANNER VERDICT: PASS" || say "BANNER VERDICT: FAIL/INCONCLUSIVE"
PROXY_AFTER=$(curl -s -m 5 --noproxy '*' http://127.0.0.1:3001/__fault/status)
say "proxy after injection: $PROXY_AFTER"

# --- 6. clear injection + explicit play --------------------------------------------
curl -s -m 5 --noproxy '*' "http://127.0.0.1:3001/__fault/clear" >/dev/null
say "injection cleared"
sleep 2
dump_ui
# 恢复播放：横幅露出后布局下移，FAB 坐标与初次播放时不同，必须重新 dump 定位。
# 用 tap_exact 精确匹配 content-desc="播放"，避免误中"正在播放"文案。
if ! tap_exact "播放"; then
  say "play FAB not in dump; tapping card center (540,620)"
  DEV shell input tap 540 620 >/dev/null 2>&1
fi
wait_playing 30 || fail "playback did not resume"
sleep 6
say "resumed: $(media_line)"
dump_ui
if grep -q "已同步" "$XML"; then say "banner after resume: 已同步 (PASS)"; else say "banner after resume: other"; fi
shot "06-resumed"

# --- 7. diagnostics ----------------------------------------------------------------
DEV shell run-as com.listentogether.app ls files/diagnostics/ > "$OUT_DIR/diag-list.txt" 2>&1
DIAG_FILES=$(cat "$OUT_DIR/diag-list.txt" | tr -d '\r' | grep jsonl | tail -1)
say "diag file: $DIAG_FILES"
if [ -n "$DIAG_FILES" ]; then
  DEV shell "run-as com.listentogether.app cat files/diagnostics/$DIAG_FILES" > "$OUT_DIR/diagnostics.jsonl" 2>/dev/null
  say "diag lines: $(wc -l < "$OUT_DIR/diagnostics.jsonl")"
  say "localPause events: $(grep -ac localPause "$OUT_DIR/diagnostics.jsonl")"
  grep -a "localPause" "$OUT_DIR/diagnostics.jsonl" | tail -2 | tee -a "$LOG"
fi

# --- 8. cleanup ----------------------------------------------------------------
# 退出按钮在歌单末尾，采样前的滚动可能把它滚出屏幕；先滚到底再点。
DEV shell input swipe 540 1800 540 700 400 >/dev/null 2>&1
sleep 1
dump_ui
tap_text "退出房间" && say "left room" || say "leave tap failed (manual cleanup may be needed)"
DEV shell svc power stayon false >/dev/null 2>&1
say "DONE serial=$SERIAL"
