# Autoresearch

**Operator direction, recorded 10 October 2026:** optimize the overall performance
of the application, from first load all the way through generation and sharing.
Make it snappy on the **first visit and the nth visit**. Every stage is in scope:
page and UI startup, previews, asset acquisition and verification, model loading,
photo decode/crop/alignment/e4e, synthesis, morph scrubbing, video encoding, storage,
saving, sharing, and recovery. Optimize the complete useful experience as well as
individual kernels.

Research runs in this **facemorph.me repository**. Its product trial surface is
**https://next.facemorph.me**. [Development](../docs/dev/README.md) implements product
requirements and integrates/delivers improvements. Autoresearch identifies the
bottleneck, tests a hypothesis, measures its effect, and records the evidence.
A research win needs product integration and verification before it is a shipped win.

The [10 October screenshot/process correction](../docs/plans/feedback-process-2026-10-10.md)
is the current UX/retention direction. Use navigation or photo selection through
decoded playable, save-ready video as the principal happy-path comparison across
available device/route cohorts, with fixed workload and separate first/repeat
visits. Keep first-face, responsiveness, restore and failure measurements beside
that total so a codec/kernel win cannot conceal a worse useful experience.
Bounded last-video retention is now allowed; replay is a separate cache journey.
Lossy cache/output pixels need practical quality, not exact decoded-pixel parity;
latent/model identity and integrity remain exact. Worker/PNG use are candidates
to measure rather than immutable product requirements.

## What to measure

Keep these scenarios separate; record the actual cache state, device, engine,
browser, source/artifact version, and network conditions for each observation.

| Scenario | Useful outcomes |
| --- | --- |
| First visit, empty caches | Navigation to responsive UI/preview; consented download bytes and time; time to first usable generated face; time to save/share it |
| Repeat visit, models cached | Reload to usable UI; model reads, verification and session creation; first new face/photo/morph; time to save/share |
| Repeated request, originals/frames cached | Time to display and share the existing result; avoid unnecessary downloads, workers, inference, and encoding |
| Continued session | Next face/photo; multi-face morph; first scrubbable frame; playable video; share/save completion |
| Interrupted or evicted state | Recovery to a correct usable result after cancellation, cache eviction, route failure, or tab reset |

Use navigation/request start and an explicit user-visible finish as end-to-end
boundaries. A frame assigned to an image URL is not necessarily painted; an MP4
encoded is not necessarily playable; opening a share sheet is not proof that a
recipient received a file. Record the observable boundary and browser/API limits.
Stage timings explain the total; they do not replace it. Record responsiveness,
bytes, peak memory/storage, failures, and fallback alongside latency. Never combine
cold and warm samples or treat a cache hit as an inference timing.

## The working loop

1. **Recover context.** Inspect current changes, Cass feedback, the ledger, run
   journal, and available devices. Identify the deployed build and any unfinished
   run. Keep historical observations distinct from a current control.
2. **Choose a bottleneck.** Pick one user journey/cache state and write a hypothesis,
   control/candidate source and asset hashes, correctness checks, expected effect,
   resource budget, and stop condition. Prioritize user-visible delay and uncertainty;
   rotate through CPU/GPU and browser/native coverage rather than only tuning desktop GPU.
3. **Prepare a bounded candidate.** Use `candidates/<id>/` for experiment code and
   settings. Use recorded artifacts or source snapshots for controls; do not create
   or use worktrees. Coordinate product-source experiments with development and
   preserve its concurrent changes. A component bench must identify the product
   path that will confirm the gain.
4. **Validate, then measure.** Run applicable tolerance based numerical and workflow
   checks, acquire the device lease, and collect a same-device control/candidate
   comparison in alternating order with repeated samples. Use the actual built UI
   for loading, UI, storage, codec, and sharing claims. Mark contention and missing
   gates honestly. Follow [program.md](program.md) for the detailed protocol.
