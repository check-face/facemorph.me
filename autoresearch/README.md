# Performance research environment

Read [program.md](program.md) for the hypothesis → validate → measure → keep/discard loop and parallel-work rules.

## Setup check — 14 September 2026

- Browser lab already has isolated workers, persistent reports, fixed numerical fixtures and bounded timeouts.
- Added four-lane continuation protocol, evaluation ledger (`results.tsv`) and per-device command lease with append-only execution journal (`run.py`).
- Runner checks passed: contention returns 75, timeout returns 124, launch failure returns 127, successful commands complete, leases can be reused, and execution success remains explicitly unqualified.
- Existing lab/native Python syntax and 11 lab JavaScript files pass syntax checks. Torch/NumPy/ONNX/ORT imports and local fixture/model files are available.
- Native benchmark still needs CPU/MPS/CUDA selection and numerical qualification. Current sandbox reports MPS/CUDA unavailable; GPU access requires a verified runnable environment, not a claim based on historical results.
- Latest stored suite .6 has visibility confounders; suite .7 is configured but not established as fully measured. WebGL currently supplies renderer diagnostics, not an inference backend.

The agent session drives research. A hosted benchmark server is not an autonomous agent; no scheduler is installed by this setup. `run.py` protects cooperating processes only. UI edits/remote CI may run concurrently; local heavy tests/builds must use the same device lease or a separate quiet window.

The evaluation ledger starts empty intentionally: historical raw reports remain in `review-artifacts/`, and are not retroactively promoted as clean paired results. Future candidates live in `candidates/<id>/`; shared frontend and packaging consume frozen bundles instead.


## Expanded round — 14 September 2026

Current runnable environment has native MPS available (the setup-time sandbox
observation above is historical). Packaging-neutral Torch MPS and native ORT CPU
adapters have now passed the frozen all31 checks in ABBA comparisons. Timing/order
confounding is recorded as inconclusive in `results.tsv`; no winner was promoted.
See [native/device matrix](../desktop_inference_research.md).

The [admission contract](candidates/browser-diagnostics-v9/admission-policy-v1.js)
and negative tests explicitly block missing release/reliability evidence, stale
canaries, runtime failure, memory contention and unverified video export. Product
integration remains separate. The shared lab's S21 candidates and colour/reference
diagnostics are versioned, selectable and automatically saved.

## Research rounds and append-only records

Use the [round registry](reviews/README.md) for active review status and the
[record standards](records.md) for prospective formats, correction entries and
reporting requirements. The [performance-history README](history/performance-through-2026-10-09/README.md)
holds dated gains and older device comparisons separately from current rounds.
Preserve existing `results.tsv` rows verbatim; append new outcomes and corrections.
Round journals record proposals, observations, implementation and deployment as
separate events. Current latency claims require recent actual analytics/debug
reporting matched to build, device/browser, route, workload and cache state.
