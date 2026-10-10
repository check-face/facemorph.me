# Direct RGBA and deferred image encoding — current round candidate

Status: **paired codec screen complete; direct display/video transport retained,
realtime video settings discarded; product integration qualification in progress**. This belongs to the [10 October round](../../reviews/2026-10-10/README.md),
separate from historical iteration 3. Follow its [quality ruling](../../reviews/2026-10-10/quality-policy.md).

## Hypothesis and staged comparisons

The current image pipeline encodes generated pixels as PNG before delivery; video
then decodes PNG back to RGBA. Display and video can consume raw pixels while a
bounded worker prepares a downloadable/persistable image and recovery metadata.
First isolate direct delivery with unchanged PNG output, then compare PNG against
lossy WebP and profile video configuration. No finished-video cache is proposed.

| Screen | Control / candidate | Gate and scope |
| --- | --- | --- |
| Raw synthesis transport | Frozen `b322a26` runtime/worker PNG output / same source with transferable RGBA and per-frame consumer acknowledgment | Single plus 31 synthetic latent samples agree in raw RGBA; seven original canaries per runtime; **not fixed full31 or compiled UI qualification** |
| Image delivery | Worker PNG → image decode/draw / raw draw with worker PNG out of band | Actual browser display/draw/file-ready measured separately; numerical reference decoding is excluded from timing |
| Encoding | Background stored-deflate PNG / browser WebP quality 0.8 | Lossy visual acceptance; dimensions, seed/W+, image/latent integrity, metadata size and actual browser decode |
| Video | Current PNG round-trip / direct raw handoff; quality / realtime with bounded encoder queue | Same 1024, 32 frames, 16 FPS, H.264 bitrate; decoded dimensions/duration and visual acceptance; actual selected encoder reported |

`control.json` pins the frozen PNG/video source. `prepare-source.py` creates immutable
source snapshots in ignored `state/`, records all hashes in [source-snapshot.json](source-snapshot.json)
and emits reviewable runtime/worker patches. It uses `git archive`, **no worktree**.
The prototype raw API is deliberately transient (`persist:false`); product cache,
last-result and download integration still need a qualified UI control.

## Recorded correctness, not a speed win

[Nine integrity/buffer tests](correctness.test.mjs) passed through the cooperative
runner on 10 October. They cover encoded-image/latent tampering, compact recovery,
privacy, invalid dimensions/identity, detached transfer, pre-allocation capacity,
cancellation, timeout and disposal. The browser [codec correctness report](correctness-browser.json)
verifies decorated PNG/WebP decode and recovery plus full1024 two-second H.264
playback. It used the public `hello` fixture; the attempted archived seed fixtures
were 512px and were rejected, so they establish no additional 1024 coverage.

For that single fixture, PNG plus metadata is **4,245,531 bytes**, while WebP plus
compact metadata is **129,932 bytes** (80,130 image + 49,802 metadata). This is a
measured size difference for a decoded/recompressed public fixture, not current
generation speed or a universal quality/size result. Normal-size visual inspection
found no obvious corruption; the metadata-bearing WebP remains browser-decodable.

The [raw transport report](correctness-raw.json) shows exact RGBA agreement for a
single output and 31 synthetic latent samples; peak reserved background-encoding
raw buffers were **4 MiB** in that run (client cap 8 MiB). This accounts only for
client-owned queue buffers, not GPU/encoder surfaces or whole-process peak memory.
The source code uses existing kernels and RGBA rounding. Transferred buffers are
detached and the inference worker waits for consumption credit, preventing an
unbounded window of raw frames.

Local host load was contended during correctness. Timing values in those reports
are **not qualified performance samples**. Benchmark attempts refused above load 4.
The bounded experimental CI screen collects alternating ABBA ×3 comparisons on its
own Linux/browser CPU environment; it cannot establish an eris GPU or phone gain.
Image samples include new-worker startup, so this screen measures first-use delivery
and file readiness rather than persistent-worker throughput. Video samples include
per-clip startup, matching the current product writer lifetime.
Its push trigger will be retired after the experiment, retaining its reports.

## Paired codec result

The isolated [CI analysis](ci-analysis.md) has six observations per side and question.
Direct draw+RAF:65.31→5.02ms; raw-video codec path:1,316.24→186.07ms.
WebP file-ready is slower:55.36→113.17ms, but its size fits the API scale.
Realtime video settings did not help:153.36→158.22ms, so they are discarded.
These are component results; compiled product and current-user latency are separate.
The automatic CI push trigger has been retired.

