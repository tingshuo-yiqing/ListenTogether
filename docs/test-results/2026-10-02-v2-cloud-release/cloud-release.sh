#!/usr/bin/env bash
# 仅发布明确版本的代码与 APK；不覆盖真实曲库。独立端口先验，再切链接，失败恢复旧链接。
set -euo pipefail
base=/opt/listen-together
id=20261002-013255
meta_id=20261002-metadata-v2
release="$base/releases/$id"
metadata="$base/metadata-releases/$meta_id"
upload=/tmp/listentogether-publish-20261002
ops="$release/ops"
media="$base/media"
case "${1:-}" in
prepare)
 test ! -e "$release"
 test ! -e "$metadata"
 cd "$upload"
 head -n 1 SHA256SUMS-20261002-013255.txt | sha256sum -c -
 sha256sum -c listen-together-metadata-20261002.tar.sha256
 mkdir -p "$release" "$metadata"
 tar -xzf listen-together-server-0.1.0-20261002-013255.tar.gz -C "$release"
 cd "$release"
 tail -n +2 "$upload/SHA256SUMS-20261002-013255.txt" | sha256sum -c -
 test ! -e "$release/media"
 test ! -e "$release/demo-media"
 tar -xzf "$upload/listen-together-metadata-20261002.tar.gz" -C "$metadata"
 test ! -e "$metadata/media"
 mkdir "$ops"
 chmod 700 "$ops"
 cp "$upload/cloud-v2-verify.mjs" "$ops/"
 readlink -f "$base/server" > "$ops/previous-server.txt"
 readlink -f "$base/metadata-manager" > "$ops/previous-metadata.txt"
 cp -p "$base/current-version.txt" "$ops/previous-version.txt"
 cp -p /etc/listen-together.env "$ops/previous-env.txt"
 cp -p "$media/catalog.json" "$ops/catalog-before.json"
 (cd "$media"; find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$ops/media-before.sha256"
 (cd "$media"; find . -type f -printf '%P %U %G %m\n' | sort) > "$ops/media-before-permissions.txt"
 if ! command -v ffmpeg >/dev/null; then
   DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get update
   DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y --no-install-recommends ffmpeg
 fi
 ffmpeg -version | head -n 1
 chown -R listen:listen "$release/server"
 cd "$release/server"
 runuser -u listen -- npm ci --cache /tmp/npm-cache-listen
 runuser -u listen -- npm run build
 runuser -u listen -- npm test > "$ops/server-tests.log" 2>&1
 runuser -u listen -- npm prune --omit=dev
 chown -R listen-metadata:listen "$metadata"
 cd "$metadata"
 runuser -u listen-metadata -- npm ci --omit=dev --cache /tmp/npm-cache-metadata
 cd "$metadata/server"
 runuser -u listen-metadata -- npm ci --cache /tmp/npm-cache-metadata
 runuser -u listen-metadata -- npm run build
 cd "$metadata"
 runuser -u listen-metadata -- node --test 'scripts/**/*.test.mjs' > "$ops/metadata-tests.log" 2>&1
 cd "$metadata/server"
 runuser -u listen-metadata -- npm prune --omit=dev
 # 使用 listen 身份和同一只读真实曲库，在独立端口验证候选；没有操作在产房间。
 runuser -u listen -- env HOST=127.0.0.1 PORT=33002 MEDIA_DIR="$media" /usr/bin/node "$release/server/dist/index.js" > "$ops/shadow-backend.log" 2>&1 &
 shadow=$!
 trap 'kill "$shadow" 2>/dev/null || true; wait "$shadow" 2>/dev/null || true' EXIT
 for attempt in {1..30}; do if curl --noproxy '*' --max-time 1 -fsS http://127.0.0.1:33002/health >/dev/null 2>&1; then break; fi; sleep 1; done
 LT_SERVER_PACKAGE="$release/server/package.json" node "$ops/cloud-v2-verify.mjs" http://127.0.0.1:33002 "$ops/shadow-verify.json"
 kill "$shadow"; wait "$shadow" || true
 trap - EXIT
 chown -R root:listen "$release/server" "$metadata"
 chmod -R g+rX "$release/server" "$metadata"
 printf 'PREPARED=%s,%s\n' "$id" "$meta_id"
 ;;
publish)
 test -s "$ops/shadow-verify.json"
 # 再次确认真实曲库字节/权限与准备阶段一致，且没有正在使用的房间。
 (cd "$media"; sha256sum -c "$ops/media-before.sha256") > "$ops/media-prepublish-check.log"
 curl --noproxy '*' --max-time 5 -fsS http://127.0.0.1:3000/health > "$ops/health-before.json"
 node -e 'const h=JSON.parse(require("fs").readFileSync(process.argv[1]));if(!h.ok||h.rooms||h.onlineMembers||h.wsConnections)throw Error("仍有活跃房间，暂不切换")' "$ops/health-before.json"
 previous_server=$(cat "$ops/previous-server.txt")
 previous_metadata=$(cat "$ops/previous-metadata.txt")
 published=0
 rollback() {
   if [[ "$published" != 1 ]]; then
     ln -sfn "$previous_server" "$base/server"
     ln -sfn "$previous_metadata" "$base/metadata-manager"
     cp -p "$ops/previous-version.txt" "$base/current-version.txt"
     systemctl restart listen-together listen-together-metadata
     printf 'ROLLED-BACK\n' >&2
   fi
 }
 trap rollback EXIT
 ln -sfn "$release/server" "$base/server"
 ln -sfn "$metadata" "$base/metadata-manager"
 printf 'id=%s\nprev=%s\n' "$id" "$(basename "$(dirname "$previous_server")")" > "$base/current-version.txt"
 systemctl restart listen-together listen-together-metadata
 for attempt in {1..30}; do if curl --noproxy '*' --max-time 1 -fsS http://127.0.0.1:3000/api/capabilities >/dev/null 2>&1; then break; fi; sleep 1; done
 LT_SERVER_PACKAGE="$release/server/package.json" node "$ops/cloud-v2-verify.mjs" http://127.0.0.1:3000 "$ops/production-verify.json"
 curl --noproxy '*' --max-time 5 -fsS http://127.0.0.1:3100/api/sources > "$ops/metadata-sources.json"
 node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1]));if(s.default!=="higequ")throw Error("管理器未更新")' "$ops/metadata-sources.json"
 curl --noproxy '*' --max-time 5 -fsS http://127.0.0.1:3100/ > "$ops/metadata-page.html"
 grep -q 'data-view="browse"' "$ops/metadata-page.html"
 (cd "$media"; sha256sum -c "$ops/media-before.sha256") > "$ops/media-after-check.log"
 (cd "$media"; find . -type f -printf '%P %U %G %m\n' | sort) > "$ops/media-after-permissions.txt"
 cmp "$ops/media-before-permissions.txt" "$ops/media-after-permissions.txt"
 systemctl show listen-together listen-together-metadata -p Id -p ActiveState -p SubState -p NRestarts > "$ops/services-after.txt"
 systemctl is-active --quiet listen-together listen-together-metadata
 published=1
 trap - EXIT
 printf 'PUBLISHED=%s,%s\n' "$id" "$meta_id"
 ;;
*) echo 'usage: cloud-release.sh prepare|publish' >&2; exit 2 ;;
esac
