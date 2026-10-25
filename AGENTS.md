# FaceMorph monorepo agent guide

Read ALL of this file and README.md at startup and after compaction. Inspect `git status`
and relevant Cass feedback (`cass search "<task>" --robot --fields minimal --limit 5`)
before editing. Work comes from Beads: `br show fm-fy2` is the entry guide;
`br ready --exclude-label gate --brief --json --limit 10` or
`bvr --robot-next --robot-not-ready-labels gate` selects work. Never run bare `bvr`
or `bv`; both open a TUI. Beads are the execution and scope
authority. PLAN.md is frozen architectural background; update affected beads when
scope changes, and record operator decisions once in its dated table.

## Goal and definition of done

Deliver the sustainable FaceMorph replacement from this monorepo: preserve classic's
working features and integrated optimizations, implement the agreed product changes,
and finish the applicable Beads with real evidence. The immediate delivery goal is
the qualified new app live at **https://next.facemorph.me**, with one publisher and
a usable rollback. Repository setup, closed beads or a control-artifact pass alone
do not achieve that goal. Package/classic distribution work retains its own acceptance;
production facemorph.me promotion and API retirement remain separate operator decisions.

Calling next.facemorph.me done requires the deployed artifact's required journeys
to pass on this **six-cell local matrix**, plus normal applicable CI:

| Local browser/device | CPU | WebGPU |
| --- | --- | --- |
| Chrome on Linux eris | required pass | required pass |
| Firefox on Linux eris | required pass | required pass |
| Chrome on the actual Huawei P30 Pro | required pass | required pass |

Record artifact digest, browser/version, route actually executed and results per
cell. A WebGPU request that falls back to CPU is not a WebGPU pass. Record enabling
flags explicitly; do not infer Firefox from Chromium or silently substitute browsers.
Missing/unsupported local cells leave delivery incomplete; diagnose them rather than
waiving the grid. Hosted iOS Simulator/Android emulator evidence is additional and
best effort under the CI availability policy below. Real executed CI failures require
repair. The current lab has four Chromium/Huawei cells and no eris Firefox adapter;
the six-cell requirement is the acceptance target, not a claim it is implemented.

## Current application and delivery

Implementation is underway here: strict TypeScript, React, Vite and npm workspaces.
New development and autoresearch belong here. `../facemorph.me-classic/` retains
history and supplies https://next.facemorph.me from `candidate/next-delivery-20260916`
until qualified handover. Classic Docker/PyTorch work stays there. Legacy checkface
is archived as-is; fm-control and fm-direct are historical benchmark copies.

`npm run build` builds the monorepo app. `npm run build:next` builds that mounted
Vite application into deploy-next with this repository's destination identity.
Retained classic comparisons fetch their independent, hash-verified control with
`scripts/import/fetch-control.mjs`; a control pass never proves the migrated product. See
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

1. Inspect changes and inspect CI at startup and before picking up each next bead:
   `gh run list --workflow main.yml --branch main --limit 5`.
   Check whether the latest relevant completed CI is green before claiming new
   implementation work. If it is red, repair the failures first unless another
   live agent explicitly owns those repairs. Verify that ownership through current
   Beads/Agent Mail evidence; an old assignee or sent message alone is insufficient.
   With an active repair owner, coordinate and continue independent ready work.
   Queued/running or cancelled runs are not green; record pending verification
   honestly, without indefinite watching or duplicating an owned repair.
   If a relevant completed run failed, capture `gh run view <id> --log-failed` to
   a local file and inspect bounded error excerpts, diagnose
   the actual failure and repair attributable breakage before new bead work. CI does not
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

## Beads tools and bounded context

`br` owns mutations and acceptance; `bvr` is the installed Rust graph viewer and
triage tool. Legacy `bv` also exists; prefer `bvr` for new robot queries. Selection
does not claim work: use `br update <id> --claim --actor <name>` after checking
readiness, gate labels and ownership, not a suggested non-atomic status command.
No NTM session is not proof that an owner working directly is absent.

```sh
br ready --exclude-label gate --brief --json --limit 10
br list --status open --label reopened --limit 10 --json | jq '.issues | map({id,title,status,assignee})'
bvr --robot-next --robot-not-ready-labels gate
bvr --robot-triage --brief --robot-not-ready-labels gate
br show <selected-id> --json
bvr --robot-insights --insight-limit 5 | jq '{cycles: .Cycles, status: .status}'
```

