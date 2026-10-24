# Research protocol

Revision of 24 October 2026 (fm-zxj), written for this repository. Start with [the research guide](README.md);
[PLAN.md](../PLAN.md) and the beads govern release scope over anything older. The protocol imported from classic is in
classic's Git history and [history/program-through-2026-09.md](history/program-through-2026-09.md).

## What is optimised

Every wait a person sits through in the new application, from first load to a saved or shared file: UI and startup,
previews, downloads and verification, model loading and residency, photo decode, crop, alignment and e4e, synthesis,
morphs, codecs, storage, Save and Share, cancellation and recovery. Browser CPU, browser GPU, native CPU and native GPU
stay separate lanes. Support is what a device actually showed; history does not establish it.

Pick a journey and a cache state before a kernel. Cohorts stay separate: empty cache, cached files in a new browser,
a live resident session, cached output, a restored result. Finish boundaries are named and fixed: a decoded, drawn face;
a useful scrub frame; a playable video; a prepared file; the Save or Share handoff. Different devices, providers,
workloads or boundaries are never a paired speedup. Prefix-cache and style-mixing workloads do not stand in for an
ordinary morph; cached-video replay is never generation performance.

## One experiment

1. **Read first.** Cass feedback, `git status`, the [ledger](results.tsv) tail, the newest round log, the device recipe
   and the machine's journal (`<lease dir>/runs.jsonl`). Inspect any interrupted run before resuming. Record source,
   artifact, runtime, model, fixture, reference and provider identities.
2. **One falsifiable mechanism.** Write the hypothesis, its control, the expected mechanism, the required checks, the
   budget, the stop condition and the observation that would refute it, in the round's `experiments.md` (from
   [the templates](rounds/templates/round.md)). Versioned experiment files live under a new candidate directory; no
   worktrees.
3. **Correctness before speed.** Run the applicable numerical and workflow checks at the frozen tolerances (raw
   synthesis: max RGB difference 1, sampled raw float 0.002; e4e latent 0.0001). Screening cases are not
   qualification. Never lower resolution or widen a tolerance silently; a quality-policy change is its own decision.
4. **Lease, then measure.** Take the device lease for every heavy build, correctness run, warmup and measurement
   (`python3 autoresearch/run.py ...`, see the guide). On the cell:
   - control/control pairs first, to measure the cell's own noise;
   - a discarded warmup, then control and candidate in alternating ABBA order, at least three pairs on the same cell;
   - a fresh confirmation run, separate from screening, before anything is called a gain.
   Record visibility, concurrent load, network and cache state, the actual engine, resources, failures and raw
   samples. A contended or hidden run is inconclusive. Claims about startup, UI, storage, codecs or Save latency need
   the built app; isolated inference timing does not establish them.
5. **Record.** Append one scoped outcome per row to [results.tsv](results.tsv) under the 11-column header, evaluated
   outcomes only, and the round log entry beside it ([record standards](records.md)). Record failed and interrupted
   attempts. Missing samples or missing correctness is never zero latency or a win. A noisy minimum is not a gain.
6. **Hand on.** Freeze the useful source, assets and settings with checksums. A ledger `keep`, an integration commit
   and a deployed validation are three different facts; transfer is verified against the built app before the speed
   claim is assigned to it.

## Boundaries

- No resets, no empty-ledger initialisation, no rewriting earlier ledger bytes or log entries: corrections are new
  rows and new entries citing the earlier ID.
- No unbounded looping: every command has a budget (default 600 s, at most 3,600 s); split slow checks into recorded
  bounded runs rather than dropping cases.
- No crash-as-zero metrics: a crash, timeout or missing sample is recorded as such.
- One lease per physical machine, shared with classic, the device lab and heavy CI. Never interrupt someone else's run
  or a person's app to get a quiet window; the lease does not see uncooperative processes.
- Preserve concurrent edits in the shared checkout: no reset, clean, stash, branch switch or worktree.
- Native evidence stays historical: native packages are retired, and native rows are not current product claims.
- No paid resources or service changes follow from a research hypothesis.

## Reporting an opportunity

An opportunity is raised to the operator or planner, not built straight away. It names: the source or artifact; the
affected wait, journey, cache state and device; the bottleneck or hypothesis and the mechanism; consent, asset,
memory and cancellation costs; the invariants it must preserve; the platform cells; a suitable worker; and the next
test that would refute it. A proposal is not a ledger outcome and does not authorise tracker work.

## Physical devices and analytics

Phone and simulator evidence is reported separately from desktop; simulator results are functional evidence with
stated limits, and tester observations are not a paired speedup. Current latency claims need recent real-visitor
statistics or consented diagnostics matched to release, device, route, workload and cache state; missing context means
unknown.
