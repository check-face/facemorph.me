# Screenshot feedback delivery — 11 October 2026

Status: implemented locally; candidate CI promotion pending.
Supersedes the pending implementation status in the
[feedback/process correction](feedback-process-2026-10-10.md).

Implemented: all five shapes as a dropdown under More options with length/pinch;
outlined Advanced below; visible resting source selectors; grey disabled Generate
retained at field height; restored/photo mode changes clear labels/filenames;
ambiguous tagline actions removed; canvas display fits the tile.

Crop fixes preserve legacy-ignore-exif by removing EXIF from browser-only JPEG
copies, avoiding browser/header dimension disagreement. Quarter-turn panning uses
inverse screen rotation; preview rotation pivots on the selected square, matching
export; viewport geometry uses actual responsive square width. Original files and
native preprocessing/model policy remain unchanged.

New raw faces retain WebP q.8 once in the background, reusing its pixels/file for
Download metadata preparation. Existing PNG cache/restoration remains readable;
WebP encode failure falls back to PNG. Legacy session PNGs are compressed out of
band, without inferring a new latent. No synthesis/precision/FPS/video-quality
changes. Session v2 stores ordered face results and settings, an integrity-checked
video and complete display-size scrub frames. A single32MiB record replaces the
previous session. Video needs measured quota headroom plus8MiB reserve; failed
video writes retry faces/frames without video. Source photos/words/transient jobs
are not serialized. Slider preference/position are independent local settings.
Edits invalidate stale video/project retention. Restore validates pinned model,
noise, generation identity, image/latent/video/frame hashes and project controls,
then restores without inference. Legacy one-face references remain compatible.

Validation: component tests include EXIF byte normalization, rotation/pan/pivot,
WebP canonical caching, ordered compressed session integrity, slider preference,
quota/video retry, superseded writes, and corrupt retained video/frame fallback.
Browser components now decode and crop synthetic portraits at all8 EXIF
orientations; desktop Chromium passes. Built controls pass320/360/390/1280 widths,
resting-icon visibility, disabled Generate, equal field/button height and Advanced
placement. CPU qualification now requires a two-face/video/scrub reload with no
worker requests and restored-mode clearing. iOS product harness checks rendered
face bounds; mobile component lanes run the portrait/EXIF test automatically.

Performance: the common-fixture encoding screen demonstrates smaller retained
images and eliminates one encode/readback path. Its timings are inconclusive due
to host contention. No whole-journey or physical-phone speedup is claimed. Video
replay and scrub restoration avoid new generation when the bounded session was
successfully retained. See the
[component screen](../../autoresearch/candidates/compressed-session-v1/README.md)
and [local evidence](../review/feedback-fixes-2026-10-11/).

Promotion receipt, live asset verification and issue13 closure will be recorded
below after CI qualification. Physical-phone memory/codec/performance evidence
remains separate from emulator/simulator checks.
