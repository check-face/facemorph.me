# FaceMorph delivery goal

Ship the qualified monorepo application to **https://next.facemorph.me**, preserving
classic's working features and performance plus the agreed product changes.
Complete the existing Beads with real evidence. A usable deployed app with rollback
is the goal; commits, reports and partially finished beads are not the deliverable.

Read this guide and README.md at startup. Beads are the current scope and acceptance
authority (`br show fm-fy2`); PLAN.md is architectural background. Use CASS for
history and earlier feedback: `cass search "<task>" --robot --fields minimal --limit 5`.

## Work

Work autonomously in the current swarm. Pick useful ready work, claim it atomically,
coordinate file ownership
through Agent Mail, and finish it. Prefer finishing existing acceptance over opening
more partial work. Keep coding, testing and shipping; do not stop just to write a
handoff. Compact in place when necessary and continue until the goal is achieved,
the operator stops you, or no useful work remains without an external unblock.

Use focused subagents when independent coding, investigation or review will make
completion faster and more efficient. Give them bounded tasks and distinct file
ownership; keep integration, meaningful validation and bead completion with the
parent worker. Avoid duplicate work and coordination that costs more than it saves.

Use `br ready --exclude-label gate --brief --json --limit 10` or
`bvr --robot-next --robot-not-ready-labels gate`. Never run the bare viewer TUI.
Gate-labelled decisions remain with the operator. Reclaim abandoned work from
current ownership evidence, preserving its implementation.

Choose local validation proportional to the change: relevant regression tests,
affected build/typecheck, and real browser/device checks for affected behaviour.
Use the fastest sufficient existing script/test before browser automation; preserve
real-input evidence and required cold-state isolation. Bound searches and log output.
A small docs/tooling change does not need the full application matrix. Review your
changes, fix failures, record executed evidence, and close a bead when its complete
acceptance is met. Do not invent follow-up beads or weaken tests to claim completion.

The authoritative device-lab journeys and measured cell budgets are in
[journeys.json](tools/device-lab/journeys.json). `cold-face`, `warm-face`, `morph`
and `operated` are implemented; `operated` has no frozen budget. `photo-face`,
`export` and `blend` remain pending under the owners listed there.

Push tested work and take the next bead while CI runs. Inspect new CI failures once,
assign one repair owner and return regressions to the responsible bead. Finish the
current coherent slice, then repair attributable failures; peers continue independent
work. A failed revision predating an already-landed fix is handled, pending verification,
not a reason to repeat the repair or wait for green before doing useful work.
Let running CI finish; the queue/path filters govern pending runs.

## Preserve

Preserve other sessions' edits. Work on main, stage only owned paths/hunks, and use
Agent Mail reservations with guard block mode. No worktrees, stash/reset/clean,
blanket staging or force pushes. Keep weights and secrets out of Git.
Use npm workspaces and installed `cf` for Cloudflare; reuse existing tools and assets.

Keep product requirements, numerical tolerances and the locked crop design intact.
Runtime/UI changes get a real phone CPU warm-face check or an explicit relevance
explanation. Use the existing device lab; leave the phone camera off and clean up
task-owned processes/device changes. Record implemented and deployed results distinctly.

Release completion still requires applicable CI and the deployed artifact's CPU and
WebGPU journeys on eris Chrome, eris Firefox and the Huawei P30 Pro. Fallback is not
a WebGPU pass. Unavailable hosted simulator/emulator cells are explicitly untested;
real failures require repair. Production promotion and API retirement are separate
operator decisions. See README.md and the release Beads for the full requirements.
