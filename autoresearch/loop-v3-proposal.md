# Autoresearch loop v3: close the evidence-to-product gap

Proposal, 10 October 2026. This is a design for the next research loop, not a
claim that its runner, device coverage, or release gates already exist.
`program.md` remains the current research policy until this is implemented.

## What the repository already has

- `run.py` serializes cooperating work per device, bounds a command, and saves
  output plus an execution journal. It deliberately sets
  `qualification: not_evaluated` even when the command exits zero.
- `benchmark-campaign-v2` defines workloads and a target matrix, but its plan is
  generated as `planned-unexecuted`. Its inventory records facts and explicitly
  gives every imported row `speedRankingEligible: false` and
  `releaseQualified: false`.
- Candidate scripts and `results.tsv` contain strong manual ABBA experiments. The
  October eris runs isolated GPU synthesis, frame tails, and warm model loading;
  paired results led to the frame pipeline, direct WGSL, GPU RGBA8, and OPFS cache
  changes. The product's `runtime.mjs` and `ort-worker.mjs` can run real fixed
  latents and encoder checks through the same path users take.
- The evaluation is uneven. Recent eris product runs use seven deployed canaries,
  while full31, physical phones, the built UI/video writer, and Safari OPFS remain
  open for particular claims. Several ledger evidence paths point to ignored local
  artifacts or `~/Work/runs`, so another checkout cannot audit them from Git alone.
  `results.tsv` also has an S24 `keep` row explicitly marked full31 pending.
- The delivery docs record a real promotion failure mode: the benchmarked S24
  kernel was not the deployed kernel. Product CI now checks built artifacts, but a
  research `keep` row still does not itself bind a measured candidate to shipped
  bytes and supported device rows.

The missing piece is a **decision engine with evidence provenance**, connected
to the candidate site that people actually use. Physical iPhone evidence cannot
be made a prerequisite for every push when that evidence requires a push. A
faster candidate becomes a supported iPhone route only after the pushed build
returns a correct result and the actual device reports what ran.

## Physical iPhone loop: push, try, fall back, learn

Use `next.facemorph.me` as the iPhone research surface for bounded candidate
trials. Another site would test a different cache, origin, service worker,
headers, and user flow. Desktop/Simulator qualification before a push catches
obvious faults, but the physical iPhone's correctness, memory survival, browser
policy and time to result are learned from the pushed build. Ask testers to use
their normal phone and send the diagnostic report reference; avoid making them
choose an engine or export JSON.

For an eligible iPhone, try the promising candidate first, then the next
plausible route in measured order, and stop at the **first route that passes its
initial device canary and produces a result**. Continue to a slower route if a
candidate fails admission or later fails during generation. A route that cannot
run at all should fail a cheap capability/resource check before downloading its
weights. Continue background canaries and invalidate the route if they fail;
an initial pass is provisional, not a full31 qualification. Do not retry a
candidate repeatedly within the same job after a tab
reset, out-of-memory event, or known deterministic correctness failure. Preserve
the input and completed faces throughout the fallback. If all routes fail,
report the failure clearly and retain the diagnostic trail.

The experience can be worse during a trial: first use may spend time probing a
fast path that fails, then loading a fallback. Bound that cost and disclose that
the site is testing faster processing. A passing fast route should not be forced
through every slower route for measurement. Compare it against a control in a
separate bounded diagnostic run when feasible, or record it as an unpaired
observation until there is a valid physical same-device comparison. A successful
CPU/WebGL fallback proves that fallback worked; it does not certify the failed
candidate or establish its speed.

This is **not yet the implemented iPhone ladder**. Today `runtime.mjs` probes a
real adapter, prefers WebGPU when offered, and can fall back to CPU/WebGL;
`route-priors.mjs` has a different WebGL/CPU order without WebGPU. The direct
WGSL engine is excluded from mobile devices because its binding requirements
exceed reported phone limits, so simply changing its user-agent guard would
mostly measure a predictable setup failure. Candidate eligibility must be based
on actual adapter limits and a phone-sized implementation. `encodePhoto` checks
the streamed encoder's `phoneAdmitted` flag. The checked-in candidate manifest
currently sets it `true` under friends-and-family candidate admission based on
an iOS Simulator report, with physical performance explicitly unqualified.
That permits a bounded physical photo trial on the pushed build, while its
result still needs physical evidence and separate encoder/synthesis attribution.

Diagnostics already stage records locally and send only with tester consent;
they record route admission/refusal and browser/build facts. Extend that record
with closed-vocabulary **attempt** events: candidate ID, engine ID, manifest
digest, route, order, capability rejection, canary outcome, failure category,
elapsed setup/download/synthesis time, selected fallback, and terminal result.
Never include a photo, latent, seed, name, face, raw error text, or full hardware
identifier. A `gpu-engine-fallback` event currently reaches the product progress
path but is absent from `reporting.mjs`'s allowed stages, so a report cannot
reconstruct direct-to-ORT fallback. Save a small attempt marker before each
heavy step and recover it after a reload, since iOS may kill the tab before an
ordinary terminal event is sent. Upload recovered records only under the
existing opt-in/one-report consent model. Check collector schema and 30-day
retention when adding fields.

