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
and deployed results. No weights or secrets in Git. Cloudflare work uses the installed `cf` CLI
(`cf cli search "<task>"`, then `<command> --help`), never Wrangler (operator, 24 October 2026).
Dependencies are not pinned (operator, 24 October 2026): add or upgrade with `npm install <pkg>@latest`
(caret range at the latest release), no exact versions and no hold-backs; a latest release that fails a
check is a bug to fix, not a reason to stay behind. Lockfiles still record what resolved and CI installs
with `npm ci`. Integrity hashes for model weights, containers and measured results are not version pins
and stay. Classic's frozen self-host distribution is exempt. Do not infer performance or
completion from repository setup.

The portable Beads graph is `.beads/issues.jsonl`; preserve IDs and dependencies.
Initialize/import a local DB with Beads Rust (`br`) when needed; DB files are ignored.
Implementation started 24 October 2026 (operator): beads are open and claimable; `gate`-labelled
beads stay deferred for the operator. The selected
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
a bead closes on the first green `main.yml` run that contains its commits, across the supported
browser matrix (`browser-matrix.json`: Ubuntu Chrome/Chromium/Firefox/WebKit, macOS WebKit/Firefox,
Android emulator, iOS Simulator, GPU lane), never on the author's word. Main has one CI pipeline, a
merge queue (operator, 25 October 2026; fm-98po): `.github/workflows/main.yml` runs one run at a time
and never cancels it; pushes made while it runs wait, and the next run takes every change pushed
since, stacked, diffs from the last green run's head and calls only the lanes those paths select
(`scripts/ci/path-filters.json`). Area workflows are reusable (`workflow_call`), never push-triggered.
A red run covering several beads is bisected locally on eris and only the culprit stays open. CI
closes beads; it does not gate starting the next.
Beads enforce this (`.beads/policy.yaml`, no bypass): `br close` refuses while any acceptance item is
unchecked, so tick each one as you verify it (`br update <id> --check-acceptance <n|text>`). There
are no close-after waits (operator, 24 October 2026): a check that spans two beads belongs to whichever
lands second, so if the other has not landed, add the check to it and close. `beads-check.yml` fails on
any unchecked item on a closed bead and on a bead closed past an open blocker.
Failures come back as work: a failed lab run (`lab.py` passback), a red CI run bisected to a bead, or a
failed release check reopens the bead with the `reopened` label, the evidence as a comment, and a new
unchecked acceptance item, so it cannot be closed again until that check passes. Agents take open
`reopened` beads before new work, whoever they were assigned to.
User-visible or speed-affecting beads are also put through the lab by their implementer once CI is
green (`lab.py qualify --run <CI run id> --bead <id>`: a pass records the evidence, a real failure
reopens the bead with `device-lab-failed`). If a cell is unavailable the bead keeps `lab-pending`
until a later lab run covering it, or the release bead's full validation, settles it.

Commit method: Jeffrey Emanuel's swarm method (operator, 25 October 2026; enforced by fm-1pt6). Every
agent works on `main` in this one tree (no worktrees, no side branches, no PR queue) and pushes straight
to `main`. Breakage is stopped before the push; `main.yml` is the backstop, not the first check.
- Reserve files in Agent Mail before editing them. The Agent Mail pre-commit and pre-push guards run in
  block mode and are never bypassed (`--no-verify`, `AGENT_MAIL_BYPASS`); if Agent Mail is unreachable,
  restore it before committing.
- Commit only the paths you changed (`git add <paths>`, `git commit -- <paths>`), never `git add -A` or
  `git commit -a`, because other agents' uncommitted work lives in the same tree.
- Before each commit, format and lint the files you changed.
- Before each push, land the plane: run the gates for every lane your commits touch (format, lint,
  typecheck, unit tests, and the build or import checks those paths select, the same mapping `main.yml`
  uses) and push only when they pass. The versioned hooks (`npm run hooks:install`) do this for you.
- A push that turns `main` red is its pusher's first job to fix, before new work.
The ordering edges serialize shared-file edits and the lab lock serializes the devices.
Prefer the self-hosted runners (eris `device-lab`, triton on the `tank` pool) over hosted minutes.
The phone's Frigate camera stays held off until the operator asks for it back.


## Honest Work and Anti-Ceremony (binding for agents and humans alike)

The purpose of agent work here is working, deployable capability. Process
serves that outcome and never becomes the product.

- A process artifact (certificate, ledger, dashboard, matrix, meta-report,
  speculative check) may be created only if it names a concrete consumer,
  the named feature it gates, the observed defect class justifying it, and
  its deletion condition. Otherwise it does not get created. Boundary test:
  if running code branches on it, it is product; if only humans and status
  reports read it, it is process and the creation-gate rule above applies;
  code written just to flip this answer counts as the pathology, not as a
  consumer. Sole exception: a minimal
  integrity/recovery control (crash-recovery state, provenance snapshot) is
  legitimate when it prevents a named evidence-loss or corruption mode and
  is necessary and minimal.
- Real code + real tests in the same unit of work. Forbidden: faked tests,
  fixtures/mocks presented as live proof, weakened assertions, golden
  regeneration to force green, hard-coded success paths, placeholder macros
  in commits, editing the spec instead of implementing it, narrowing scope
  while claiming full success.
- No self-certification: work is closed by an independent verifier citing
  evidence at an exact revision. Solo sessions re-verify by re-execution and
  state what was not independently verified.
- A typed refusal beats a fabricated result and is less valuable than the
  real capability; refusal-only work stays open and says so.
- Truthful null results ("checked X, found no material increment") are
  successful outcomes. Unsupported claims are worse than silence.
- Metrics predeclare denominator and countermetric; agreement between
  agents may raise confidence but is never independent evidence; never
  silence stderr in evidence-bearing commands.
- Name these pathologies when they occur (gate self-weakening, proof-class
  inflation, golden regeneration, tolerance widening, suppression-pragma
  laundering, refusal farming, follow-up laundering); the names are the
  deterrent. The full catalog with countermeasures lives in the
  just-say-no-to-process-porn-and-ceremony skill; ask the operator for it
  if you cannot resolve that reference.
