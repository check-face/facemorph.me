# FaceMorph monorepo agent guide

Read [PLAN.md](PLAN.md), the single active `repo-cleanup-and-architecture-refactor`
plan, and inspect `git status` before choosing work. Use Cass for relevant feedback
(`cass search ... --robot`). Preserve concurrent changes; no worktrees/reset/clean.

This is a fresh repository bootstrap, not a working app. Start with the plan’s
source/repository identity and application inventory; organization rename may be
the first execution change, independently of application migration. Source paths in the plan refer to sibling
`../facemorph.me-classic/` until explicitly imported with provenance. Run legacy
build/research commands there; do not assume they exist here.

Classic retains its Git history, candidate branch and current `next.facemorph.me`
delivery. New monorepo promotion to that candidate, then `facemorph.me`, requires
the plan’s correctness checks and explicit operator cutover decision. Preserve
existing Next features and all integrated performance optimizations while applying
the plan’s declared changes; no historic-API parity or phone-readiness gate. Backend `checkface` is archived
as-is; integrate and qualify its server/PyTorch/Compose in the classic repo.

The release is web-only; native desktop packages are retired for now. Retain browser
CPU/WebGPU selection, bounded CPU fallback, qualified WASM/e4e helpers and working
iPhone/mobile paths. Remove WebGL execution without deleting shared coefficient
assets. Admission is per operation/capability, never a blanket phone prohibition.
Phones remain first-class targets. Preserve the plan's named desktop/mobile/GPU CI
lanes, source-specific performance mechanisms and available no-regression checks.
Preserve raw synthesis within the plan's small numerical tolerances; exported image
compression/container bytes may differ. Keep exact recovery values independently.
Use capable development workers and shared device leases to save GitHub minutes;
retiring Triton inference hosting does not retire that machine as a worker.
Minimize each user wait and full choosing/generation/export journeys. The plan
recommends explicitly approved synthesis+photo preparation, synthesis-first transfer
and overlap with photo selection; Generate (without encoding) remains a clear choice. Qualify eager
verified-cache warming against foreground/memory/mobile budgets with no hidden
network repair. Raise new performance opportunities to the operator/planner with
evidence or a hypothesis and the next test. New development and any further
autoresearch happen in this repo and optimise the new app; classic is being wound down
(see the plan's end-state and autoresearch re-homing sections). Until re-homing lands,
use the plan's targeted research launch recipe, whose existing commands run only in
classic with its append-only experiment history; start no new rounds there.
Keep model-free names/completed-file use where computation is unavailable. The
plan's requirements drift ledger, research map, strict TypeScript and package boundaries govern
implementation. Distinguish planned, experimental, implemented
and deployed results. No weights or secrets in Git. Do not infer performance or
completion from repository setup.

The portable Beads graph is `.beads/issues.jsonl`; preserve IDs and dependencies.
Initialize/import a local DB with Beads Rust (`br`) when needed; DB files are ignored.
All tasks remain deferred until implementation is explicitly started. The selected
organization login is `facemorph-me`, while remotes currently use `check-face`.

Planning-pass rule: keep specification workstreams in `PLAN.md` separate from
execution records. The latest operator request authorizes one deferred independent
published-npm-package acceptance bead, including public docs and real registry use.
Keep this exception scoped to that item. Otherwise do not create, import, update
or open Beads during planning or fresh review. Existing `.beads` descriptions predate the revised remaining-work
plan; treat them as deferred historical execution setup until a separate requested
synchronization. Use the reviewed plan as the scope authority.

The original plan and supplied crop screenshots are locked local references linked
from `PLAN.md`. Preserve their bytes and follow the original crop design plus explicit
operator revisions. Planning uses named architecture workstreams, not ticket IDs or
a Markdown Beads graph; execution decomposition remains a separate requested step.
