#!/usr/bin/env bash
# Retry wrapper for m3-auth-recheck.sh on a flapping USB link:
# waits for the device to enumerate, runs the driver; on transport failure
# keeps retrying until the deadline. Exits 0 when the driver completes
# (check its log for PASS/FAIL), 1 on deadline.
set -u
export PATH=/usr/bin:/bin:$PATH
ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
DEADLINE=$(( $(date +%s) + ${MAX_MINUTES:-45} * 60 ))
ATTEMPT=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  S=$("$ADB" devices 2>/dev/null | grep "^fbddbe8" | awk '{print $2}')
  if [ "$S" = "offline" ]; then
    "$ADB" kill-server 2>/dev/null; sleep 1; "$ADB" start-server 2>/dev/null
  elif [ "$S" = "device" ]; then
    ATTEMPT=$((ATTEMPT+1))
    echo "[retry-wrapper] attempt $ATTEMPT starting $(date +%H:%M:%S)"
    if bash /d/ListenTogether/scripts/m3-auth-recheck.sh; then
      echo "[retry-wrapper] driver completed on attempt $ATTEMPT"
      exit 0
    fi
    echo "[retry-wrapper] attempt $ATTEMPT failed; cooling down 20s"
    sleep 20
  fi
  sleep 5
done
echo "[retry-wrapper] deadline reached after $ATTEMPT attempts"
exit 1
