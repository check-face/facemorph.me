# Screenshot feedback and process correction — 10 October 2026

Status: historical audit and current acceptance direction. Implementation and
delivery status are recorded in [the delivery receipt](feedback-delivery-2026-10-11.md). This supersedes conflicting controls/retention decisions in
[the earlier UI plan](candidate-ui-2026-10-10.md). Preserve the earlier evidence.

## Next iteration

1. Move shape, length and pinch into More options. Restore a labelled shape
   dropdown with all five choices. Use consistent field sizes, spacing and
   borders. Advanced is a separate outlined section below those settings.
2. Keep source-menu and face-picker icons visible without focus/hover. Keep
   Generate present but disabled for empty/ineligible inputs, matching the
   Morph from/to field height. Changing from a restored/photo input to words or
   numbers clears the synthetic label/filename and shows “Just type anything”.
3. Restore the complete ordered face list, useful morph settings and slider
   preference, rather than only whichever face completed last. Retain the last
   completed video when measured storage headroom permits, bound retention to
   one current session, invalidate stale morph/video identities on edits and
   degrade gracefully on quota/eviction/unavailable storage. Source photos remain
   tab-only. A video alone does not restore scrubbable frames: record the frame
   availability and selected slider position separately. Close
   [issue 13](https://github.com/check-face/facemorph.me/issues/13) only after
   persistent slider preference is delivered and checked through reload.
4. Fix generated canvas sizing and verify the full face fits the tile. Remove
   all implicit face-1 actions from the tagline; per-face controls choose targets.
5. Reproduce crop distortion with non-square, EXIF-rotated, mirrored, large and
   multi-face inputs. Make preview/export agree under pan, zoom, rotation and
   responsive viewport sizing. Preserve the declared orientation policy explicitly.
6. Benchmark compressed persistence and encoding placement against the deployed
   control. Preserve exact latent/provenance integrity independently of lossy
   image pixels. Compare first visible face, file readiness, playable video,
   restoration and repeated save; include storage, memory and responsiveness.
   Worker use and raw transport are hypotheses, not unconditional requirements.

## Why the tests missed the defects

Automated phone checks did run. The delivered e0 build has successful
[mobile run 38030647634](https://github.com/check-face/facemorph.me/actions/runs/38030647634).
The raw-canvas followup has successful
[iOS run 38034719345](https://github.com/check-face/facemorph.me/actions/runs/38034719345)
and [retained scope](../../autoresearch/candidates/direct-rgba-media-v1/ios-qualification.json).
These passes were narrower than the operator's actual journey:

- The Android/iOS component suite checks workers, storage, acquisition and PNG
  roundtrip on its own page. It does not exercise the full face/photo/morph UI.
- The iOS product lane generates one face on CPU. It checked intrinsic 1024px
  dimensions and idle state, not rendered bounds inside the tile. Its report
  explicitly lacks photo, download, video, restore and physical-phone coverage.
- The compiled control probe checks startup, option counts and viewport overflow
  before inference. It cannot detect a generated canvas hidden by tile clipping.
- The desktop crop journey keeps a square synthetic face at zoom 1. Its keyboard
  interaction and accepted filename establish plumbing, not non-square geometry,
  EXIF policy, rotated preview/export equivalence or normal-size appearance.
- The deployment job depends on artifact, desktop CPU qualification and compiled
  UI checks. The separate mobile workflow is not a deployment dependency.
- Single-face restore was the approved implementation scope, so tests accepting
  it did not verify the useful return journey of two faces plus a completed morph.

The process error is accepting component existence/intrinsic dimensions as
evidence of usable presentation, and failing to translate the complete user
journey into acceptance checks. Adding more runs of those same assertions would
not catch these issues. Phone simulation also cannot establish physical GPU
performance or memory, but the canvas defect does not need a physical phone.

## Confirmed findings and limits

[Synthetic Chromium geometry](../review/feedback-2026-10-10/geometry.json) reproduces
a 1024 CSS-pixel canvas inside a 300px tile: sizing targeted `img` only.
The local CSS fix includes canvas. The local tagline fix removes both name and
photo actions, which previously always targeted `face-1`.

The same synthetic probe finds `createImageBitmap(..., imageOrientation:'none')`
still yields 1200×800 for an encoded 800×1200 EXIF-orientation-6 JPEG on this
Chromium. Header coordinates and browser coordinates can disagree. This is a
concrete crop-risk reproduction, not proof that it explains every screenshot:
the archive contains screenshots rather than original selected photos.
The crop code also assumes a 320px viewport while CSS can shrink its width, and
rotates the entire positioned image about its own center while export rotates
the selected square. Both need preview/export correspondence tests.

The local desktop and iOS harness fixes now assert rendered surface bounds
against the face tile. They strengthen qualification; a future passing run is
still required before claiming those new assertions passed on iOS.

Local verification: Docker .NET5 build passes; 293 component tests and 44 compiled
project checks pass; bridge imports, test-list coverage, progress copy and runtime
dependency checks pass. [Built-UI layout probe](../review/feedback-2026-10-10/local-ui.json)
passes at 320/360/390/1280px with no tagline actions and a correctly fitted
synthetic canvas. This static layout probe intentionally does not serve the runtime
mirror or run inference. Full updated exact-runtime CPU/iOS workflows and a new
deployment have not run for these edits. Controls, crop and retention work above
remain the next implementation scope.

## Performance evidence

[Recent anonymous diagnostics](../review/feedback-2026-10-10/diagnostics.json)
cover 46 selected objects and 28 run IDs through receipt 09:22 UTC, including six
current-build Android/Chromium/WebGPU runs. Two face jobs and two morph jobs
completed; one of each failed. Failure classification is `unknown`, with no
accepted error-stage attribution, so the current reports cannot explain them.
[Failure aggregate](../review/feedback-2026-10-10/failures.json) contains no IDs.

Current morph synthesis stage median is 742.5ms across 92 stage events; completed
job totals are 22.922s and 45.532s. Current completed face jobs take 4.728s and
32.358s; the photo-containing evidence records alignment 3.318s, encoder load
0.856s and encoding 5.722s. These are mixed observations, not same-input paired
timings, frame throughput claims, failure rates or proof of a phone regression.
Add request IDs and explicit failure-stage classifications before attribution;
never sum overlapping canary/foreground stage events into an invented total.

The [paired exact-product CPU screen](../../autoresearch/candidates/direct-rgba-media-v1/built-ui-analysis.md)
is stronger evidence for the last media change: no material face/photo/video
total benefit; restore median 483→501ms; first Save 109→202ms; repeated original
113→89ms; repeated Save 101→66ms. New-face download median 4,384,042→117,428 bytes.
WebP was a size win and first-Save latency loss. Component draw/video transport
wins did not transfer into a broad generation speed claim.

Expected next effects: layout/visibility fixes improve correctness and targeting,
not model throughput. Compressed retained images should reduce storage and reads,
but encoding/decoding may erase a latency gain. Retaining a valid completed video
can eliminate regeneration/re-encoding after reload; measure read/decode cost and
quota. Removing padded-photo work or startup contention could improve new-photo
and new-video totals, but the gain remains unmeasured.

## Pixel parity and other inherited constraints

Lossy face/video acceptance is already explicit in
[the quality ruling](../../autoresearch/reviews/2026-10-10/quality-policy.md).
The current general research guide also rejects exact decoded-pixel hashes as a
build parity gate. Nevertheless, runtime cache admission, last-result validation,
and canonical encoding still require PNG. Deferred WebP downloads can first
decode/read back that PNG. The product retained this compatibility constraint
after the quality ruling; it is not proof that lossless pixels are needed for
restoration. Keep old PNG reading, qualify a versioned compressed cache and
preserve exact W+ / generation identity without requiring lossless saved pixels.
The stored-deflate PNG optimization traded compression for encode speed and large
files; its historical keep must not be generalized to returning-visit/storage UX.

Other distinctions to preserve:

- Raw numerical synthesis/encoder checks and model hashes are legitimate
  correctness gates; do not apply them as exact lossy-export pixel gates.
- Exact hashes for repeat Save verify reuse of the prepared file, not parity
  between independent encoders or implementations.
- The native photo decoder accepts PNG/JPEG. This is a real interface constraint;
  putting WebP directly into that input needs decoder or boundary conversion work.
- Sparse frame indices, presentation ordering and queue caps preserve useful
  scrubbing, video correctness and bounded memory. Benchmark alternatives rather
  than deleting those invariants to reduce a stage timer.
- Phone encoder teardown is a memory policy with limited physical evidence;
  profile its reload cost and memory before changing it. Resumed canaries may
  contend with the next foreground request; attribute before changing admission.
- “No finished-video cache” is now superseded by the operator's bounded last-video
  retention direction. Historical logs stay append-only; current entry points
  must point to this revision.

## Route regression

The old over-three-second exploration policy tried an unmeasured alternative
after a successful slow route. Historical phone evidence records WebGPU 3.306s,
CPU 4.010s and WebGL 18.002s with no rejection. Interruption counters could also
exclude a route after reload/backgrounding without a demonstrated failure.
`3523304` corrected exploration; `e0b2192` establishes failure-only preference
and removes interruption demotion. Both precede the live `bce3204` media build.
Current tests assert WebGPU→CPU→WebGL even when reported GPU time is 18s and
WebGL is 1s. Successful slow GPU work must not trigger fallback. Actual adapter,
admission or inference failure permits it. Fresh reports show WebGPU, but sparse
diagnostics do not establish universal physical-device reliability.

## Revised measurement and acceptance contract

Navigation/selection → decoded playable and save-ready video is the principal
happy-path benchmark, in separate text/seed and metadata-free photo cohorts,
on first visit, model-cached reload and continued session. Fixed dimensions,
frame schedule/count, FPS and quality make comparisons meaningful. Also record
first responsive UI, first correctly fitted face, first useful scrub frame,
file-ready, save/share handoff, reload restoration, bytes, memory and failures.
A video total alone can hide worse first-face latency, UI jank or broken return
state. Retained-video replay is a separate cache journey, never new-video speed.

Each changed representation/control/codec needs actual built-UI assertions at
320/360/390 and desktop widths: rendered bounds, visible resting icons, stable
disabled buttons, explicit face targets, non-square/oriented crop preview/export,
two-face restore, slider preference, and playable saved video. Include relevant
checks in automatic lanes and report unavailable physical routes explicitly.
Record a coverage matrix for each artifact. Mobile component pass is not mobile
product qualification; unknown failures are an instrumentation gap, not success.
