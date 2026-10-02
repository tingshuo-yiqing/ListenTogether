#!/usr/bin/env bash
# 本机 WSL 的独立 systemd 服务：坏 dist / 缺依赖 → 自动重启 → 回滚恢复。
# 唯一写入 /run/lt-desktop-drill.* 与本报告目录，不访问云端或在用服务。
set -euo pipefail
repo=/mnt/d/ListenTogether
evidence="$repo/docs/test-results/2026-10-02-desktop-tasks"
stage=$(mktemp -d /run/lt-desktop-drill.XXXXXX)
unit="lt-desktop-drill-$(basename "$stage").service"
node="$stage/runtime/bin/node"
cleanup() {
  systemctl stop "$unit" 2>/dev/null || true
  rm -f "/run/systemd/system/$unit"
  systemctl daemon-reload
  systemctl reset-failed "$unit" 2>/dev/null || true
  case "$stage" in /run/lt-desktop-drill.*) rm -rf -- "$stage" ;; *) echo 'Refused unsafe cleanup' >&2; exit 1 ;; esac
}
trap cleanup EXIT
chmod 755 "$stage"
mkdir "$stage/runtime" "$stage/good" "$stage/bad-dist" "$stage/missing-deps" "$stage/media"
tar -xJf "$repo/.workbuddy/linux-node/node-v24.21.0-linux-x64.tar.xz" -C "$stage/runtime" --strip-components=1
cp -a "$repo/server/dist" "$repo/server/package.json" "$stage/good/"
ln -s "$repo/server/node_modules" "$stage/good/node_modules"
cp -a "$stage/good/dist" "$stage/good/package.json" "$stage/bad-dist/"
ln -s "$repo/server/node_modules" "$stage/bad-dist/node_modules"
printf 'export {\n' > "$stage/bad-dist/dist/index.js"
cp -a "$stage/good/dist" "$stage/good/package.json" "$stage/missing-deps/"
cp "$repo/server/test/fixtures/tone.mp3" "$stage/media/tone.mp3"
printf '[{"id":"tone","title":"isolated tone","file":"tone.mp3"}]\n' > "$stage/media/catalog.json"
ln -s "$stage/good" "$stage/server"
port=$($node --input-type=module -e 'import net from "node:net"; const s=net.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
printf 'HOST=127.0.0.1\nPORT=%s\nMEDIA_DIR=%s/media\n' "$port" "$stage" > "$stage/service.env"
sed -e "s|User=listen|User=lt-desktop-drill\nDynamicUser=yes|" -e "s|Group=listen|Group=lt-desktop-drill|" \
    -e "s|/opt/listen-together/server|$stage/server|g" \
    -e "s|/etc/listen-together.env|$stage/service.env|" \
    -e "s|/usr/bin/node|$node|" -e 's/\r$//' \
    "$repo/deploy/listen-together.service" > "/run/systemd/system/$unit"
# 保留生产模板 Restart=on-failure、RestartSec=5 与各项沙箱限制，仅替换本机账号和隔离路径。
systemctl daemon-reload
snapshot() {
  printf '\nSCENARIO=%s\n' "$1"
  systemctl show "$unit" -p ActiveState -p SubState -p NRestarts -p ExecMainStatus
}
healthy() {
  for _ in $(seq 1 100); do
    if "$node" --input-type=module -e 'const r=await fetch(process.argv[1],{signal:AbortSignal.timeout(1500)});const h=await r.json();if(!r.ok||h.ok!==true)process.exit(1);console.log(JSON.stringify(h))' "http://127.0.0.1:$port/health" > "$stage/health.json" 2> "$stage/health-error.txt"; then
      return
    fi
    sleep 0.25
  done
  journalctl -u "$unit" --no-pager -n 30 >&2
  cat "$stage/health-error.txt" >&2
  ss -ltnp >&2
  return 1
}
failed() {
  for _ in $(seq 1 80); do
    restarts=$(systemctl show "$unit" -p NRestarts --value)
    status=$(systemctl show "$unit" -p ExecMainStatus --value)
    if [ "$restarts" -ge 1 ] && [ "$status" -ne 0 ]; then
      if "$node" --input-type=module -e 'const r=await fetch(process.argv[1],{signal:AbortSignal.timeout(1500)});if(!r.ok)process.exit(1)' "http://127.0.0.1:$port/health" >/dev/null 2>&1; then echo 'Broken candidate unexpectedly healthy' >&2; return 1; fi
      return
    fi
    sleep 0.25
  done
  return 1
}
{
  printf 'Node=%s\nSystemd=%s\nUnit=%s\n' "$($node --version)" "$(systemctl --version | head -1)" "$unit"
  systemctl start "$unit"; healthy; snapshot baseline
  for candidate in bad-dist missing-deps; do
    systemctl stop "$unit"
    ln -sfn "$stage/$candidate" "$stage/server"
    systemctl reset-failed "$unit" 2>/dev/null || true
    systemctl start "$unit"; failed; snapshot "$candidate"
    journalctl -u "$unit" --no-pager -n 15
    systemctl stop "$unit"
    ln -sfn "$stage/good" "$stage/server"
    systemctl reset-failed "$unit" 2>/dev/null || true
    systemctl start "$unit"; healthy; snapshot "$candidate-rollback"
    cat "$stage/health.json"; printf '\n'
  done
  printf '\nPASS=baseline,bad-dist-auto-restart,bad-dist-rollback,missing-deps-auto-restart,missing-deps-rollback\n'
} | tee "$evidence/systemd-failure.log"
