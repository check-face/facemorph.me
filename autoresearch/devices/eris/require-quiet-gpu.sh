#!/usr/bin/env bash
# Refuse to measure on a GPU another process is using. eris is also the operator's desktop: a voice-render job
# held 5.6 GB of the 8 GB card on 7 October 2026 and every WebGPU run failed with "Invalid Buffer ... previous
# error" (an allocation failure), which looked like a product defect and was filed as one before the memory was
# checked. Exits 75, the same code run.py uses for a busy device, so nothing is recorded as a result.
# Threshold: GPU_BUSY_MIB (default 2500 MiB used). Idle desktop on eris is ~1.3 GB.
used=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1 | tr -d ' ')
limit="${GPU_BUSY_MIB:-2500}"
if [ "${used:-0}" -gt "$limit" ]; then
  echo "GPU busy: ${used} MiB in use (> ${limit}); no measurement started. Holders:" >&2
  nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader >&2 || true
  exit 75
fi
