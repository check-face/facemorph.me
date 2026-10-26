#!/usr/bin/env bash
# Paired product measurement of CI-built artifacts: serve one `next-site-<sha>` artifact exactly as the e2e
# workflow does (scripts/next-e2e-server.py, pinned runtime overlay, next.facemorph.me mapped to localhost) and
# drive it through the real UI in a fresh headless Chromium on the NVIDIA GPU.
#
# Usage (under the lease):
#   python3 autoresearch/run.py --lane browser-gpu --device eris --timeout 1800 -- \
#     autoresearch/devices/eris/artifact-bench.sh <label> <run-id> <artifact-name> [faces]
#   BENCH_SCRIPT=autoresearch/devices/eris/gpu-bench-inpage.py selects the in-page timestamps (default).
#
# Runtime assets come from the shared write-through mirror, so after the first run the model bytes are
# local: this isolates CPU, hashing and storage cost, and says nothing about network overlap (that is
# measured separately by acquire-bench.mjs against the live origin).
set -euo pipefail
label="$1"; run_id="$2"; artifact="$3"; faces="${4:-8}"
repo="$HOME/Work/dev/facemorph.me"
runtime_sha="d9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c"
root="$HOME/Work/runs/artifacts/$run_id"
run="$HOME/Work/runs/$label"; port=$((9500 + RANDOM % 400))
mkdir -p "$root" "$run" "$HOME/Work/runs/runtime-mirror"
if [ ! -d "$root/deploy-next" ]; then
  gh run download "$run_id" -R check-face/facemorph.me -n "$artifact" -D "$root"
fi
ln -sfn "$repo/scripts" "$root/scripts"; ln -sfn "$repo/hosting" "$root/hosting"
ln -sfn "$HOME/Work/runs/runtime-mirror" "$root/.runtime-mirror"
[ -f "$root/next.crt" ] || openssl req -x509 -newkey rsa:2048 -nodes -keyout "$root/next.key" -out "$root/next.crt" -days 2 -subj '/CN=next.facemorph.me' > /dev/null 2>&1
# OVERLAY=1 serves the repo's pinned overlay as the e2e workflow does; the default serves production's runtime
# (the public manifest hashes to the same pin), which is what a visitor to next.facemorph.me receives.
overlay=(); [ "${OVERLAY:-0}" = 1 ] && overlay=(--runtime-overlay hosting/next-static/runtime-overlay)
(cd "$root" && exec python3 scripts/next-e2e-server.py --manifest-sha "$runtime_sha" \
  "${overlay[@]}" --cert next.crt --key next.key) > "$run/server.log" 2>&1 &
server=$!
"$repo/autoresearch/devices/eris/launch-chromium.sh" "$run" "$port" --ignore-certificate-errors --no-proxy-server \
  --host-resolver-rules='MAP next.facemorph.me:443 127.0.0.1:8443' > "$run/chrome.log" 2>&1 &
chrome=$!
trap 'kill $chrome $server 2>/dev/null || true; pkill -f "venv-bh/bin/python3 -m browser_harness.daemon" 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do
  curl -kfsS --max-time 2 https://127.0.0.1:8443/runtime/manifest.json > /dev/null 2>&1 && curl -fsS --max-time 2 "http://127.0.0.1:$port/json/version" > /dev/null 2>&1 && break
  sleep 1
done
curl -kfsS https://127.0.0.1:8443/runtime/manifest.json > /dev/null
{ echo "artifact $artifact"; cat "$root/next-site-source.txt"; uptime; nvidia-smi --query-gpu=name,utilization.gpu,memory.used,temperature.gpu,clocks.sm --format=csv; } > "$run/env-before.txt"
cd "$repo"
BU_NAME="$label" BU_CDP_URL="http://127.0.0.1:$port" GPU_BENCH_URL="https://next.facemorph.me/" GPU_BENCH_FACES="$faces" \
  GPU_BENCH_EVIDENCE="$run/evidence" "$HOME/Work/runs/venv-bh/bin/browser-harness" \
  < "${BENCH_SCRIPT:-autoresearch/devices/eris/gpu-bench-inpage.py}" | tee "$run/result.txt"
{ uptime; nvidia-smi --query-gpu=utilization.gpu,memory.used,temperature.gpu,clocks.sm --format=csv; } > "$run/env-after.txt"
