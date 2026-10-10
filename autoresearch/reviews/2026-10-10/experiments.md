# Experiment queue — 10 October 2026

All entries are **proposed**, with no new timing samples, qualified candidate or
deployment. Follow [program.md](../../program.md), [record standards](../../records.md)
and the [UI handoff](next-pass.md). Freeze the qualified UI source/artifact before
paired measurement; preserve concurrent product work. Prioritize first use and
returning visits, then choose the next causal change from current evidence.

## R01 — Initial preview and cached-original restoration

Development owns `hello` and last-result restore. Research verifies navigation to
decoded visible preview/original and save availability, with zero inference/model
downloads on a valid original hit. Cover empty, retained, corrupt, evicted and
denied storage; models absent; edited inputs and delayed lookup; fresh process and
reload. Public previews and canonical originals have separate roles. Do not load
an entire full-resolution face library at startup. Measure useful-result latency
independently of model readiness.

## R02 — Ordinary-policy warm hydration

Control: the qualified UI revision with retained model bytes, a new face and normal
admission policy. Compare reload and fresh process. Attribute reads, verification,
session creation, GPU upload/shader compile, admission and first user synthesis,
then decoded display. Record bytes, worker count, route/fallback, load and memory.
Select one intervention after this breakdown. Seven webdriver canaries are a
separate qualification scenario, not the ordinary-user control. Refute a candidate
if paired useful-result latency does not improve or reliability/resources worsen.

## R03 — Direct RGBA with deferred image encoding

**Operator-added iteration goal:** avoid PNG conversion per generated frame in the
display/video path. Feed direct RGBA to display and both video writers; encode a
web image in a worker out of band for download and persistence/cache, injecting
latent recovery metadata there. Use the [operator quality ruling](quality-policy.md):
lossy face downloads are allowed, with API-like visual quality and file-size scale.
Preserve synthesis correctness, generation identity, recovery and local retention.

### Mechanism and control

The inspected source currently has a concrete round-trip:
[`ort-worker.mjs`](../../../src/Next/browser/ort-worker.mjs) encodes RGBA to PNG;
[`runtime.mjs`](../../../src/Next/browser/runtime.mjs) delivers frame blobs;
[`media.mjs`](../../../src/Next/media.mjs) decodes them and reads RGBA back for video.
The current runtime/original store also expects canonical `image/png` blobs.
Freeze exact source hashes before calling this the control; these paths are owned
by concurrent development and may change before qualification.

| Consumer | Proposed candidate path | Observable finish |
| --- | --- | --- |
| Generated face / live scrub | RGBA → canvas or transferable bitmap, with explicit pixel/color semantics | First correct visible frame; record delivery, draw and observable presentation separately |
| WebCodecs video | Raw pixels → VideoFrame → selected H.264 encoder and MP4 mux | First usable scrub frame and final decoded playable MP4 |
| FFmpeg fallback | Raw pixels → bounded rawvideo segment writer, scaled only as the existing route requires | Decoded playable MP4 with actual fallback resolution recorded |
| Download / Share | Bounded encoding worker → PNG or qualified lossy/lossless WebP → validated seed/W+ metadata → file | File ready and browser save/share handoff; record user gesture limits |
| Persistence / next visit | Worker encodes/hashes a correct original and metadata, then commits the cache/index consistently | Cache commit independently of display; next navigation → restored original |

No all-frames RGBA array: a 1024×1024×4 frame is **4 MiB**, so 32 retained raw frames
alone would be **128 MiB**, before GPU textures, encoder surfaces or copies. Establish
a byte/frame budget before running; bound the display, video and persistence queues.
For the initial desktop screen, cap **application-owned raw buffers and copies
across all threads at 16 MiB** (four full1024 frame equivalents). At the cap, pause
new synthesis/handoff until consumers release buffers; never silently drop ordered
video frames or a requested download. Superseded preview work may be cancelled by
revision. Start with at most two queued VideoFrames, two live ImageBitmaps and one
display plus one scaling canvas. Encoder/GPU internal surfaces are additional:
measure total incremental peak memory and use **+64 MiB over the matched control**
as this desktop screen's stop/review threshold, not a universal phone allowance.
If peak memory cannot be observed sufficiently, memory qualification remains
pending. Physical phones need their own measured budget/admission evidence; lower
queue limits or a documented revised budget are separate candidates.
Transfer detaches an ArrayBuffer: define ownership, ordering and any unavoidable
copy costs. Close bitmaps/VideoFrames and release raw buffers on completion,
cancellation, tab visibility changes and failure. Do not assume SharedArrayBuffer
or a second worker makes computation free.

### Staged candidates

1. **Direct delivery, same PNG persistence.** Keep existing stored-deflate PNG and
   recovery semantics in the background worker. This isolates scheduling and
   encode/decode removal from a format change. Include single face, photo
   reconstruction and morph paths; retain existing blob fallback for cached frames
   and routes without raw output.
2. **Encoding choice.** Pair the qualified direct-delivery candidate with worker
   PNG versus lossy WebP first, with the API's 1024 WebP output as practical
   visual/size reference. Lossless WebP is optional, not an acceptance requirement.
   Start with browser WebP quality around 0.8 as a candidate setting, not an asserted
   match to the deployed API encoder. Include worker/startup/encode/decode cost and
   total file bytes including metadata. Unsupported MIME fallback must be detected
   from actual returned bytes. Select the fastest acceptable delivery path with
   compatible recovery and reasonable size; changed compressed pixels alone do not
   disqualify lossy WebP. A lossy cache format needs its own format/version and
   verified source/latent identity; existing PNG-only cache checks do not support it.