5. **Record every outcome.** Append a scoped result to `results.tsv`, including
   discards, failures, and inconclusive runs. Cite retained raw reports, sample
   distributions, exact inputs/hashes, stage/total boundaries, and remaining gates.
   `run.py` journals command execution only; exit zero is not qualification.
6. **Transfer and verify.** Freeze a useful candidate with its evidence and limits.
   Development integrates it and checks the built/deployed product. Confirm the
   same bytes and scenario before assigning a performance claim to the live site.
   Update the next bottleneck and unresolved device coverage.

For physical iPhones, use bounded candidate trials on `next.facemorph.me` after
available desktop/simulator checks. Check adapter/memory limits and device canaries;
fall back when an attempt fails. Preserve consented diagnostics identifying the
attempted engine, failure stage, and successful fallback, including interrupted
attempts where possible. A fallback success does not qualify the failed candidate.
Observational tester reports are useful evidence, not a paired speedup. Physical
phone evidence is gathered after a push; simulator evidence does not stand in for it.

## Files and commands

| Path | Role |
| --- | --- |
| [program.md](program.md) | Detailed current protocol, acceptance rules, and dated research decisions |
| [results.tsv](results.tsv) | Tracked evaluation ledger; each row is scoped to its actual evidence |
| [run.py](run.py) | Bounded command runner and cooperative per-device lease |
| `state/<run-id>/`, `state/runs.jsonl` | Ignored raw output, metadata, and append-only execution journal |
| `candidates/<id>/` | Versioned experiments, hypotheses, recipes, and results |
| [devices/eris](devices/eris/README.md) | eris device rules and runnable benchmark recipes |
| `artifacts/`, `~/Work/runs/` | Local raw evidence; ignored/nonportable unless copied to a durable, retrievable location |
| [benchmark-campaign-v2](benchmark-campaign-v2/README.md) | Historical proposal portfolio and target matrix; planned rows are not measurements |
| [loop-v3-proposal.md](loop-v3-proposal.md) | Proposed automation and evidence contract; not an implemented decision engine |
| [history](history/setup-2026-09.md) | Archived setup observations, not current readiness |

Run from the repository root, using the same device name for all heavy work on
that physical machine. On eris, for example:

```sh
python3 autoresearch/run.py --lane browser-gpu --device eris --timeout 1500 -- \
  autoresearch/devices/eris/gpu-bench.sh <label>
```

For previous feedback, use `cass index --json` when the local archive needs a
refresh, then `cass search "<topic>" --workspace /home/cdilga/Work/dev/checkface
--mode lexical --robot --limit 5 --max-tokens 2000`. Never launch bare `cass` from
an agent. Device-specific recipes state their own prerequisites; this guide does
not claim every historical lane is available on the current machine.

## Evidence and correctness

Keep full-resolution outputs, model/fixture provenance, applicable numerical
thresholds, privacy, and recovery behavior. Artifact/model checksums identify
bytes; exact decoded-pixel hashes are not the parity gate between builds. Use the
existing tolerance based float/image comparisons. Do not silently change quality
to make a candidate win. Missing evidence remains unmeasured, never zero latency.
Keep raw evidence retrievable before cleaning any experiment environment.

An agent session drives the current loop; `run.py` is not an autonomous scheduler.
The v3 proposal describes automation still to build. Historical `keep` rows with
pending gates remain limited evidence, not release certificates.

## Research rounds and append-only records

Use the [round registry](reviews/README.md) for active review status and the
[record standards](records.md) for prospective formats, correction entries and
reporting requirements. The [performance-history README](history/performance-through-2026-10-09/README.md)
holds dated gains and older device comparisons separately from current rounds.
Preserve existing `results.tsv` rows verbatim; append new outcomes and corrections.
Round journals record proposals, observations, implementation and deployment as
separate events. Current latency claims require recent actual analytics/debug
reporting matched to build, device/browser, route, workload and cache state.
