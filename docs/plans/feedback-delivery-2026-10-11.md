# Screenshot feedback delivery — 11 October 2026

Status: deployed and verified at https://next.facemorph.me on 11 October 2026 (Brisbane).
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
video and complete display-size scrub frames. A single 32 MiB record replaces the
previous session. Video needs measured quota headroom plus 8 MiB reserve; failed
video writes retry faces/frames without video. Source photos/words/transient jobs
are not serialized. Slider preference/position are independent local settings.
Edits invalidate stale video/project retention. Restore validates pinned model,
noise, generation identity, image/latent/video/frame hashes and project controls,
then restores without inference. Legacy one-face references remain compatible.

Validation: component tests include EXIF byte normalization, rotation/pan/pivot,
WebP canonical caching, ordered compressed session integrity, slider preference,
quota/video retry, superseded writes, and corrupt retained video/frame fallback.
Browser components now decode and crop synthetic portraits at all 8 EXIF
orientations; desktop Chromium passes. Built controls pass 320/360/390/1280 widths,
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

## Delivery receipt

- Deployed source: `001ba853b277775a060030a3ab23a3900af28f16`.
- [Successful artifact, CPU qualification, compiled UI and deployment run](https://github.com/check-face/facemorph.me/actions/runs/38066762339).
- Diagnostic build: `next-04403766fff8630a`; Cloudflare version:
  `1349887c-5d1c-4740-b708-4b25dd0069d0`.
- [Live byte verification](../review/feedback-fixes-2026-10-11/live-assets.json)
  matches application HTML, UI/worker/style/catalogue/hello assets and the pinned
  runtime manifest. CI also confirmed all 300 published runtime files respond.
- [Exact-artifact CPU report](../review/feedback-fixes-2026-10-11/qualified-cpu.json)
  passes photo alignment, crop, repeat downloads, playable 1024px MP4 and full
  two-face compressed/video/slider reload. Selected frame 2 persists; restore
  makes zero worker requests. Switching the restored second face to words clears
  its label and leaves Generate disabled.
- [Compiled UI](../review/feedback-fixes-2026-10-11/qualified-controls.json) and
  [live controls](../review/feedback-fixes-2026-10-11/live-controls.json) pass narrow
  widths, resting icons, disabled Generate and rendered canvas bounds.
- [Final-source mobile run](https://github.com/check-face/facemorph.me/actions/runs/38067059174)
  passes Android/iOS components (including all eight EXIF crop cases) and iOS
  product CPU generation. The rendered face fits its tile. Reports:
  [Android](../review/feedback-fixes-2026-10-11/android-components.json),
  [iOS components](../review/feedback-fixes-2026-10-11/ios-components.json),
  [iOS product](../review/feedback-fixes-2026-10-11/ios-product.json).
  This independent mobile artifact has the same source/content-build identity;
  randomized Markdown email entities and minifier bindings make it a separate
  build, not the exact promoted bytes. See
  [build identity](../review/feedback-fixes-2026-10-11/mobile-build-identity.json).
  Full photo/video/restore qualification is desktop CPU; phone components and
  single-face iOS product checks do not establish the complete phone journey.
- [Issue 13](https://github.com/check-face/facemorph.me/issues/13) closed at
  16:20:28 UTC on 10 October after verified deployment and slider reload.

Three earlier attempts were blocked by the qualification gate. The initial mode
check targeted a hidden mounted menu; subsequent asynchronous retention probes
cleared their result between reads. The third probe confirmed both retained faces
and video, with ample measured quota. The corrected gate preserves all product
assertions. The phone test server initially omitted the new crop source from its
allowlist; both emulator/simulator component lanes subsequently passed. See
[failed attempt evidence](../review/feedback-fixes-2026-10-11/qualification-attempts.json).

Physical-phone memory/codec/performance evidence remains separate. The independent
GPU benchmark could not obtain a WebGPU adapter on its runner and supplies no GPU
performance qualification. No whole-journey latency improvement is claimed.