3. **Video handoff.** Compare direct raw handoff for each actual writer, including
   route-required scale/color conversion and flush/mux. Persist only required
   retained image records/derivatives asynchronously under a bounded policy; keep
   useful scrubbing and next-visit restoration. Finished-video caching remains
   excluded.

Use ABBA with at least three observations per side after fixed warmup, same
device/engine/model/latents, 1024 output, frame schedule/count, codec and cache state.
Retained outputs are separate from new inference. Record synthesis, handoff/copy,
display, raw queue residence, image encode, metadata/hash, cache commit, video
scale/encode/flush/mux/decode, download readiness, peak memory and output bytes.
Background encoding may contend with inference or delay the next request; include
continued-session and next-visit journeys, not just first-frame timing.

### Correctness and workflow gates

- Run applicable full31 synthesis/numerical gates with existing tolerances; the
  raw route must preserve RGBA conversion rounding, orientation, alpha, dimensions
  and color behavior. Face downloads may be lossy: use representative normal-size
  visual comparisons to API-like WebP and report bytes/quality/settings, without
  exact pixel parity. Only a format explicitly claimed lossless must decode exactly
  to its input. The generated latent and raw synthesis correctness gates still apply.
- Preserve the current synthesis-to-RGBA numeric/color conversion and canonical PNG
  cache semantics in the first candidate. For video, compare decoded output to the
  matched existing writer using the same codec/config, frame schedule/count,
  dimensions and duration; verify order and color matrix/range. **Exact decoded
  pixel parity is not required for lossy video**, per operator direction. Use a
  practical visual spot-check of representative clips at normal playback size:
  no obvious corruption, distracting color changes or unacceptable artifacts.
  Objective quality metrics may inform the comparison without imposing a new strict
  numeric threshold. Record selected writer/fallback, settings and visual result.
  Existing latent/raw-synthesis correctness gates remain separate from lossy image
  and video compression; both exports follow the practical operator quality ruling.
- Keep stable request/revision and canonical frame indices across sparse infill,
  fallback, cancellation and input changes. Late encoder results must not restore
  or persist stale results. A failed route may resume only undelivered frames.
- Test Download/Share **immediately after display**, before background work finishes:
  await/expedite the matching file with clear progress, retain valid user-activation
  behavior, prevent duplicates and exercise errors. Faster display must still yield
  a valid downloadable file. Do not report displayed as persisted/download-ready.
- Embed numeric seed or W+ metadata for images and the morph project for MP4s,
  using the U-16 generation identity/validation rules. PNG chunks and WebP RIFF
  metadata need different container support; keep the existing PNG reader and
  reject malformed/oversized/incompatible metadata. Preserve privacy boundaries:
  no source photo or typed input in the metadata.
- Inspect actual downloaded files and re-upload with retained cache and on a cold
  second device. Valid metadata bypasses photo alignment/e4e; cold recovery still
  synthesizes. A metadata-free fixture must exercise real photo encoding.
- Test quota/denied storage, encoding failure, close/reload before cache commit,
  cancellation and eviction. Commit the last-result index only when its image and
  latent records are valid; keep an earlier valid restore if the new write fails.
  Persistence failure remains visible to diagnostics and must not invalidate the
  displayed result or prevent a deliberate download.

**Keep condition:** repeatable paired user-visible benefit, correct export/recovery,
bounded memory and acceptable download/restore latency on the scoped device.
Missing phone/Safari evidence stays a gate, not an assumed transfer. Discard or
mark inconclusive if queue/copy/worker overhead erases the benefit, resources
regress, correctness fails or the control is moving/contended. Freeze useful bytes
for development; qualify the built UI and verify deployment separately.

## R04 — Actual video encoder and FFmpeg fallback profile

The inspected browser [`video-worker.mjs`](../../../src/Next/video-worker.mjs) uses
WebCodecs H.264 with `latencyMode: 'quality'` when selected, plus an in-house MP4
muxer. That route has no FFmpeg pass. The fallback uses eight-frame rawvideo
segments, libx264 `ultrafast`, CRF 20, baseline, yuv420p, one thread; final concat
uses `-c copy -movflags +faststart`, with **no second encode**.

First instrument actual selected route/init, raw handoff/scaling, FS writes,
segment startup/encode, flush/concat/mux and playback decode. R03's direct RGBA
handoff removes work before either writer. Further candidates are segment-size or
encoder-lifetime changes, WebCodecs queue/config changes, and threading **only** if
the pinned FFmpeg core supports it and isolation/memory limits permit it. Extra
passes add work; `ultrafast` already limits x264 effort. The operator accepts
practical lossy video quality: test lower-latency WebCodecs settings and bitrate/CRF
changes with visual spot-checks; record any quality/size tradeoff alongside speed.
Resolution/FPS/frame-schedule changes are a separate workload, with explicit operator
intent and comparison, rather than a matched speedup. Preserve bounded buffering,
presentation order, compatibility and MP4 metadata.
Server API FFmpeg observations are a different implementation and workload.

## R05 — First and next photo on the current build

Measure raw-photo upload/crop/alignment/e4e/reconstruction/display/save with retained
models, then a different photo. Separate model-byte acquisition from retained-byte
verification and inference; tag encoder and synthesis providers independently.
Compare metadata re-upload and exact cache hit as different workloads. The operator
reports a few seconds today; a matched recent baseline is still missing. Choose
the next photo intervention from these timings, not the historical acquisition
table. Keep source photographs tab-only.