## Objective

Improve *time to a usable result* for the workflows people actually run: first
validated face, photo to reconstructed face, ordinary/custom morph to playable
file, and a repeated request served from originals, through saving and sharing. Include
navigation to a responsive UI, first usable preview, download/verification, and
share/export completion. Track the first visit, repeat visits, and repeated
requests separately, with explicit cache state and observable finish boundaries. Optimize within unchanged numerical and reliability constraints;
record memory/storage cost and regression on other routes as separate outcomes.

There is no single global milliseconds-per-face score. A 5 ms kernel gain on eris
cannot outweigh a 5 s photo acquisition gain on a phone by arithmetic alone.
Maintain a frontier per `(physical device class, browser/native provider, engine,
workflow, cache state, bundle version)` and select experiments by the bottleneck
and uncertainty in that cell. Share hypotheses across cells; never share an
unmeasured speedup or admission verdict across them.

## One iteration

1. **Reconcile.** Read the run journal, raw reports, ledger, current source hash,
   product bundle hash, and device availability. Mark interrupted or stale work
   before choosing anything new. Compare the measured candidate hash with the
   shipped hash. Record a stale result as historical, not a current control.
2. **Select one question.** Choose the highest-value unresolved cell: a correctness
   blocker first, then an unqualified product path, then the largest measured
   critical-path cost with a plausible change. Write a short experiment spec with
   hypothesis, control and candidate hashes, fixed workload, expected mechanism,
   required gates, resource cap, stop condition, and the result that would refute
   it. Prefer an experiment that eliminates an uncertainty over another small
   desktop component speedup.
3. **Make an isolated candidate.** Use versioned files under `autoresearch/` and
   a recorded build artifact or immutable source snapshot of the same product baseline (no worktrees). Record exact model,
   runtime, fixture and reference hashes. The candidate can change one causal
   factor at a time; if it needs an additional fix, start a new revision and keep
   the failed run.
4. **Screen cheaply, then qualify.** Static checks and a few diagnostic cases
   catch errors quickly. A screen is never a `keep`. Run the fixed full31
   synthesis comparison and the relevant photo, morph, cache, export and recovery
   checks before making a product-facing performance claim. Distinguish unchanged
   float/RGB gates from any separately reviewed precision policy.
5. **Measure the real path.** For controlled devices, acquire the existing lease
   and record a same-run control and candidate in alternating ABBA order, at
   least three observations each, after fixed warmup. Use the built UI when the
   proposed gain involves UI, storage, download, codec, routing, or first-result
   timing. For tester-owned iPhones, ship the candidate behind capability checks
   and fallback, collect consented product-path attempts, and mark the result
   observational until a same-device control is available. Capture visibility,
   actual provider/engine, bytes, stage times, resource failures and tab resets.
6. **Decide by gate, then effect.** Failed or missing correctness is `fail` or
   `inconclusive`, with no speed ranking. A clean paired gain must exceed observed
   run-to-run noise and have acceptable memory, storage and fallback behavior.
   Tiny wins need a simplicity argument. Save control and candidate distributions,
   not just medians. Record `keep-research`, `discard`, `inconclusive`, or
   `blocked`; none means `release-qualified`.
7. **Verify transfer and trial.** Freeze source/assets/settings and checksums,
   replay available checks against the exact built artifact, and compare runtime
   and model digests to the experiment. Push a bounded candidate trial through
   existing product build/promotion gates, then collect physical iPhone attempts
   from that exact build. A passing desktop gate permits the trial; it is not an
   iPhone certificate. If the shipped bytes differ, the measured speed claim
   stays attached to the research candidate, never the live site.
8. **Update the frontier and queue.** Attach raw evidence or a durable content
   address and record missing target cells. Choose the next iteration from the
   new bottleneck. If a result changes the route order, update measured priors and
   their explanation together.

## Machine-readable contract to add

Keep `results.tsv` as a readable summary, but generate its new rows from a
validated experiment record rather than editing numbers by hand. A minimum
`experiment.json` has:

```json
{
  "id": "example",
  "question": "Does eager verified acquisition shorten a warm first face?",
  "workload": "first-validated-face/warm-visit",
  "target": {"device": "eris", "physical": true, "browser": "Chromium 152", "provider": "webgpu", "engine": "direct"},
  "control": {"source": "sha256:...", "bundle": "sha256:..."},
  "candidate": {"source": "sha256:...", "bundle": "sha256:..."},
  "inputs": {"model": "sha256:...", "fixtures": "sha256:...", "references": "sha256:..."},
  "gates": ["full31", "first-face", "cache-integrity", "cancellation"],
  "primaryMetric": "firstValidatedFaceMs",
  "budget": {"runSeconds": 900, "peakBytes": null}
}
```

