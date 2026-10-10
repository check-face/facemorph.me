# Research direction after the raw-media round

The operator prioritizes **faster first use and returning visits**, especially
ordinary-policy warm hydration. The current product already delivers initial
`hello`, automatic original restoration, direct display/video pixels and deferred
recoverable downloads. Finished-video caching remains excluded. This is a
proposal queue, not an additional measured or deployed result.

## 1. Attribute warm hydration and admission before changing it

Use the qualified `bce3204` artifact as the next control. Measure a genuinely new
face after reload and fresh browser process with model bytes retained. Compare
automatic route selection and explicit CPU/GPU in separate cohorts. Add request
IDs to research worker traces so foreground generation, initial canary, resumed
background canaries and persistence can be attributed correctly. The current
paired trace has timestamps but no worker request IDs; synthesis events cannot
be safely summed and subtracted from the UI total.

Record model cache reads/verification, session creation, admission, queue wait,
mapping, foreground synthesis and decoded/drawn display. Test whether resumed
qualification delays a rapidly requested next face. The runtime starts resume
work [after delivery](../../../src/Next/browser/runtime.mjs); worker inference
already in flight can still cost wall time before a new request. Preserve the
numerical admission gates. Candidate ideas are scheduling/preemption between
canaries, avoiding redundant verified reads and reusing sessions within the
existing resource policy. Choose one only after a matched stage baseline.

**Decision boundary:** improve request → displayed new face after a returning
visit; do not count an original-cache hit as warm inference. Measure idle and
rapid consecutive requests separately, with restore/save and memory/fallback
checks alongside latency. Match recent consented debug reports before assigning
the controlled result to current user devices.

## 2. Split padded photo preparation from ordinary crop/resize

The [incomplete budget-limited screen](../../candidates/direct-rgba-media-v1/built-ui-timeout.json)
exposed a strong branch difference: its first-photo cases 0–2 spent about 8–9 s
between `photo-warp-resize` and its completion, but case 3 spent only about
15–22 ms. Both builds saw the branch difference on identical matched inputs.
These are investigative timestamps from an inconclusive campaign, not an
accepted speedup, ordinary-photo percentile or current device latency. The
[complete matched screen](../../candidates/direct-rgba-media-v1/built-ui-analysis.md)
reproduced two regimes: four first-photo cases around 8.1–8.3 s, two around
14–17 ms, on both builds. Full photo totals showed no material improvement.
Stage spans remain exploratory, without exclusive attribution or real-photo prediction.

The [native preparation source](../../../photo-runtime/native/photo.cpp) reflects
and pads images, applies a full padded-image Gaussian and median/color blending,
then performs the Pillow QUAD transform. The Gaussian repeats reflected-index
calculation inside the pixel/channel/tap loops. This makes padding a concrete
candidate bottleneck, but the existing trace does not isolate blur from the rest
of preparation, and it does not prove that padding caused the observed branch.

Next screen: report shrink factor, crop/pad dimensions, Gaussian radius and stage
times using public/synthetic controls. Include both padded and non-padded cases
plus the existing independent preprocessing fixtures. First try exact scheduling
or precomputed reflected indices while preserving accumulator order and current
outputs. A SIMD or arithmetic change is a separate numerical candidate; retain
the existing independent preprocessing, W+ and reconstruction checks. Do not
skip alignment merely because a generated face happens to look prealigned.

**Decision boundary:** upload/select → reconstructed face and save readiness with
retained assets, then a different photo in the same session. Include bytes,
landmark model loading/deserialization, detection, warp, encoder handoff and
reconstruction. Broaden beyond RGB-offset variants of one public face before
claiming general photo latency.

## 3. Profile streamed e4e and resource-aware reuse

The product's [encoder residency policy](../../../src/Next/browser/runtime.mjs)
retains the encoder only on non-mobile devices reporting at least 8 GB memory.
Phones and devices without that signal deliberately tear it down. The unchanged
[streamed encoder](../../../photo-runtime/README.md) executes 108 sequential ORT
graphs. Worker-reported inference/session totals do not include the entire
cache-read, verification, tensor-transfer and session-lifetime wall interval.

Profile those intervals on first and next photo before rewriting model arithmetic.
Potential candidates: verified asset reuse within a worker, reduced redundant
reads/copies and bounded residency on demonstrated desktop budgets. Do not
extend desktop retention to phones based on a simulator or navigator memory
hint alone. Measure whole-process and incremental memory, cancellation and
restoration after eviction.

## 4. Complete coverage before further codec tuning

Direct raw transport already has a component win; realtime WebCodecs settings
were discarded. Further FFmpeg work requires a measured fallback run, including
segment startup, raw writes/scaling, encode, concat and playable decode. Its
current concat is stream-copy, not another full encode. An extra pass is not a
performance intervention without a specific measured reason.

GPU compatibility is a separate reliability question: the GTX 1050 control
[failed before a face](../../candidates/direct-rgba-media-v1/gpu-control-failure.json).
The iOS [simulator passed one CPU face](../../candidates/direct-rgba-media-v1/ios-qualification.json),
but physical-phone photo/video/recovery and total memory remain unmeasured.
Collect consented trials on the delivered candidate with attempted engine,
failure stage and successful fallback. Preserve the route policy and resource
limits rather than treating unsupported hardware as a codec speed problem.

## Evidence contract for the next loop

Freeze one hypothesis and exact control/candidate bytes, then validate and run
same-device alternating comparisons under [the protocol](../../program.md).
Keep warm hydration, repeated originals, new photo inference and metadata
recovery separate. Record size/quality tradeoffs and missing resource coverage.
Publish anonymous reporting aggregates, not private photos or diagnostic IDs.
The current round closes with scoped decisions; these proposals begin a new loop.
