#!/usr/bin/env bash
# M4 部署服务端功能验证：health / 鉴权 / 音频 Range / WS 握手。
# 在云服务器上以 root 运行；仅创建一个临时成员并在收尾退出，不改任何配置。
# 用法: bash scripts/m4-deploy-verify.sh
set -uo pipefail
BASE=http://127.0.0.1:3000
MEDIA=/opt/listen-together/media
pass=0; fail=0
ok() { echo "PASS: $1"; pass=$((pass+1)); }
bad() { echo "FAIL: $1"; fail=$((fail+1)); }

echo "== 1. health =="
h=$(curl -s "$BASE/health")
[ "$h" = '{"ok":true}' ] && ok "health=$h" || bad "health=$h"

echo "== 2. create room =="
R=$(curl -s -X POST "$BASE/api/rooms" -H 'Content-Type: application/json' -d '{"nickname":"deploy-check"}')
CODE=$(node -e 'try{console.log(JSON.parse(process.argv[1]).code||"")}catch(e){console.log("")}' "$R")
TOKEN=$(node -e 'try{console.log(JSON.parse(process.argv[1]).token||"")}catch(e){console.log("")}' "$R")
if [ -n "$CODE" ] && [ -n "$TOKEN" ]; then ok "room=$CODE created, token length=${#TOKEN}"; else bad "create room: $R"; echo "RESULT pass=$pass fail=$fail"; exit 1; fi
AUTH="Authorization: Bearer $TOKEN"

echo "== 3. catalog =="
cstatus=$(curl -s -o /tmp/m4-catalog.json -w "%{http_code}" -H "$AUTH" "$BASE/api/rooms/$CODE/catalog")
cnum=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync("/tmp/m4-catalog.json","utf8")).length)}catch(e){console.log(-1)}')
[ "$cstatus" = 200 ] && [ "$cnum" = 5 ] && ok "catalog 200, 5 tracks" || bad "catalog status=$cnum tracks=$cnum"
un=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/rooms/$CODE/catalog")
[ "$un" = 401 ] && ok "catalog without token -> 401" || bad "catalog no-token status=$un"

echo "== 4. audio =="
A="$BASE/api/rooms/$CODE/audio/demo-soft"
SIZE=$(stat -c %s "$MEDIA/demo-soft.mp3")
r=$(curl -s -o /dev/null -w "%{http_code} %{size_download}" -H "$AUTH" "$A")
[ "$r" = "200 $SIZE" ] && ok "full GET -> 200, size=$SIZE" || bad "full GET: [$r] expect [200 $SIZE]"
curl -s -o /dev/null -D /tmp/m4-h1 -w "%{http_code} %{size_download}\n" -H "$AUTH" -H "Range: bytes=0-1023" "$A" > /tmp/m4-r1
CR=$(grep -i '^content-range' /tmp/m4-h1 | tr -d '\r' | cut -d' ' -f2-)
if [ "$(cat /tmp/m4-r1)" = "206 1024" ] && [ "$CR" = "bytes 0-1023/$SIZE" ]; then
  ok "Range bytes=0-1023 -> 206 1024, Content-Range: $CR"
else bad "range head: body=[$(cat /tmp/m4-r1)] content-range=[$CR]"; fi
s=$(curl -s -o /dev/null -w "%{http_code} %{size_download}" -H "$AUTH" -H "Range: bytes=-500" "$A")
[ "$s" = "206 500" ] && ok "suffix Range bytes=-500 -> 206 500" || bad "suffix range: $s"
o=$(curl -s -o /dev/null -w "%{http_code} %{size_download}" -H "$AUTH" -H "Range: bytes=1024-" "$A")
oc=${o%% *}; on=${o##* }
[ "$oc" = 206 ] && [ "$on" = $((SIZE-1024)) ] && ok "open Range bytes=1024- -> 206, $on bytes" || bad "open range: $o expect 206 $((SIZE-1024))"
i=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" -H "Range: bytes=999999999-" "$A")
[ "$i" = 416 ] && ok "out-of-range -> 416" || bad "out-of-range: $i"
an=$(curl -s -o /dev/null -w "%{http_code}" "$A")
[ "$an" = 401 ] && ok "audio without token -> 401" || bad "audio no-token: $an"

echo "== 5. websocket =="
WSOUT=$(node -e '
const { createRequire } = require("module");
const req = createRequire("/opt/listen-together/server/package.json");
const WebSocket = req("ws");
const [code, token] = process.argv.slice(1);
const ws = new WebSocket("ws://127.0.0.1:3000/ws/" + code, { headers: { Authorization: "Bearer " + token } });
const timer = setTimeout(() => { console.log("WS-TIMEOUT"); process.exit(1); }, 8000);
const seen = [];
ws.on("open", () => { console.log("WS-OPEN"); ws.send(JSON.stringify({ type: "sync", clientTimeMs: Date.now() })); });
ws.on("message", d => { const t = String(d); const type = JSON.parse(t).type; seen.push(type); console.log("WS-MSG type=" + type + " " + t.slice(0, 90)); if (seen.includes("clock") && seen.includes("state")) { clearTimeout(timer); ws.close(); process.exit(0); } });
ws.on("error", e => { console.log("WS-ERROR " + e.message); process.exit(1); });
' "$CODE" "$TOKEN" 2>&1) || true
if echo "$WSOUT" | grep -q WS-OPEN && echo "$WSOUT" | grep -q "type=clock" && echo "$WSOUT" | grep -q "type=state"; then
  ok "WS open + sync reply (clock+state): $(echo "$WSOUT" | tr '\n' '|' | cut -c1-200)"
else bad "WS authenticated: $WSOUT"; fi
WSN=$(node -e '
const { createRequire } = require("module");
const req = createRequire("/opt/listen-together/server/package.json");
const WebSocket = req("ws");
const ws = new WebSocket("ws://127.0.0.1:3000/ws/" + process.argv[2]);
ws.on("open", () => { console.log("WS-UNEXPECTED-OPEN"); process.exit(1); });
ws.on("error", e => { console.log("WS-REJECTED " + e.message); process.exit(0); });
setTimeout(() => { console.log("WS-TIMEOUT"); process.exit(1); }, 8000);
' x "$CODE" 2>&1) || true
echo "$WSN" | grep -q WS-REJECTED && ok "WS without token rejected: $WSN" || bad "WS no-token: $WSN"

echo "== 6. cleanup =="
l=$(curl -s -X DELETE -H "$AUTH" "$BASE/api/rooms/$CODE/membership")
[ "$l" = '{"ok":true}' ] && ok "temporary member left" || bad "leave: $l"
rm -f /tmp/m4-catalog.json /tmp/m4-h1 /tmp/m4-r1

echo "== 7. journal (recent 6 lines) =="
journalctl -u listen-together -n 6 --no-pager 2>/dev/null | sed "s/^/  /"
echo "RESULT pass=$pass fail=$fail"
[ "$fail" -eq 0 ] && exit 0 || exit 1
