#!/usr/bin/env bash
# Headless Chromium on eris with WebGPU on the NVIDIA card (Vulkan via ANGLE), CDP on 127.0.0.1:$PORT.
# Usage: launch-chromium.sh <run-dir> [port] [extra chromium flags...]
# Isolated profile under <run-dir>; never touches the desktop browser.
set -euo pipefail
run="$1"; port="${2:-9444}"; shift $(( $# > 1 ? 2 : 1 ))
mkdir -p "$run"
exec chromium --headless=new --no-sandbox --enable-unsafe-webgpu --enable-features=Vulkan \
  --use-angle=vulkan --use-gl=angle --disable-vulkan-surface \
  --remote-debugging-port="$port" --user-data-dir="$run/profile" "$@" about:blank
