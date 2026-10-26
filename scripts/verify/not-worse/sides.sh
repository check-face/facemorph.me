#!/usr/bin/env bash
# The two sides of a hosted paired not-worse run (fm-0q4h): the pinned control (fetched and verified by
# scripts/import/fetch-control.mjs) and, for PLANT=slow|crash, a planted copy of it (plant.mjs) as the build side.
# Writes the extra mobile.py arguments to .cache/not-worse-build-args (empty for control/control).
set -euo pipefail
node scripts/import/fetch-control.mjs --dest .cache/control | tail -1
: > .cache/not-worse-build-args
case "${PLANT:-none}" in
  none) ;;
  slow|crash)
    planted=$(node scripts/verify/not-worse/plant.mjs --kind "$PLANT" --delay-ms "${DELAY_MS:-5000}" \
      --from .cache/control/tree/deploy-next --out ".cache/planted-$PLANT")
    echo "$planted"
    echo "--build .cache/planted-$PLANT" > .cache/not-worse-build-args ;;
  *) echo "PLANT is none, slow or crash, not $PLANT" >&2; exit 2 ;;
esac
