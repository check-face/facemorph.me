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

Device lab and releases (operator revision, 25 October 2026): `tools/device-lab/` runs the
end-to-end journeys on demand when a bead needs device evidence (`lab.py qualify --run <id>` for a
candidate build). Resource policy, three classes:

- **Correctness work** — CI lanes, builds, unit and browser-matrix tests, lab journeys that assert
  pass/fail: no lock, no exclusivity, on eris's full CPU and GPU alongside everything else. Slow
  under load is fine; nobody waits on anybody.
- **GPU timing runs** — anything that measures milliseconds (research benches, strictly-not-worse
  pairs): run through `autoresearch/run.py --exclusive gpu-timing`, which holds a machine-wide
  flock shared by CI and local runs, so two timing runs never overlap. It waits at most `--wait`
  seconds (CI default 1800) and exits 75 (busy) rather than ever blocking a correctness job; record
  contention or defer honestly. No correctness job ever sets or waits on this lock.
- **The physical phone (USB P30 Pro) never runs in CI** (operator, 25 October 2026). Agents run
  `lab.py matrix` locally against candidate builds during development; at handover the release bead
  runs the phone and eris against the deployed next.facemorph.me release (`lab.py matrix --url
  https://next.facemorph.me`). CI covers phones via the hosted Android emulator and iOS Simulator
  lanes only.

It is best effort: an unavailable device or runner never blocks anything; runs queue, and missing
cells are recorded as untested. A real
failure passes beads back. The new app deploys to next.facemorph.me only when the full release bead set
is ready: the agent taking the release bead validates everything locally, then deploys. Nothing here
ever stops new work being picked up. Build, test and validate locally as you go (eris, triton, the
phone via the lab). Closure loop (`fm-fy2` step 8; operator revision, 25 October 2026): validate locally before you
push — run the gates your changed paths select (typecheck, build, unit tests, the path-selected
import or scaffold checks) and iterate on the specific tests your bead is working on, not every
lane or the whole browser matrix (`browser-matrix.json`: Ubuntu Chrome/Chromium/Firefox/WebKit,
macOS WebKit/Firefox, Android emulator, iOS Simulator, GPU lane); CI runs those so you do not have
to. Tick acceptance items only from checks you actually executed, then close the bead and push —
never wait for or watch CI to consider work done. `.github/workflows/main.yml` is the backstop
(merge queue, operator, 25 October 2026; fm-98po): one run at a time, never cancelled; pushes made
while it runs wait, and the next run takes every change pushed since, stacked, diffs from the last
green run's head and calls only the lanes those paths select (`scripts/ci/path-filters.json`). Area
workflows are reusable (`workflow_call`), never push-triggered. CI never gates closing a bead or
starting the next; a red run is bisected locally on eris and the culprit bead reopens with the
`reopened` label — breakage you pushed is your next work, not a wait. Bead comments written before
this revision (25 October 2026) that say to close on the first green `main.yml` run are superseded
by this loop: close on the executed local gates and say so in the close reason.
Beads enforce this (`.beads/policy.yaml`, no bypass): `br close` refuses while any acceptance item is
unchecked, so tick each one as you verify it (`br update <id> --check-acceptance <n|text>`). There
are no close-after waits (operator, 24 October 2026): a check that spans two beads belongs to whichever
lands second, so if the other has not landed, add the check to it and close. `beads-check.yml` fails on
any unchecked item on a closed bead and on a bead closed past an open blocker.
Failures come back as work: a failed lab run (`lab.py` passback), a red CI run bisected to a bead, or a
failed release check reopens the bead with the `reopened` label, the evidence as a comment, and a new
unchecked acceptance item, so it cannot be closed again until that check passes. Agents take open
`reopened` beads before new work, whoever they were assigned to.
User-visible or speed-affecting beads are also put through the lab once a `main.yml` run has built
them (`lab.py qualify --run <CI run id> --bead <id>`: a pass records the evidence, a real failure
reopens the bead with `device-lab-failed`); implementers usually leave `lab-pending` and a later lab
run or the release bead's full validation settles it — the lab is never a wait. If a cell is
unavailable the bead keeps `lab-pending`
until a later lab run covering it, or the release bead's full validation, settles it.

Prefer the self-hosted runners (eris `device-lab`, triton on the `tank` pool) over hosted minutes.
The phone's Frigate camera stays held off until the operator asks for it back. The ordering edges
serialize shared-file edits; there is no machine-wide device lock (operator, 25 October 2026) —
only GPU timing runs exclude each other.


## Swarm method (Jeffrey Emanuel's, adopted whole; operator, 25 October 2026)

Source: the AGENTS.md files of his `ntm`, `beads_rust`, `beads_viewer`, `mcp_agent_mail` and
`agentic_coding_flywheel_setup` repositories. fm-1pt6 makes the checkable parts mechanical.

- **Rule 0.** An instruction from the operator overrides anything in this file.
- **One tree, one branch.** Everyone works on `main` in this checkout (no worktrees, side branches or PR
  queue) and pushes straight to `main`. Breakage is stopped before the push; `main.yml` is the backstop.
- **Other agents' changes.** Files you did not touch change in the tree many times a minute; they are
  other agents' work. Never stash, revert, overwrite or otherwise disturb them, and never stop to ask
  about them. Commit only your own paths (`git add <paths>`, `git commit -- <paths>`), never `git add -A`,
  `git commit -a` or a bare `git commit`.
