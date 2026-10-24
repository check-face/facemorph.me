# FaceMorph monorepo agent guide

Work comes from the Beads graph (`.beads/issues.jsonl`); start with `br show fm-fy2`, the entry
bead. [PLAN.md](PLAN.md), the `repo-cleanup-and-architecture-refactor` plan, is frozen background
since 24 October: where a bead and the plan differ, the bead wins. Inspect `git status` before
choosing work. Use Cass for relevant feedback
(`cass search ... --robot`). Preserve concurrent changes; no worktrees/reset/clean.

This is a fresh repository bootstrap, not a working app. Start with the
source/repository identity and application inventory beads; organization rename may be
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
plan's requirements drift ledger, strict TypeScript and package boundaries govern
implementation. Distinguish planned, experimental, implemented
and deployed results. No weights or secrets in Git. Do not infer performance or
completion from repository setup.

The portable Beads graph is `.beads/issues.jsonl`; preserve IDs and dependencies.
Initialize/import a local DB with Beads Rust (`br`) when needed; DB files are ignored.
All tasks remain deferred until implementation is explicitly started. The selected
organization login is `facemorph-me`, while remotes currently use `check-face`.

Execution graph (converted 24 October 2026 at the operator's request, then consolidated to
shippable slices per PLAN.md "Bead size and ceremony"): the 22 earlier `fm-fy2*` IDs are kept.
Each bead's `external_ref` is `plan:<key>`; its workstream is a `ws-<name>` label. There are no
workstream or milestone join beads; never use `parent-child` links, which block in `br` and
deadlock the graph. Once implementation starts, pick work with `br ready --exclude-label gate`
or `bv --robot-next` (never bare `bv`). Beads are self-contained and are the execution and
scope authority; change scope with `br update` on the affected beads, never only in `PLAN.md`.
Record an operator decision once in the plan's dated decisions table as well. Evidence for a
bead is its merged commit and CI run; no per-bead receipt files. The tracker is published to
https://beads.dilger.dev (behind Cloudflare Access) by `beads-site.yml` on every push to `main`
that changes `.beads/`.

No fakes in tests (operator, 24 October 2026): no mocks, stubs, test doubles, fake clocks or
timers, mocked browser APIs, or recorded responses replayed as proof. Pure decision logic takes
time, capabilities and digests as plain values and is tested by calling it; anything with I/O
runs against the real thing (real app, worker, browsers and devices; temporary Git repositories;
a local S3-compatible store, since storage scripts speak the S3 API rather than one provider's;
Prometheus/Grafana containers; local servers with a fault switch). Planted input files are
inputs, not fakes. A case nothing real can produce is reported untested.

Swarm: every agent is fungible and picks from Beads (`ops/swarm/implementer.md`). There is no
standing release-manager agent; the release manager is the hat worn by whoever takes the release
bead (`delivery.handover`, fm-s3o). Coordinate through MCP Agent Mail
(`agent-mail.service`, a systemd user unit on eris at `http://127.0.0.1:8780/mcp/`; `am` CLI):
register, reserve files before editing (`am file_reservations reserve`), put the bead ID in
the thread, release when done. Launch with NTM from any directory:
`ntm spawn facemorph --cc=N [--omp=1]` (`~/ntm_Dev/facemorph` links to this checkout; session
names cannot contain dots). Claude panes start with Remote Control on, so each appears in
claude.ai and the phone app. `omp` panes run GLM (`glm-5.3-flash`, `:glm` for `glm-5.3`) as
best effort: when GLM credit runs out those panes stop and the rest of the swarm carries on.

The original plan and supplied crop screenshots are locked local references linked
from `PLAN.md`. Preserve their bytes and follow the original crop design plus explicit
operator revisions.

Device lab and releases (24 October 2026): `tools/device-lab/` runs the end-to-end journeys on eris
(WebGPU, CPU) and the USB P30 Pro (WebGPU via debug flags, CPU), on demand when a bead needs device
evidence (`lab.py qualify --run <id>` for a candidate build). It is best effort: an unavailable
device or runner never blocks anything; runs queue, and missing cells are recorded as untested. A real
failure passes beads back. The new app deploys to next.facemorph.me only when the full release bead set
is ready: the agent taking the release bead validates everything locally, then deploys. Nothing here
ever stops new work being picked up. Build, test and validate locally as you go (eris, triton, the
phone via the lab). Closure loop (`fm-fy2` step 8): test locally in the Linux browsers on eris (system
Chromium with and without WebGPU; Playwright Chromium, Firefox, WebKit) and on the phone when relevant;
a bead closes on the first green CI run on a `main` commit that contains its merge commit, across the
supported browser matrix (`browser-matrix.json`: Ubuntu Chrome/Chromium/Firefox/WebKit, macOS
WebKit/Firefox, Android emulator, iOS Simulator, GPU lane), never on the author's word. CI is
newest-only (concurrency groups, `cancel-in-progress: false`), so a waiting run can be replaced by a
newer push and a later green run covers it; a red run covering several beads is bisected locally on
eris and only the culprit stays open. CI closes beads; it does not gate starting the next.
User-visible or speed-affecting beads are also put through the lab by their implementer once CI is
green (`lab.py qualify --run <CI run id> --bead <id>`: a pass records the evidence, a real failure
reopens the bead with `device-lab-failed`). If a cell is unavailable the bead keeps `lab-pending`
until a later lab run covering it, or the release bead's full validation, settles it.

One checkout, no merge queue: every agent works in this one tree (no worktrees) and pushes straight
to `main`. Commit only the paths you changed (`git add <paths>`, `git commit -- <paths>`), never
`git add -A` or `git commit -a`, because other agents' uncommitted work lives in the same tree. Agent
Mail reservations and the ordering edges serialize edits, the lab lock serializes the devices, and
newest-only CI verifies `main`.
Prefer the self-hosted runners (eris `device-lab`, triton on the `tank` pool) over hosted minutes.
The phone's Frigate camera stays held off until the operator asks for it back.

