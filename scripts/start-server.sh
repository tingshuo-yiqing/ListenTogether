#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../server"
npm ci
npm run build
exec npm start
