# FaceMorph monorepo agent guide

Read ALL of this file and README.md at startup and after compaction. Inspect `git status`
and relevant Cass feedback (`cass search "<task>" --robot`) before editing. Work comes
from Beads: `br show fm-fy2` is the entry guide; `br ready --exclude-label gate` or
`bv --robot-next` selects work (never bare `bv`). Beads are the execution and scope
authority. PLAN.md is frozen architectural background; update affected beads when
scope changes, and record operator decisions once in its dated table.

## Current application and delivery

Implementation is underway here: strict TypeScript, React, Vite and npm workspaces.
New development and autoresearch belong here. `../facemorph.me-classic/` retains
history and supplies https://next.facemorph.me from `candidate/next-delivery-20260916`
until qualified handover. Classic Docker/PyTorch work stays there. Legacy checkface
is archived as-is; fm-control and fm-direct are historical benchmark copies.

`npm run build` builds the evolving monorepo app. `npm run build:next` currently
fetches the pinned classic CONTROL into deploy-next; it does not build your changed
application source. Label control evidence accurately. A control pass proves the
harness/control path, never completion of the migrated product. See
[docs/dev/build-next.md](docs/dev/build-next.md) and [autoresearch/README.md](autoresearch/README.md).

Preserve existing Next features and integrated optimizations while applying the
plan's changes. Web-only release; native packages retired. Keep CPU/WebGPU selection,
bounded CPU fallback, qualified WASM/e4e helpers and working iPhone/mobile paths;
remove WebGL execution without deleting shared coefficient assets. Admission is per
operation/capability, never a blanket phone prohibition. Keep model-free names and
completed-file use where computation is unavailable. Preserve raw synthesis within
the plan's small numerical tolerances and exact recovery values independently of
image compression/container bytes. Minimize real choosing/generation/export waits.
Qualify cache warming against foreground, memory and mobile budgets; no hidden repair.
The crop design and supplied references linked from PLAN.md remain locked.

No weights or secrets in Git. Cloudflare work uses installed `cf` (`cf cli search`,
then command help), never Wrangler. Add/upgrade dependencies with `npm install <pkg>@latest`
(caret at latest, no exact pins or hold-backs); lockfiles remain for `npm ci`.
Integrity digests are not dependency pins. Classic's frozen distribution is exempt.
Current GitHub owner is check-face; selected future organization is facemorph-me.

## Work loop: one agent now, swarm later

Operator instructions override this guide and generic skills. **Work directly in
this session, outside NTM, with ONE agent until the operator changes that.** Skip
Agent Mail registration/reservations/threads in solo mode. Use
`AGENT_MAIL_GUARD_MODE=warn` on commits AND pushes; no `--no-verify` or mail bypass.
Do not restart panes, launch a swarm or spawn helpers in the current mode.

1. Inspect changes and inspect CI once at startup:
   `gh run list --workflow main.yml --branch main --limit 5`.
   If a relevant completed run failed, use `gh run view <id> --log-failed`, diagnose
   the actual failure and repair attributable breakage before new work. CI does not
   automatically reopen beads today: whoever observes a real failure updates/reopens
   its responsible bead with the failing command/log and an unchecked repair item.
   Local lab passback can do this when explicitly given bead IDs. No indefinite
   watching, `gh run watch`, sleep-and-poll loops or mandatory bisection framework.
2. Read the whole bead and claim it with `br update <id> --claim --actor <name>`.
   Prefer open `reopened` work. Do not take work from a live owner; abandoned claims
   may be reassigned with an explanation. Run `br sync --import-only` after a pull.
   Never edit working `.beads/*.jsonl` by hand; use `br` and preserve IDs/dependencies.
3. Implement a working slice with meaningful tests. Choose validation proportional
   to the change: relevant unit tests, build/typecheck for source changes, real local
   browser/device checks for affected journeys. Use eris, its GPU and the USB phone
   in the loop. Do not run every CI lane or a detailed timing campaign per edit.
   A documentation correction needs no synthesis benchmark. A GPU change does need
   real GPU evidence. Read your changed code with fresh eyes and fix what you find.
4. Install versioned hooks with `npm run hooks:install` after `npm ci`. Hooks preserve
   the Agent Mail chain and check formatting/lint on exact staged/pushed blobs.
   They do NOT execute builds or tests. Run the relevant shared commands yourself:
   `npm run typecheck`, `npm run build`, targeted `node --test ...`, workspace tests
   or the affected workflow commands. Use UBS when available and useful; its absence
   is not a blocker for normal contributions. Fix failures, never hide them.
5. Tick acceptance only for checks actually executed. Close completed work on local
   evidence (`br update <id> --check-acceptance ...`, `br close ... --reason ...`),
   then `br sync --flush-only`, commit your changes with the bead ID and push directly
   to main. CI is the backstop, not a precondition for closure or starting the next
   slice. A failed check is work to repair, not permission to weaken it. Keep incomplete
   acceptance open; move a genuinely cross-bead check to its implementer with a clear
   link rather than falsely ticking it. No universal independent-verifier gate.
