# Beads

The execution graph for the `repo-cleanup-and-architecture-refactor` initiative: about 140
beads converted from [PLAN.md](../PLAN.md) on 24 October 2026 and consolidated to shippable
slices. Start from the entry bead `fm-fy2` (`br show fm-fy2`); it explains how to pick, claim,
order and close work. The beads are self-contained and are the scope authority; `PLAN.md` is
frozen background, and where the two differ the bead wins.

`issues.jsonl` is the portable export and the only file that matters in Git. Local SQLite
files, locks and engine sidecars are ignored by this directory's `.gitignore`. `br` and `bv`
are on the workstation's PATH (`~/.local/bin`).

```sh
br show fm-fy2                      # entry bead
br ready --exclude-label gate       # work that can start now (empty while all beads are deferred)
bv --robot-next                     # single best pick; never run bare `bv`
br dep cycles                       # must be empty
br sync --flush-only                # after edits: DB -> issues.jsonl, then commit it with the work
```

Every bead stays `deferred` until the operator starts implementation. Workstreams are `ws-*`
labels; there are no parent, workstream or milestone beads, and `parent-child` links are never
used. Each bead's `external_ref` is `plan:<key>`. A browsable copy is published to
https://beads.dilger.dev on every push to `main` that changes this directory.

The retained classic checkout keeps the historical task DB and export; do not run a second
task queue for this initiative there. Source migrations record classic provenance.