Read the selected bead fully, in chunks if necessary; do not dump the whole tracker,
root epic, plan or history on every tick. A limited ready list is a selection aid,
not proof the queue is empty. Check blocked/in-progress work and source health before
standing down. A busy database, stale source or failed query is unknown, never empty.
`br` does not commit or push; import after a pull and flush before committing.
The installed `br list --json` returns an object with `issues` and pagination;
`br ready --brief --json` returns an array. Check schemas instead of assuming both
have the same shape; honor `has_more` when deciding whether a list is exhausted.

- Search with `rg --files`/`rg -n` first, then read relevant line ranges. Whole-file
  reads are for small files and required startup instructions, not generated files,
  lockfiles, bundles, model manifests, session archives or full CI logs.
- Bound output at the tool boundary, normally at most 2,000 tokens per call,
  including all commands in a batch. Without a tool output budget, capture verbose
  output to a task-specific local file and return the exit status, log path and
  relevant excerpts capped at 120 lines AND 8 KiB. One JSON line can be huge.
- Preserve complete stdout/stderr and the real exit status in captured evidence.
  Mark excerpts as truncated and expand a specific range when needed; never hide
  failures behind a successful `tee`/`head` pipeline or call clipped output complete
  evidence. Do not repeatedly read an unchanged log.
- Project JSON to decision-relevant fields before returning it. Use Cass with
  `--fields minimal --limit 5`, then expand only the selected match. Avoid automatic
  broad history injection; use a small task-specific context budget if enabled.
- Hand off the current bead, revision, commands/results and next action compactly.
  Start fresh when context becomes inefficient, restoring AGENTS.md and the active
  bead; do not carry completed-bead transcripts indefinitely. No compulsory restart
  after every bead.

## Speed, reuse and environment hygiene

Use the fastest, lowest-output method that can establish the fact being checked.
Escalate only when the cheaper method cannot answer it or the acceptance contract
requires a stronger proof:

1. Existing metadata, `rg`, compact `br`/`bvr` queries and targeted pure/unit tests.
2. Existing CLI/API helpers and small scripts against real files, processes or
   services; run the one affected command/test before a broader suite.
3. Scripted browser protocols or existing Playwright/CDP helpers when browser state,
   rendering or the real CPU/WebGPU path is needed. Reuse selectors, sessions and
   setup where the test permits; preserve required cold-cache/profile isolation.
4. Interactive browser harnesses, visual/screenshot loops and coordinate-based
   Android taps only when scripted approaches are insufficient or actual operated
   input is the behavior under test. Prefer stable DOM/semantic targets first.

Do not use a lower-cost shortcut as proof of a higher-level behavior. API calls or
synthetic DOM events do not prove trusted clicks, clipboard/share flows or touch
hit targets; those cases still need real input. Likewise targeted tests speed up
iteration but do not replace the final six-cell browser/device gate and normal CI.

Reuse existing scripts, fixtures-as-inputs, environment tooling and test adapters
before adding another harness. Small disposable probes need not enter Git; use a
task-specific temporary directory and retain only useful findings or required
evidence. Check in helpers only when they serve a named recurring need or acceptance
check. No duplicate implementations, speculative frameworks or permanent scratch files.

Reuse installed dependencies and environments; do not install packages globally or
leave ad-hoc dependencies in the repo. Track task-owned servers, browser processes,
ADB forwards/reverses, profiles, device flags and temp outputs. Stop/restore/remove
only what this task created or changed, preserving other sessions and retained
evidence. Restore the phone to its documented resting state; keep its camera off
under the current operator instruction. No lingering watchers, servers or downloads
after handoff unless explicitly needed and documented with ownership/cleanup.

## NTM tending when explicitly enabled

Launching a worker does not establish persistent orchestration. Before an unattended
NTM run, identify its live orchestrator and how it continues after the initiating
chat ends. Use `vibing-with-ntm` for tending and `multi-agent-swarm-workflow` for
coordination, subject to the active single/multi-agent mode above.