6. Hand off what changed, executed checks and material untested work. End a session
   when useful; no compulsory one-bead restart. Do not sit watching CI. A deliberate
   hand-driven infrastructure repair may inspect its resulting run to verify the fix.

Beads publish at https://beads.dilger.dev on metadata changes. Closed beads must have
all acceptance checked and no open blocking dependency (`.beads/policy.yaml`,
`beads-check.yml`). There are no workstream join/parent-child edges. Gate-labelled
beads stay with the operator. No extra receipts per bead: cite commits, commands,
logs and CI runs as appropriate. Record planned, experimental, implemented and
DEPLOYED results distinctly; never imply deployment from a local build.

When multiple agents are explicitly enabled, retain the same implementation loop;
register with MCP Agent Mail, reserve edited files with the bead ID, answer relevant
mail, release on completion, and use guard block mode. Service: eris
`agent-mail.service`, http://127.0.0.1:8780/mcp/ (`am`). Agents are generalists; no
standing release-manager role. NTM is an optional launcher, not a correctness gate.
[ops/swarm/implementer.md](ops/swarm/implementer.md) supplies matching marching orders.

## Git and edits

One checkout, main, direct pushes. Preserve all other sessions' changes; no worktrees,
stash, reset, clean, force push or destructive checkout. Never commit everything in
an already dirty tree. Stage only your paths/hunks. For wholly owned paths, path-scoped
commits avoid others' staged changes; shared files need selective index staging and
inspection before committing. Do not use path-scoped commit on a partially staged
shared file, because it would include the whole working file. Never `git add -A` or
`git commit -a`. Check both staged diff and working diff before landing.

Edit existing implementations/callers directly; no `_v2` copies or compatibility
wrappers for our own code. A second implementation must replace/subsume the first.
No unrelated file deletion. Remove only task-owned temporary outputs. Preserve
concurrent code/data and consult current library documentation when needed.

## CI queue and hardware

The queue has ONE definition: `.github/workflows/main.yml`, concurrency group main,
`cancel-in-progress: false`. A running workflow finishes. GitHub keeps one pending
workflow and newer pushes replace only that pending workflow. Its selected lanes
cover cumulative changes since the last successful main run (all lanes when there
is no successful baseline). There is no separate queue daemon, Beads queue or local
Actions interpreter. Area workflows are reusable; ordinary main pushes enter through
main.yml. Never resolve throughput problems by cancelling the running workflow.

`scripts/ci/path-filters.json` selects lanes. README/docs/swarm instructions alone
need no application sweep; Beads-only changes run Beads checks/publication. Cumulative
unverified code still selects its checks even if the newest commit is metadata only.
GPU timing research is explicitly dispatched, not run on every push. Current hosted
Android/iOS/macOS/Windows coverage is release-only; Linux/browser correctness lanes
are push backstops. Do not claim full hosted phone coverage on each push.

Correctness builds/tests run concurrently on available CPUs/GPUs; no machine-wide
exclusive lock. Timing measurements alone require `autoresearch/run.py --exclusive gpu-timing`
with bounded wait and honest busy/deferred results. Runner/driver changes are in progress:
verify the installed runner supports this flag; defer timing if it does not. The physical P30 Pro runs locally,
never in CI; `tools/device-lab/lab.py` serializes only the physical device with bounded
per-device locks. Eris browser cells do not wait behind a phone run. The Frigate phone
camera stays held off until the operator asks otherwise.

Use lab preflight and the affected journey on the exact candidate artifact. Current
implemented journeys: cold-face, warm-face, morph, operated. Unknown names must fail.
Frozen per-cell journey budgets and further photo/export/blend journeys are unfinished;
do not report them enforced. The lab is best effort: unavailable cells are untested,
never passing evidence. Real failures must be repaired. Full release validation,
strictly-not-worse paired checks and required hosted coverage remain release work;
proportional slice validation does not waive them. The release bead fm-s3o deploys
next.facemorph.me after qualification, then checks deployed phone/eris journeys.
Production facemorph.me promotion/API retirement still need the operator's decision.

## Honest tests and useful process

No mocks, stubs, doubles, fake clocks, mocked browser APIs or replayed responses as
proof. Test pure decisions with plain values; use real processes, temporary Git
repositories, browsers/devices and real services for I/O. Planted input files are
inputs. Impossible/unavailable cases are reported untested.

Ship real code and relevant tests together. Never loosen tolerances, regenerate goldens,
silence evidence errors, hard-code success or edit a specification to call broken
behavior complete. A refusal or placeholder is incomplete capability. Null results
are useful; self-speedups against an earlier run alone are not incumbent wins.
Metrics state denominators/countermetrics; independent execution is evidence, agreement
between agents alone is not. Avoid speculative checkers, ledgers and process artifacts:
add only the minimal mechanism fixing an observed defect for a named consumer.
