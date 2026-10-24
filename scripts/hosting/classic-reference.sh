#!/usr/bin/env bash
# Classic's staging on the same artifact, for comparison (fm-8tyu): classic's own mirror-runtime.py and stage.py, read
# from classic's Git objects at the frozen revision (never its working tree), run against this clone's deploy-next/
# (the control). The runtime output is seeded with hard links to the verified acquisition cache, so mirror-runtime
# re-verifies every pinned file and fetches only what the cache lacks (it logs those fetches). Writes the staged tree's
# record for scripts/hosting/stage.mjs --compare.
#   scripts/hosting/classic-reference.sh <classic checkout> <acquired runtime dir> <record.json>
set -euo pipefail
classic=$1 runtime=$(cd "$2" && pwd) record=$3
repo=$(cd "$(dirname "$0")/../.." && pwd)
commit=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).source.frozen_commit)' "$repo/import/allowlist.json")
mkdir -p "$repo/.cache"; work=$(mktemp -d "$repo/.cache/classic-staging.XXXXXX") # same filesystem as the cache, for hard links
trap 'rm -rf "$work"' EXIT
git -C "$classic" --no-optional-locks archive "$commit" hosting/ photo-runtime/ | tar -x -C "$work" # mirror-runtime.py also reads photo-runtime/ (worker siblings)
mkdir -p "$work/runtime-public"
cp -al "$runtime/." "$work/runtime-public/"
python3 "$work/hosting/next-static/mirror-runtime.py" --overlay "$work/hosting/next-static/runtime-overlay" --output "$work/runtime-public"
python3 "$work/hosting/next-static/stage.py" --runtime "$work/runtime-public" --frontend "$repo/deploy-next" \
  --catalogue "$work/hosting/next-static/catalogue.json" --output "$work/public"
node --input-type=module -e '
  const [{ digestTree, treeDigest }, { sha256 }, fs, path] = await Promise.all([import(process.argv[1]), import(process.argv[2]), import("node:fs"), import("node:path")]);
  const out = process.argv[3];
  const files = digestTree(out, [fs.realpathSync(out), fs.realpathSync(process.argv[5])]);
  const fields = { files: files.length, bytes: files.reduce((s, f) => s + f.size, 0), runtimeFiles: files.filter((f) => f.path.startsWith("runtime/")).length,
    headersSha256: sha256(fs.readFileSync(path.join(out, "_headers"))), treeSha256: treeDigest(files) };
  fs.writeFileSync(process.argv[4], JSON.stringify({ classicCommit: process.argv[6], fields, files }, null, 1) + "\n");
  console.log(JSON.stringify({ classic: process.argv[6], ...fields }));
' "$repo/scripts/hosting/stage.mjs" "$repo/scripts/inventory/lib.mjs" "$work/public" "$record" "$runtime" "$commit"
