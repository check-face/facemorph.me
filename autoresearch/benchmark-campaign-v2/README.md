# Synthesis and e4e benchmark campaign v2

16 September 2026. **25 research proposals; no new kernels or inference results.**
The operator is preparing packaging and a separate candidate site in parallel.
Research hands off frozen, checksummed winners, with explicit per-target evidence.
It does not silently replace the release baseline or start the public trial clock.

## Portfolios and execution order

- [10 synthesis candidates](../candidates/synthesis-research-v2/README.md): direct WGSL, WebGL dispatch/tile/residency improvements, CPU and native tuning. The later operator-identified S24 Ultra run passed full31 with a 616.35 ms single-face median and 682.39 ms per sequence face; it is a target, not an iPhone speedup claim.
- [15 e4e candidates and evidence audit](../candidates/e4e-research-v2/README.md): local alignment and CPU controls first, backbone/head streaming, encoder/synthesis lifetime management, GPU and native tuning. All remain proposals.
- [Contract](contract.json): fixed correctness, ordinary/custom morphs, real photo encoding and reconstruction, cache/download behavior, recovery and memory/performance tradeoffs across browser/native/self-host targets.

First establish each missing CPU/photo control and local preprocessing path. In
parallel, implement isolated synthesis P0 candidates against existing controls.
Only benchmark runnable, capability-checked candidates. Run fixed correctness
before paired performance tests; retain failures. Prioritize physical iPhone and
S24 CPU/GPU controls and complete photo workflows over additional Simulator speed
screens. Native Windows/Linux photo qualification is distinct from synthesis CI.

The 384 MiB allowance is an experimental control, not a permanent memory cap.
Test concrete larger working sets with explicit byte accounting and measured
speed/reliability benefit. Simulator success cannot prove phone memory survival.
CPU fallback remains required across the support matrix; this finite research
matrix does not narrow the delivery matrix in `release-tests`.

## What changed in the benchmarks

| Component | Delivered change | Remaining work |
|---|---|---|
| Native synthesis runner | Additive metrics v2: startup/first inference/qualification/warmup scopes, actual placement evidence, fixed-suite identity; duplicate case selections rejected | New inference runs; complete integrated workloads and measured memory |
| Native e4e runner | Explicit actual encoder status, source/model/preprocessing/fixture identity, mixed regression timing, unknown metrics null | Separate neural/alignment timings and reconstruction/cache/recovery integration |
| Browser result retrieval | Adds a scope-aware historical inventory on each operator pull | Implement new candidates and browser per-stage instrumentation, then collect physical-device results |
| All research lanes | Shared workload/identity/stage/memory contract and generated candidate-target plan | Executing that plan; it is not a runnable implementation or a release certificate |

Existing raw reports and correctness policies retain their original meaning.
An old report cannot acquire measurements merely by importing it into v2.
Inventory rows always have `speedRankingEligible:false` and
`releaseQualified:false`: the importer inventories facts, not admission decisions.
Actual encoder declaration does not establish complete photo qualification.

## Is e4e proven on other phones?

**No.** Inspected evidence supports Linux self-host CPU photo/API behavior, Mac
ARM native CPU encoding of two fixed photos, and historical Mac browser WebGPU
encoding/reconstruction with host alignment. It does not establish browser-only
photo uploads on physical iPhone, S24, S21 or other phones. Windows/Linux desktop
CPU synthesis CI does not prove native e4e. See the portfolio's evidence table for
the exact sources and limits. The read-only saved-report refresh on 16 September
found 81 raw reports, with no new or changed reports.

Each photo route needs local decode/alignment, **actual e4e**, independently
checked W+, full1024 reconstruction, original-cache reuse, repeated input and
failure/recovery. Include two fixed synthetic photos, aligned/unaligned cases,
no-face and malformed input. Record actual encoder and synthesis providers
separately. CPU encoder plus GPU synthesis is valid when independently tested.
Precomputed photo latents and video encoding are not e4e evidence.

## Commands

These are lightweight planning, inventory and metadata checks:

```sh
python3 autoresearch/benchmark-campaign-v2/campaign.py plan --output autoresearch/benchmark-campaign-v2/plan.json
python3 autoresearch/benchmark-campaign-v2/campaign.py inventory --reports review-artifacts/device-lab-runs --output review-artifacts/device-lab-runs/benchmark-v2-inventory.json
python3 -m unittest discover -s autoresearch/benchmark-campaign-v2 -p 'test_*.py'
python3 -m unittest discover -s autoresearch/candidates/native-portable-v1 -p 'test_report_metrics.py'
python3 -m unittest discover -s autoresearch/candidates/e4e-research-v2 -p 'test_metadata.py'
```

Actual heavy runs use `autoresearch/run.py --device local-mac` and the appropriate
lane, with the candidate's documented arguments. Never benchmark a proposed
candidate by substituting its control under the candidate name. Keep foreground,
uncontended runs; at least three repeats with reversed control/candidate ordering
on the same device. Record cold acquisition separately from process startup and
warm inference. Account overlapping stages rather than summing them blindly.

Freeze source/model/runtime/preprocessing/fixture/config hashes, exact provider
placement, tested hardware/runtime matrix, unchanged tolerances, stage and memory
reports, failure cases and adapter behavior into each handoff. Packaging pins the
selected bundle; further experiments use new directories. Integrated release
tests, preservation and useful public comparison remain separate gates.