- **No file deletion** unless the bead you hold names that deletion or the operator asks for it; otherwise
  ask. **Irreversible commands** (`git reset --hard`, `git clean`, `rm -rf`, `git checkout -- <path>`,
  `git stash`, force-push, anything that can overwrite code or data) are never run unless the operator
  gives the exact command and says they want its consequences; restate it and what it affects first.
- **Editing discipline.** Change code by hand, never with a script that rewrites source files (many simple
  edits: parallel subagents). Revise files in place: no `_v2`, `_new`, `_improved` copies; a new file only
  for genuinely new functionality. One reachable implementation per capability: a second one lands only
  in the change that deletes or subsumes the first. No compatibility shims or wrappers for our own code;
  fix callers directly (file formats the plan requires us to read are features, not shims). When unsure
  how a third-party library works, read its current documentation online.
- **Start of work.** `br sync --import-only` after every pull. `br ready --exclude-label gate` or
  `bv --robot-next`, claim, then `cm context "<task>" --json` and `cass search ... --robot` for prior
  lessons. Reserve the files in Agent Mail with the bead ID as reason, and post `[<bead>] Start: <title>`
  in the bead's thread. If Agent Mail is unreachable, say so to the operator and restore it before
  committing (`am`, `agent-mail.service`).
- **While working.** Progress goes in the bead's thread. Never edit `.beads/*.jsonl` by hand; only `br`.
- **Before each commit.** `ubs <changed files>` (exit 0 or fix and re-run), format and lint the changed
  files. The Agent Mail pre-commit guard runs in block mode; never bypass it (`--no-verify`,
  `AGENT_MAIL_BYPASS`). Commit messages name the bead ID; `.beads/` changes go in with the code they
  describe.
- **After substantive changes and before each push,** run the gates for every lane your commits touch:
  typecheck, build, unit tests, plus the import or scaffold checks those paths select (the mapping
  `main.yml` uses); the versioned hooks (`npm run hooks:install`) run them. Push only when they pass.
  Never weaken a gate to get green. A push that turns `main` red is its pusher's first fix.
- **Landing the plane** (end of every session, all five steps; the work is not done until it is pushed):
  1. File beads for any remaining or discovered work (`br create`).
  2. Run the quality gates if code changed (tests, linters, builds), as above.
  3. Update bead status: close finished work whose gates you ran locally; CI verifies after the
     push and a failure reopens the bead as new work.
  4. `br sync --flush-only`, commit `.beads/` with your paths, push.
  5. Hand off: release reservations and post `[<bead>] Completed` (or where you stopped and why) in the
     bead's thread so the next session can continue.
- **Results.** Reporting a loss or a null result is a success. A self-speedup against an earlier run of
  your own code is maintenance, not a win; a win needs the incumbent measured in the same invocation.


## Token, context and validation discipline (operator, 25 October 2026)

The 24–25 October burn was context multiplication, not single big reads: sessions that stayed alive
re-sent their entire accumulated context every turn. One pane session billed ≈1.8B tokens (99%
cache-read) across ~1,500 turns and 1,300+ Bash calls while it watched CI; sessions that ended at
bead boundaries cost orders of magnitude less.

- Read narrowly: locate with `grep`/Cass first, then read the specific line ranges you need;
  whole-file reads only for genuinely small files. Unbounded reads of large files were the
  second-largest burn after CI watching.
- Validate narrowly: run the gates and tests your changed paths select (`scripts/ci/changes.ts`
  and `scripts/ci/run-lanes.ts` show the path→lane mapping) and iterate on the specific failing
  test you are fixing; never a full lane sweep or e2e pass per slice. The full browser matrix and
  device cells are CI's and the lab's backstop job, not yours per slice.
- Never poll CI: no `gh run watch`, no sleep-and-check loops. Push, land the plane, end the
  session; results come back as reopened beads or evidence comments.
- One bead per session; land the plane at every bead boundary. A live session re-bills everything
  it has ever read on every turn.
- Device and lab resources: the lease (`autoresearch/run.py`, `tools/device-lab/lab.py`) exists for
  timing accuracy and single-phone exclusivity during measurement runs. Everyday local validation
  never takes it and never waits on it; only timed measurement runs and phone/GPU-exclusive e2e
  hold it, best effort — an unavailable device records `untested`/`lab-pending` instead of
  blocking anything.

## Single-agent mode (operator, 25 October 2026, until revoked)

One agent works at a time, in a single NTM pane of the `facemorph` session. Skip Agent Mail
registration, file reservations and threads — the bead graph plus Git are the only coordination
surfaces — and run commits with the mail guard in warn mode (`AGENT_MAIL_GUARD_MODE=warn`; there
are no concurrent writers to guard against; never `AGENT_MAIL_BYPASS`). Beads still claimed by a
name with no live pane (`ntm status facemorph` finds no session) may be taken, with a comment
saying so. Keep the anti-burn cadence: one bead per session, land the plane, restart the pane
(`ops/swarm/implementer.md`). Everything else — one branch (`main`), gates before push, no fakes,
no ceremony — applies unchanged. When swarm mode resumes, this section is deleted, the mail guard
returns to block mode, and `ops/swarm/implementer.md` governs panes again.

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
