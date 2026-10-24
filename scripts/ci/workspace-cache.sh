#!/usr/bin/env bash
# node_modules for a lockfile, installed once per runner and shared by every job on it (fm-98po). The key is the
# lockfile's SHA-256 with the Node major and the machine, so a store holds exactly what `npm ci` would install.
# A hit restores every node_modules directory of the install (the root and the workspaces') into the checkout:
# a reflink copy where the filesystem has one (eris, btrfs), hard links otherwise (triton, ZFS), a plain copy across
# filesystems. Stored files are
# read-only, so a job that writes into an installed file fails loudly instead of changing the store under the
# others. A miss runs `npm ci` and publishes the result atomically (rename), so concurrent jobs never see half a
# store. The three newest keys per directory are kept.
#   scripts/ci/workspace-cache.sh [<directory with package-lock.json>]      one JSON line
set -euo pipefail
dir=${1:-.}
cd "$dir"
lock=$(sha256sum package-lock.json | cut -c1-64)
key="node$(node -p 'process.versions.node.split(".")[0]')-$(uname -m)-$lock"
root="${FACEMORPH_NODE_MODULES_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/facemorph-node-modules}"
slot=root$(printf '%s' "$dir" | sed 's|^\.$||' | tr '/.' '__') # one store per lockfile directory; the key names the install
store="$root/$slot/$key"
start=$(date +%s%N)

restore() {
  local how=reflink
  while IFS= read -r d; do
    rm -rf "$d"
    mkdir -p "$(dirname "$d")"
    if cp -a --reflink=always "$store/$d" "$d" 2>/dev/null; then
      :
    elif rm -rf "$d" && cp -al "$store/$d" "$d" 2>/dev/null; then
      how=hardlink
    else
      rm -rf "$d" # the store is on another filesystem: a plain copy
      cp -a "$store/$d" "$d"
      how=copy
    fi
  done < "$store/.dirs"
  echo "$how"
}

if [ -f "$store/.dirs" ]; then
  how=$(restore)
  result=hit
else
  npm ci --no-audit --no-fund
  tmp="$root/$slot/.tmp-$key-$$"
  mkdir -p "$tmp"
  find . -name .git -prune -o -name node_modules -type d -prune -print | sed 's|^\./||' | sort > "$tmp/.dirs"
  while IFS= read -r d; do
    mkdir -p "$tmp/$(dirname "$d")"
    cp -a --reflink=auto "$d" "$tmp/$d"
  done < "$tmp/.dirs"
  find "$tmp" -type f -exec chmod a-w {} +
  if mv -T "$tmp" "$store" 2>/dev/null; then :; else chmod -R u+w "$tmp" && rm -rf "$tmp"; fi
  # this checkout keeps its own fresh install; the store serves the next job
  how=installed
  result=miss
  ls -1dt "$root/$slot"/node* 2>/dev/null | tail -n +4 | while IFS= read -r old; do
    chmod -R u+w "$old" && rm -rf "$old"
  done
fi
printf '{"event":"workspace-cache","dir":"%s","key":"%s","result":"%s","how":"%s","seconds":%.1f}\n' \
  "$dir" "$key" "$result" "$how" "$(awk -v a="$start" -v b="$(date +%s%N)" 'BEGIN{print (b-a)/1e9}')"