The runner adds observed environment and run IDs, control/candidate order,
sample arrays, correctness results, raw report hashes, missing gates, and a
decision with reasons. `null` means unmeasured, never zero. `physical` must be
established by the runner/device record, not inferred from a user agent. Refuse
comparisons if bundle, workload, fixture, provider, environment, or timing scope
differs unexpectedly. Keep an append-only event trail so a crashed runner leaves
a durable partial outcome. Store bulky reports outside Git if necessary, but give
each cited report a retained location and digest that another checkout can fetch.

Implementation should be small and incremental:

1. Add a validator and decision report around the existing `run.py`; do not
   replace its lease. First ingest one existing eris ABBA series and show the
   exact missing gates and artifact paths. This exercises the schema without
   claiming a new speedup.
2. Adapt `morph-frame-pipeline-v1/run-product.sh` and its JSON output to the
   contract. Teach the driver to schedule and resume bounded ABBA runs, then to
   produce the TSV summary from raw hashes. Require full31 where the fixed
   references are available; otherwise emit `screened` and queue the missing
   qualification on a capable target.
3. Add an artifact replay check: measured bundle digest must equal the built
   qualification artifact digest. Feed its result into candidate handoff, not
   the research speed decision. Exercise this with an intentionally mismatched
   digest to prove it fails closed.
4. Add a consented product diagnostic adapter for the pushed candidate site:
   exact build/engine attempt IDs, terminal and recovered-interruption events,
   with a report reference a tester can send. Reconcile those reports into the
   same evidence contract. Keep physical Android/iPhone observations distinct
   from controlled eris and Simulator runs; unavailable hardware yields a queued
   gap, never a simulated pass.

## Balanced research queue

Run browser GPU, browser CPU, WebGL, photo/end-to-end, and physical-device
questions as independent lanes. Choose the next experiment from measured
bottlenecks and available hardware, rather than making iPhone the sole
optimization target.

1. **Browser WebGPU versus native CUDA on the same eris GPU.** The October
   direct-WGSL/RGBA8 result is 37.1 ms per morph frame through the product
   runtime; fused native PyTorch is about 30–31 ms to host uint8 RGB. The
   endpoints differ (the browser path includes conversion/PNG), so first collect
   matched W+ to RGBA and matched complete-frame timings, GPU-only and total,
   with identical 1024 inputs and full31 correctness. Profile per block and
   dispatch. Test one kernel hypothesis at a time: reuse noise/input buffers,
   retune GEMM tiles for channel sizes, or a bounded 3x3 convolution algorithm.
   Beating native on this one GPU is plausible, not established. Check the
   resulting browser winner on another GPU before treating it as a general win.
2. **WebGL convolution redesign.** Pure WebGL takes roughly 8.5–10.9 s/face in
   the iOS Simulator and about 13 s on the S24, versus CPU routes that are often
   much faster. The measured coefficient stage is only about 0.66 s; convolution
   stages dominate. `webgl-vector-v1.mjs` draws once per output-channel group,
   runs long scalar accumulation loops in fragment shaders, repeatedly fetches
   weights, and reads back a full float frame. Profile draw counts and each
   block on a device where WebGL is relevant. Try one bounded change such as
   channel tiling with packed weights or accumulating several channel groups
   per pass. Require full1024 correctness and an end-to-end gain; stop investing
   if a serious redesign still trails an available CPU route. WebGL can remain a
   valuable compatibility fallback without being the default speed path.
3. **Browser CPU and photo encoder.** Benchmark WASM thread count, memory and
   session reuse on the same devices; four threads are already selected when
   isolation allows, so another thread-count tweak needs a measured reason.
   For photo e4e, measure acquisition, verification, shard creation and compute
   separately: earlier browser evidence put acquisition at 79% of the run, and
   OPFS saved about 5.5 s on a warm eris first photo. Test bounded residency or
   fewer reads before sacrificing numerical quality or doubling WASM heap.
4. **Whole morph and export.** Direct WGSL and GPU RGBA8 have paired eris
   speed wins, but the built UI/video writer and the cold-profile ~1 s
   derivative stall after roughly 19 images remain open. Measure a playable
   26-frame export in a visible browser and remove the dominant stage there.
5. **Physical iPhone trials.** Make each attempted engine and fallback visible
   in consented diagnostics, persist interrupted attempts, and prepare a
   phone-sized candidate with a cheap resource check. Push through the
   candidate site's normal gates, then ask physical testers for ordinary face,
   photo and morph runs with report references. CPU synthesis failed frame 00
   historically; separate encoder and synthesis outcomes. Treat those reports
   as physical observations, not matched speedups until controls exist.
6. **OPFS portability and quota.** Safari/iOS, Android, quota pressure and
   concurrent repair are still untested. Collect warm-load/storage diagnostics
   from the pushed build, then make a paired claim only where the same device
   has a control.

This ordering may change as fresh reports arrive. The selector should explain
why it chose the next question and what evidence would change that choice.
