# Compressed session persistence

Hypothesis: persist the WebP that would otherwise be prepared for Download once,
then add recovery metadata without PNG decode/readback or a second encoding.
Keep raw display, numerical synthesis and video encoding unchanged. Restore all
ordered faces, one completed video and lightweight scrub frames without inference.

Control: deployed bce3204 stores PNG originals and prepares WebP separately.
Candidate: WebP q.8 originals, compatible PNG reader/fallback, compact bounded
last-session retention. Model/latent/provenance integrity remains exact; image
pixels use the already approved practical lossy quality policy.

`encoding-screen.cjs` runs a common decoded public hello fixture through the two
encoding paths, one discarded warmup per side then ABBA×3. Set PLAYWRIGHT_MODULE
and serve the repository on loopback18735. Use the cooperative runner after
correctness and quiet-host checks. It does not measure a complete built UI,
metadata, IndexedDB, first-face paint, video, OS sharing or physical phone memory.
Source hashes and all samples are retained in
[the component report](../../../docs/review/feedback-fixes-2026-10-11/encoding-component.json).

Observed image payload/cache size: 4,195,716B PNG versus80,130B WebP for this
single fixture. Both paths prepare80,130B WebP and decode at1024. Timing is
**inconclusive**: host load exceeded19 and layout verification overlapped.
No latency win is assigned to those samples. Actual product correctness and
complete session reload are required shipping gates; paired physical-device and
whole-journey performance remain separate followups.
