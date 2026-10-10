# Operator quality ruling — 10 October 2026

**Face downloads do not have to be lossless. Video does not require exact pixel
parity.** The current round may trade compression quality for lower delay and
smaller files, aiming for approximately the visual quality and file-size order of
magnitude delivered by the classic API. This supersedes the lossless-download
assumption in the initial R03 proposal; the append-only log retains that history.

“OOM close to the API” is interpreted here as **order of magnitude of delivered
file size**, with comparable visual quality. It is not a new out-of-memory limit.
Keep the separate raw-buffer/peak-memory experiment budgets in [R03](experiments.md).

## Practical reference

The measured API `hello` is a **1024×1024 lossy WebP, 92,624 bytes** (about 90 KiB),
available as the verified [public preview](../../../src/public/preview/hello-1024.webp)
with [provenance](../../../hosting/gallery/hello-provenance.md) and [HTTP observations](api-hello.json).
That single image is a size/visual reference, not a universal ceiling for every
face. Compare representative identical-source candidate encodes and record
distributions; aim for roughly **10⁵ bytes rather than multi-megabyte images**
where practical, accounting for required recovery metadata separately and in total.

The retained API source calls Pillow `save(..., 'WEBP')` without explicit quality
or lossless parameters (the preserved [compatibility implementation](../../../self-host/legacy_checkface.py)
does likewise). The deployed Pillow version/defaults are not freshly verified;
do not claim browser quality 0.8 produces identical API bytes or pixels. WebP quality 0.8 was selected and deployed after component timing, recovery and
actual Chrome download/re-upload checks. PNG remains the compatible cache format
and fallback. The isolated component screen measured the tradeoff: WebP file-ready was slower
than PNG, while its total file was much smaller. The candidate uses WebP out of
band for downloads, retains PNG cache compatibility and keeps the existing video
quality settings after realtime failed to improve latency. Deployment is qualified and verified; paired built-UI performance transfer remains
a separate decision; see the [candidate evidence](../../candidates/direct-rgba-media-v1/ci-analysis.md).

## Acceptance

- Face image: correct dimensions, identity and orientation, normal-size visual
  spot-checks without obvious corruption or distracting artifacts/color changes.
  No exact decoded-pixel parity is required for lossy exports. Quality metrics are
  diagnostic rather than a new strict numerical pass threshold.
- Video: correct schedule/order/duration and reliable playback, with practical
  visual acceptance. Record bitrate/CRF/latency settings and speed/size tradeoffs;
  changes to resolution/FPS/frame schedule are different workloads.
- Recovery: seed/W+ values, generation identity and morph project must remain
  valid and integrity-checked. Lossy pixels must **not** become the source of a new
  inferred latent when valid metadata exists. Retained-cache and cold-device
  re-upload must recover before photo alignment/e4e.
- Synthesis: existing latent/raw numerical correctness gates still apply. Image
  compression acceptance does not authorize changing model precision or synthesis.
- Persistence: a candidate lossy cache format needs explicit format/version,
  metadata and integrity validation plus compatible restoration. Existing
  canonical-PNG-only code remains the frozen control until a migration is tested.
  Old gallery/API pixels alone do not establish missing W+ or canonical generation
  identity.

Report **image payload bytes, metadata bytes and total bytes**. A W+ float32 tensor
contains 18×512×4 = **36,864 raw bytes**, while legacy v1 JSON numeric
arrays can be larger. The delivered v2 representation stores exact little-endian
float32 in base64, with about 50 KB of validated metadata in the qualified face.
The legacy reader remains compatible; recovery is not dropped to reduce size.
Seed-only compact metadata also needs a verified reproduction identity. The
chosen output format must support metadata writing/reading, and save/share must
still work when clicked before background encoding finishes.