Discover the live robot contract, take one bounded snapshot, then follow cursor
deltas/attention. Before a nudge or restart, corroborate exact pane/process identity,
fresh pane output, ownership and Git/test artifacts. Target the affected pane only;
verify acknowledgment or a real transition. Bound recovery; stop at missing credentials
rather than retrying forever. Preserve and verify the requested model/effort.

Workers validate locally and keep implementing. The orchestrator owns outstanding
CI results and lab-pending work: inspect each newly completed run once, retain its
run ID/revision, distinguish runner unavailability from a failed check, and return
attributable failures to the responsible bead with evidence and an unchecked repair
item. Reopened work takes priority. A sent prompt, an empty ready list or an idle
pane is not completion. Pending CI, unresolved failures and missing required local
release evidence remain outstanding. There is no automatic CI handback service today;
do not describe this contract as implemented.

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

Triton is opportunistic capacity (operator, 25 October): use its available CPUs,
RAM and Docker for compatible work, freeing eris for local development. Portable
Linux CPU jobs use `runs-on: [self-hosted, linux-x64]`, advertised by both Triton
and eris build runners. Never pin a required CPU job to Triton or wait for it to
return; eris can take queued pool jobs when Triton is offline. Keep browser, GPU,
runtime-asset and provider-tool requirements explicit. An interrupted running job
may fail and need a rerun on an available worker; do not count it as a pass or
stop independent implementation. Correctness work shares compute; exclusive
timing/device rules below still apply.

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
GPU timing research is explicitly dispatched, not run on every push. Reuse classic's
working CI approach: Safari in the iOS Simulator inside the GitHub macOS runner,
Chrome in an Android emulator in CI, plus normal unit/build/type/browser tests.
Do not replace simulator evidence with desktop WebKit or require a physical iPhone
for these CI lanes. The retained mobile-browser lane covers Android/iOS components and Simulator CPU
product on selected source pushes; broader hosted macOS/Windows journeys remain release-only.
Linux/browser correctness lanes are push backstops. Do not claim full hosted phone
coverage on each push. Hosted lanes are best effort as runner availability changes:
attempt available lanes with bounded waits; record an unavailable/retired runner or
simulator as `untested` with its reason, never as passed, and do not wait forever or
make it a permanent release blocker. An actual test failure on an available lane
requires repair; best effort is not blanket `continue-on-error`. The current strict
missing-lane summary still needs this availability distinction implemented in fm-5klw.

Correctness builds/tests run concurrently on available CPUs/GPUs; no machine-wide
exclusive lock. Timing measurements alone require `autoresearch/run.py --exclusive gpu-timing`
with bounded wait and honest busy/deferred results. Runner/driver changes are in progress:
verify the installed runner supports this flag; defer timing if it does not. The physical P30 Pro runs locally,
never in CI; `tools/device-lab/lab.py` serializes only the physical device with bounded
per-device locks. Eris browser cells do not wait behind a phone run. Reflex (operator,
25 October 2026): a bead touching browser runtime or UI behaviour (`apps/web/src`,
`packages/*`, worker or model paths) records one `lab.py run --cell phone-cpu --journey
warm-face` (~20 s) or an explicit "phone not relevant" in the bead — never a silent skip.
Any agent may additionally validate on the phone whenever it judges it worthwhile — the
per-device lock makes concurrent attempts safe, the wait is bounded, and busy defers honestly.
The Frigate phone
camera stays held off until the operator asks otherwise.

Use lab preflight and the affected journey on the exact candidate artifact. Current
implemented journeys: cold-face, warm-face, morph, operated. Unknown names must fail.
Frozen per-cell journey budgets and further photo/export/blend journeys are unfinished;
do not report them enforced. The lab is best effort during ordinary development:
unavailable cells are untested,
never passing evidence. Real failures must be repaired. Full release validation,
strictly-not-worse paired checks and available hosted coverage remain release work;
proportional slice validation does not waive them. The release bead fm-s3o deploys
next.facemorph.me after qualification, then checks deployed phone/eris journeys.
For the operator's unattended delivery goal, handover is not complete until the
six local Chrome/Firefox/Huawei CPU/WebGPU cells above pass the required journeys
against the deployed artifact and `post-delivery-check` passes. Missing local cell evidence keeps
delivery incomplete; hosted runner unavailability does not waive these local checks.
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
