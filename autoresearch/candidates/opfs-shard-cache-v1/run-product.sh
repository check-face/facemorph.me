#!/usr/bin/env bash
# run-product.sh <label> <tree-root> <port> <plan-json>   (fixed port per tree keeps its model cache warm)
set -euo pipefail
label="$1"; tree="$2"; sport="$3"; plan="$4"
here="$(cd "$(dirname "$0")" && pwd)"; eris="$here/../../devices/eris"
run="$HOME/Work/runs/ar5/$label"; mkdir -p "$run"; port=$((9500 + RANDOM % 400))
python3 "$here/serve.py" "$sport" "$tree" & srv=$!
"$eris/launch-chromium.sh" "${PROFILE:-$HOME/Work/runs/ar5/chrome-product}" "$port" > "$run/chrome.log" 2>&1 & chrome=$!
# Stop only this run's harness daemon: several sessions share eris.
own_daemon(){ for p in $(pgrep -f "browser_harness[.]daemon"); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx "BU_NAME=$1" && kill $p; done; }
trap 'kill $chrome $srv 2>/dev/null || true; own_daemon "ar5-$label" || true' EXIT
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$port/json/version" >/dev/null 2>&1 && break; sleep 1; done
{ uptime; nvidia-smi --query-gpu=utilization.gpu,memory.used,temperature.gpu,clocks.sm --format=csv; } > "$run/env-before.txt"
BU_NAME="ar5-$label" BU_CDP_URL="http://127.0.0.1:$port" BENCH_URL="http://127.0.0.1:$sport/bench/product.html" BENCH_PLAN="$plan" \
  "$HOME/Work/runs/venv-bh/bin/browser-harness" < "$here/drive-product.py" | tee "$run/result.jsonl"
{ uptime; nvidia-smi --query-gpu=utilization.gpu,memory.used,temperature.gpu,clocks.sm --format=csv; } > "$run/env-after.txt"
