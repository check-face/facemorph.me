#!/usr/bin/env bash
# Refuse to measure on a GPU another process is using. eris is also the operator's desktop: a voice-render job
# held 5.6 GB of the 8 GB card on 7 October 2026 and every WebGPU run failed with "Invalid Buffer ... previous
# error" (an allocation failure), which looked like a product defect and was filed as one before the memory was
# checked. Exits 75, the same code run.py uses for a busy device, so nothing is recorded as a result.
# Threshold: GPU_BUSY_MIB (default 4000 MiB used, i.e. at least 4 GB free). An idle desktop on eris uses 1.3-3 GB; failures were seen at 7 GB used.
used=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1 | tr -d ' ')
limit="${GPU_BUSY_MIB:-4000}"
if [ "${used:-0}" -gt "$limit" ]; then
  echo "GPU busy: ${used} MiB in use (> ${limit}); no measurement started. Holders:" >&2
  nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader >&2 || true
  exit 75
fi