## Integration constraints and next gates

Current sparse infill produces out-of-order frames, persists them, then encodes
ordered video. Holding 32 raw1024 frames would take 128 MiB. A direct-video variant
must preserve indexed sparse availability while using a few preview anchors followed
by ordered streaming, or decompress already persisted out-of-order frames when
their presentation index is due. Blocking sparse production on a missing earlier
video frame can deadlock; no all-frame raw array is acceptable.

The staged product candidate must integrate canvas display, worker encoding,
Download/Share while encoding, format-aware recovery, cache/index transactions,
revision/cancellation and sparse scrub. Keep existing PNG/v1 recovery compatibility.
Compact v2 uses exact float32 little-endian W+ in base64; WebP stores an ignorable
`FMRP` RIFF chunk, PNG uses the existing FaceMorph text namespace. These readers
validate encoded image and latent hashes, dimensions and generation identity;
the runtime must additionally match the currently admitted generation identity.

Before `keep`, collect paired uncontended useful-result/file-ready/restore timings,
resource peaks, applicable existing numerical checks and actual built UI
save/re-upload/cancellation/quota/eviction workflows. Verify the promoted artifact
separately. Current Product/media paths are stable per development; bridge/runtime
diagnostics and final live control freeze remain coordinated in agent mail.

## Reproduce

```sh
python3 autoresearch/run.py --lane browser-cpu --device eris --timeout 60 -- \
  node --test autoresearch/candidates/direct-rgba-media-v1/correctness.test.mjs
python3 autoresearch/candidates/direct-rgba-media-v1/prepare-source.py
python3 autoresearch/run.py --lane browser-gpu --device eris --timeout 480 -- \
  node autoresearch/candidates/direct-rgba-media-v1/run-raw-screen.mjs correctness /absolute/report.json
python3 autoresearch/run.py --lane browser-cpu --device eris --timeout 360 -- \
  node autoresearch/candidates/direct-rgba-media-v1/run-screen.mjs benchmark /absolute/report.json
```

For the raw benchmark, matching correctness evidence is required. Source snapshots
are immutable; do not rerun preparation over them. The scripts use an isolated
profile and loopback server, never the operator's normal browser. Component screens
use synthetic/public fixtures and send no diagnostics or private photos.

## Exact built-UI transfer experiment

The bounded [built-UI recipe](built-ui-paired.mjs) compares qualified control
`e0b2192` with corrected integration `bce3204` (supersedes `e590de2` after the cloneable-download fix), using exact artifact receipts and
one pinned runtime. Hypothesis: removing foreground PNG improves full-resolution
face display and playable video; the smaller deferred WebP improves download size
without moving encoding into the display critical path. CPU synthesis may dominate
the total and erase a component benefit; that observation refutes a general E2E
speed claim even when direct transport remains useful.

Linux hosted Chrome, CPU explicitly selected, pinned Playwright 1.55, fixed warmup
per side then ABBA×3 (six observations each). Reopen each side's isolated retained
profile for every sample. Record navigation to preview/restored1024 image, first
new face after reload, next new face, first/repeat completed download, repeated
original, 32-frame/16 FPS decoded playable video, first/next metadata-free synthetic
photo and its download. Matching cases use the same new inputs and decoded public
hello pixels; ignored RIFF nonces prevent original-cache shortcuts. Photo assets
are acquired in the discarded warmup. This is a synthetic same-photo pipeline
screen, not varied real-photo or physical-phone performance.

The host seam explicitly emulates ordinary-user canary admission while webdriver
remains true; record it rather than present the run as real-user analytics.
Visibility/isolation/artifact identity, dimensions/duration, repeat file identity,
route/stage events and browser errors are gates. Existing product CI retains the
numerical, privacy and workflow gates. Raw synthesis kernels are unchanged; fixed31
is not a new numerical-kernel claim. Worker surfaces/total process memory remain
unmeasured; the implemented copy budget is not a measured process peak.

Stop on a wrong artifact, contention above load4, invalid output, browser error,
or the1200s command/25min job limit. Keep partial evidence as inconclusive. Retain
the raw report in Git; retire the automatic experimental trigger after completion.
