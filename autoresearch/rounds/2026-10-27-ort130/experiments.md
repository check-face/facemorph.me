# ORT130-CPU-TEMPCPU-V1

Hypothesis: the upstream ORT 1.30 CPU runtime preserves the frozen synthesis
results and does not regress package startup, resident synthesis or sampled
browser memory beyond measured control/control noise. Upstream WASM code and
runtime initialization changed; those changes can affect compilation, session
creation and execution even when tensor values remain identical. Runtime size
is measured as a separate cost and is never described as a latency gain.

Control: the pinned ORT 1.24.3 CPU runtime in manifest `d9e37e50…`.
Candidate: ORT 1.30 with the serial encoder in manifest `d8ed9d5c…`; full digests
are recorded in the [round summary](README.md). The encoder is not executed by
this synthesis workload, so its heap and photo acceptance remain separate.

Prerequisites: both exact runtime graphs verify; all 31 raw synthesis cases pass
RGB maximum difference <=1 and sampled float error <=0.002 on the actual
measurement browser; code, fixture and browser identities stay fixed. Missing,
skipped or fallback cells cannot satisfy these checks.

The existing `tools/ort-qualify/paired.mjs` driver defines the workload and
measurement math. Use its bounded `run.py --exclusive cpu-timing` invocation,
fresh disk profiles and load ceiling 6. Two discarded warmups precede ABBA x3
(six measured visits per side). Run control/control first; freeze that report
before comparing the candidate. The comparison reports:

- Cold start: adapter/acquisition/loader/mapping admission through first RGBA8,
  excluding browser launch and page import.
- Warm time: the 32 fixed W+ inputs through synthesis, CPU readback and RGBA8,
  divided by 32, without video pacing.
- Runtime response-body bytes, excluding model and fixture data.
- Peak summed browser-process RSS sampled every 100 ms. Shared pages may be
  counted more than once; this is not GPU allocation or encoder WASM heap.

Budget: at most 600 seconds per correctness command and 1,200 seconds per noise
or comparison command. A load-ceiling violation, changed identity, missing
sample, crash or failed numerical gate stops that attempt. Preserve its report;
do not count it as a zero or a pass. A statistically supported regression refutes
the corresponding metric's hypothesis. No minimum-only or cross-device gain is
claimed. A separate confirmation is required before calling a result a gain.

The scope is the package workload on this one CPU cell. Current visitor
statistics are not part of this experiment; it does not establish a visitor,
application, mobile, video or deployed improvement.
