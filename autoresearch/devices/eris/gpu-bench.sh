#!/usr/bin/env bash
# One GPU-route benchmark on eris: fresh headless Chromium (own profile, own port), the product's
# own ${BENCH_SCRIPT:-scripts/next-gpu-benchmark.py} through a harness daemon private to this run, then teardown.
# Run under the lease:  python3 autoresearch/run.py --lane browser-gpu --device eris --timeout 1800 -- \
#                         autoresearch/devices/eris/gpu-bench.sh <label> [url] [faces]
set -euo pipefail
label="$1"; url="${2:-https://next.facemorph.me/}"; faces="${3:-6}"
root="$(cd "$(dirname "$0")/../../.." && pwd)"
run="$HOME/Work/runs/$label"; port=$((9500 + RANDOM % 400))
mkdir -p "$run"
"$root/autoresearch/devices/eris/launch-chromium.sh" "$run" "$port" > "$run/chrome.log" 2>&1 &
chrome=$!
trap 'kill $chrome 2>/dev/null || true; pkill -f "venv-bh/bin/python3 -m browser_harness.daemon" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$port/json/version" >/dev/null 2>&1 && break; sleep 1; done
{ uptime; nvidia-smi --query-gpu=name,utilization.gpu,memory.used,temperature.gpu,clocks.sm --format=csv; } > "$run/env-before.txt"
cd "$root"
BU_NAME="$label" BU_CDP_URL="http://127.0.0.1:$port" GPU_BENCH_URL="$url" GPU_BENCH_FACES="$faces" \
  GPU_BENCH_EVIDENCE="$run/evidence" "$HOME/Work/runs/venv-bh/bin/browser-harness" < ${BENCH_SCRIPT:-scripts/next-gpu-benchmark.py} \
  | tee "$run/result.txt"
{ uptime; nvidia-smi --query-gpu=utilization.gpu,memory.used,temperature.gpu,clocks.sm --format=csv; } > "$run/env-after.txt"
