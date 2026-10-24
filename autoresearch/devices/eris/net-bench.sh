#!/usr/bin/env bash
# Link ceiling for the model download, with no browser and no hashing: fetch the 10 model-prefix chunks
# (the bulk of a cold WebGPU visitor's ~190 MiB) one at a time and with N in flight, interleaved so edge
# warmth and drift hit both arms. Usage: net-bench.sh <urls-file> [parallelism] [rounds]
set -euo pipefail
urls="$1"; par="${2:-4}"; rounds="${3:-3}"
ms() { local s e; s=$(date +%s%N); "$@" > /dev/null; e=$(date +%s%N); echo $(( (e - s) / 1000000 )); }
seq_run() { while read -r u; do curl -fsS -o /dev/null "$u"; done < "$urls"; }
par_run() { xargs -P "$par" -n 1 curl -fsS -o /dev/null < "$urls"; }
for r in $(seq 1 "$rounds"); do
  if (( r % 2 )); then a=seq_run; b=par_run; else a=par_run; b=seq_run; fi
  ta=$(ms "$a"); tb=$(ms "$b")
  printf '%s round %s %s=%sms %s=%sms\n' "$(date +%T)" "$r" "$a" "$ta" "$b" "$tb"
done
