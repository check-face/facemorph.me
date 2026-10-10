# Autoresearch protocol

Updated **10 October 2026**. Start with [the research guide](README.md), which
records the operator's objective: optimize overall application performance from
first load through generation and sharing, making the first and nth visits snappy.
The [development guide](../docs/dev/README.md) covers product implementation and
delivery from this repository to **https://next.facemorph.me**.

## Experiment scope

Every processing stage is eligible: UI/startup, previews, downloads, verification,
model loading/residency, photo decode/crop/alignment/e4e, synthesis, morphs, codecs,
storage, saving/sharing, cancellation and recovery. Maintain browser CPU, browser
GPU, native CPU, and native GPU coverage as separate lanes. Device availability
and qualification must be observed; historical results do not establish support.

Choose a user journey and cache state before choosing a kernel. Record complete
workflow timing with explicit start/finish boundaries, and stage costs explaining
the total. Keep first visits, repeat visits with cached models, repeated requests
with cached outputs, and continued-session measurements separate. Do not compare
different devices, providers, workloads, or timing boundaries as a paired speedup.
Prefix-cache/style-mixing workloads do not stand in for ordinary/custom morphs.

## One iteration

1. Read Cass feedback, `git status`, `results.tsv`, the device recipe, and the run
   journal. Inspect interrupted processes/runs before resuming. Record source,
   artifact, runtime, model, fixture, reference, and provider/engine identities.
2. Write one hypothesis, its control, expected mechanism, required checks, resource
   budget, stop condition, and the observation that would refute it. Use versioned
   experiment files under `candidates/<id>/`. Record baseline artifacts or source
   snapshots as controls; do not create or use worktrees.
3. Validate the candidate with the applicable existing numerical/workflow checks.
   Screening cases are not full qualification. Run the existing full31 synthesis
   suite where it applies to the candidate claim, plus relevant photo, cache,
   morph, playable export, sharing, cancellation and recovery checks. Do not
   silently lower resolution or widen precision/error thresholds.
4. Acquire the device lease. On controlled devices, measure control and candidate
   in alternating ABBA order with at least three observations each, after fixed
   warmup. Record visibility, concurrent load, network/cache state, actual engine,
   resource use, failures, and raw sample distributions. Contended/hidden runs are
   inconclusive. Use the built UI for claims about startup, UI, storage, codecs,
   or save/share latency; isolated inference timing does not establish those gains.
5. Append the scoped outcome and raw evidence references to `results.tsv`.
   Existing status values include `keep`, `discard`, `crash`, `inconclusive`, and
   `blocked`; historical rows also use other labels. Record failed and interrupted
   attempts. No samples or missing correctness is not zero latency or a speed win.
   A `keep` requires applicable checks and repeatable paired benefit, acceptable
   resource/fallback costs, and a clear statement of remaining device/product gates.
6. Freeze the useful source/assets/settings and checksums for development. Verify
   transfer against the actual built/deployed product before assigning the speed
   claim to it. Retain raw evidence and update the next bottleneck/coverage gap.

Use existing tolerance based float/image comparisons, not exact decoded-pixel
hashes as a parity gate between builds. Artifact/model file checksums still bind
results to bytes. Keep reference fixtures independent and unchanged. If quality
policy must change, record it explicitly as a separate decision/experiment.

## Shared checkout and compute

Preserve concurrent product edits; do not reset, clean, stash, switch branches,
commit other sessions' work, or recreate discarded old branches. Product-source
experiments are allowed when needed by the hypothesis; coordinate their paths and
integration with development. Keep frozen controls and references immutable.
Device-specific Git and benchmark rules are in [the eris guide](devices/eris/README.md).

Use [run.py](run.py) from the repository root for heavy command experiments:

```sh
python3 autoresearch/run.py --lane browser-gpu --device eris --timeout 1500 -- \
  autoresearch/devices/eris/gpu-bench.sh <label>
```

All cooperating browser/native CPU/GPU work and heavy builds on one machine use
one device name and state directory. Other hardware can run independently. Busy
exits 75 by default; `--wait` is bounded, not a FIFO scheduler. The default command
budget is 600 seconds, maximum 3600. Split slow checks into recorded bounded runs
rather than omitting cases. Each run saves output and metadata and appends
`state/runs.jsonl`; `qualification: not_evaluated` remains true even on exit zero.
Unexpected runner termination can leave child work; inspect before restarting.
The lease does not detect non-cooperating processes. Never interrupt user apps or
another task's benchmark to obtain a quiet window.

## Product checks and physical trials

Core CI verifies the actual product and pinned assets. Keep required checks and
privacy/asset boundaries intact. A component-only or research-only pass is not a
product certificate. Experimental CI is allowed for a concrete target/question:
explicit experimental name, bounded triggers/budget, versioned inputs, retained
results, and retired triggers after the experiment. No paid resources or service
changes are implied by a research hypothesis.

Physical iPhone evidence is collected on the candidate site after available
checks permit a bounded trial. Gate engines on adapter/memory limits and the
current product's device-canary policy, then use bounded fallback on failure.
Follow current production admission policy rather than reinstating expensive
historical per-visit qualification. Full research qualification and quick product
admission checks are different. Diagnostics require existing consent and must
identify attempts/failure stages/fallbacks without private inputs. Record interrupted
attempts where possible. Simulator evidence is functional evidence with explicit
limits; tester observations are not a paired speedup or a universal phone claim.

## Resuming and evidence retention

An agent session drives research; `run.py` is not an autonomous scheduler. Resume
by reading the guide, ledger, journal and device state, then continue one bounded
experiment. Store small durable summaries/source/hashes in Git and keep raw reports
retrievable before cleanup. Ignored artifacts and `~/Work/runs/` paths alone are
not portable evidence. Missing reports and pending gates remain explicit.

The [v3 proposal](loop-v3-proposal.md) describes automation still to implement;
`results.tsv` remains the current evaluation ledger. The
[archived protocol](history/program-through-2026-09.md) and
[setup history](history/setup-2026-09.md) preserve the earlier research record.

## Research rounds and append-only records

Use the [round registry](reviews/README.md) for active review status and the
[record standards](records.md) for prospective formats, correction entries and
reporting requirements. The [performance-history README](history/performance-through-2026-10-09/README.md)
holds dated gains and older device comparisons separately from current rounds.
Preserve existing `results.tsv` rows verbatim; append new outcomes and corrections.
Round journals record proposals, observations, implementation and deployment as
separate events. Current latency claims require recent actual analytics/debug
reporting matched to build, device/browser, route, workload and cache state.
