# FaceMorph monorepo agent guide

Read [PLAN.md](PLAN.md), the single active `repo-cleanup-and-architecture-refactor`
plan, and inspect `git status` before choosing work. Use Cass for relevant feedback
(`cass search ... --robot`). Preserve concurrent changes; no worktrees/reset/clean.

This is a fresh repository bootstrap, not a working app. Start with RN-01 inventory
and RN-02 contracts. Source paths in the plan refer to sibling
`../facemorph.me-classic/` until explicitly imported with provenance. Run legacy
build/research commands there; do not assume they exist here.

Classic retains its Git history, candidate branch and current `next.facemorph.me`
delivery. New monorepo promotion to that candidate, then `facemorph.me`, requires
the plan’s artifact/qualification/cutover gates. Backend `checkface` is archived
as-is; integrate and qualify its server/PyTorch/Compose in the classic repo.

Shared browser/Tauri product policy, strict TypeScript and package boundaries in
the plan govern implementation. Distinguish planned, experimental, implemented
and deployed results. No weights or secrets in Git. Do not infer performance or
completion from repository setup.

The portable Beads graph is `.beads/issues.jsonl`; preserve IDs and dependencies.
Initialize/import a local DB with Beads Rust (`br`) when needed; DB files are ignored.
All tasks remain deferred until implementation is explicitly started. The selected
organization login is `facemorph-me`, while remotes currently use `check-face`.

Planning-pass rule: keep specification workstreams in `PLAN.md` separate from
execution records. Do not create, import, update or open Beads during planning or
fresh review. Existing `.beads` descriptions predate the revised remaining-work
plan; treat them as deferred historical execution setup until a separate requested
synchronization. Use the reviewed plan as the scope authority.
