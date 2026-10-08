#!/usr/bin/env bash
# run.sh <label> <args-json>: headless Chromium (real GPU, timestamp queries unquantised), this dir served locally.
set -euo pipefail
label="$1"; args="$2"; here="$(cd "$(dirname "$0")" && pwd)"; eris="$here/../../devices/eris"
run="$HOME/Work/runs/ar4/$label"; mkdir -p "$run"; port=$((9500 + RANDOM % 400)); sport=$((8600 + RANDOM % 300))
python3 "$here/../morph-frame-pipeline-v1/serve.py" "$sport" & srv=$!
"$eris/launch-chromium.sh" "$run/profile" "$port" --enable-dawn-features=allow_unsafe_apis > "$run/chrome.log" 2>&1 & chrome=$!
# Stop only this run's harness daemon: several sessions share eris.
own_daemon(){ for p in $(pgrep -f "browser_harness[.]daemon"); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx "BU_NAME=$1" && kill $p; done; }
trap 'kill $chrome $srv 2>/dev/null || true; own_daemon "ar4-$label" || true' EXIT
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$port/json/version" >/dev/null 2>&1 && break; sleep 1; done
BU_NAME="ar4-$label" BU_CDP_URL="http://127.0.0.1:$port" BENCH_URL="http://127.0.0.1:$sport/autoresearch/candidates/wgsl-conv-v1/${PAGE:-index.html}" BENCH_ARGS="$args" \
  "$HOME/Work/runs/venv-bh/bin/browser-harness" < "$here/drive.py" | tee "$run/result.json"
