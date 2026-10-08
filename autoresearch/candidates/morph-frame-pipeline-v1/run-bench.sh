#!/usr/bin/env bash
# run-bench.sh <label> <engine-url-relative-to-worker> <plan-json>
set -euo pipefail
label="$1"; engine="$2"; plan="$3"
here="$(cd "$(dirname "$0")" && pwd)"; eris="$here/../../devices/eris"
run="$HOME/Work/runs/ar3/$label"; mkdir -p "$run"
port=$((9500 + RANDOM % 400)); sport=$((8600 + RANDOM % 300))
python3 "$here/serve.py" "$sport" & srv=$!
# persistent profile so pinned assets stay in Cache Storage between runs
"$eris/launch-chromium.sh" "$HOME/Work/runs/ar3/chrome" "$port" > "$run/chrome.log" 2>&1 & chrome=$!
trap 'kill $chrome $srv 2>/dev/null || true; pkill -f "venv-bh/bin/python3 -m browser_harness.daemon" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$port/json/version" >/dev/null 2>&1 && break; sleep 1; done
{ uptime; nvidia-smi --query-gpu=utilization.gpu,memory.used,temperature.gpu,clocks.sm --format=csv; } > "$run/env-before.txt"
BU_NAME="ar3-$label" BU_CDP_URL="http://127.0.0.1:$port" BENCH_URL="http://127.0.0.1:$sport/autoresearch/candidates/morph-frame-pipeline-v1/bench.html" \
 BENCH_ENGINE="$engine" BENCH_PLAN="$plan" "$HOME/Work/runs/venv-bh/bin/browser-harness" < "$here/drive.py" | tee "$run/result.jsonl"
{ uptime; nvidia-smi --query-gpu=utilization.gpu,memory.used,temperature.gpu,clocks.sm --format=csv; } > "$run/env-after.txt"
