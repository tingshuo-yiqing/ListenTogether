#!/usr/bin/env bash
# 校验本轮 ServerOnly 候选的完整性与真实生成/编译，不读取在产服务或真实曲库。
set -euo pipefail
repo=/mnt/d/ListenTogether
evidence="$repo/docs/test-results/2026-10-02-desktop-tasks"
archive="$repo/deploy-artifacts/listen-together-server-0.1.0-20261002-013255.tar.gz"
sums="$repo/deploy-artifacts/SHA256SUMS-20261002-013255.txt"
stage=$(mktemp -d /run/lt-desktop-package.XXXXXX)
cleanup() {
  case "$stage" in /run/lt-desktop-package.*) rm -rf -- "$stage" ;; *) echo 'Refused unsafe cleanup' >&2; exit 1 ;; esac
}
trap cleanup EXIT
node="$repo/.workbuddy/linux-node/runtime/bin/node"
cd "$repo/deploy-artifacts"
head -n 1 "$sums" | sha256sum -c -
tar -xzf "$archive" -C "$stage"
cd "$stage"
tail -n +2 "$sums" | sha256sum -c -
test ! -e media
test ! -e demo-media
test ! -e android
ln -s "$repo/server/node_modules" "$stage/server/node_modules"
cd "$stage/server"
"$node" scripts/protocol-schema.mjs
"$node" node_modules/typescript/bin/tsc
printf 'PASS=tar-checksum,all-file-checksums,no-media,no-android,schema-generation,typescript-build\n'
printf 'DEPENDENCIES=reused-workspace-node_modules; not npm-ci-from-network\n'
