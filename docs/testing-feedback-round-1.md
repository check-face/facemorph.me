# Testing round 1 — bench parity is the constraint

> Implementing this? Start with the [work order](round-1-work-order.md): reading list,
> per-item acceptance gates and the condition for claiming done.

Raised **16 September 2026** after the operator used the deployed candidate
(`next.facemorph.me`, bundle `app.364167e48daf4f9ae92b.js`, source `23c1646`) on a
physical phone.

## The constraint

**The best case we measure on the bench must be the case the product actually runs.
Today it is not, and the gap is not small.**

Everything else in this document is subordinate to that. The UX items in Part 3 are real
and should be done, but they are not the constraint, and shipping them without closing the
gap would just make a slow product tidier.

The bench's own metrics ([`autoresearch/program.md`](../../autoresearch/program.md),
"Objective and fixed evaluation") are single-face latency, 26-frame ordinary morph
throughput, full video export time, cold load and memory, tracked per lane — browser CPU,
browser GPU, native CPU, native GPU. Those are the right metrics. The product does not
report them, is not compared against them, and currently cannot reach them.

### Acceptance criterion

For a given device, route and model bundle:

| Metric | Requirement |
|---|---|
| Warm single-face latency | ≤ **1.15 ×** the bench row for that device and route |
| 26-frame morph, per frame | ≤ **1.15 ×** the bench row |
| First face, warm cache, fresh session | ≤ **2 ×** single-face latency, plus a named startup budget |
| First face, cold cache | download time + the warm number, with download reported *separately* and never counted as "generating" |
| Route selected | must be a route with a bench row for this device class. If there is no such row, the product says so rather than silently running an unmeasured path |
| Kernel shipped | must be the candidate that produced the bench row, verified by hash |

**Any per-face or per-session cost that is not inference must appear in the ledger below
with an owner and a budget. Unnamed overhead is a bug, not a tax.**

---

## Part 1 — Why the bench number is not reachable today

### The numbers we already have

From `autoresearch/results.tsv` and `review-artifacts/device-lab-runs/12723cce-…json`,
measured on **the operator's own S24 Ultra**, same 1024px FP32 ordinary synthesis:

| Route on that phone | Bench ms/face |
|---|---|
| WebGPU, `mobile-boundary-bounded` — **status `keep`** | **686** |
| CPU, 4 threads | 2,582 |
| CPU, 1 thread | 5,911 |

So the benched best case on that device is **0.686 s per face**. Hold that number.

### C-01 — The shipped bundle does not contain the kept winner

This is the finding that matters most, and it is verified, not inferred.

`mobile-boundary-bounded` is the candidate that produced the 686 ms figure. Its README:
"Candidate bounded uses nonnegative coordinates, clamps every tile read to a valid address,
and masks padding to zero." Its `results.tsv` status is **`keep`**, with the note "Explicit
bounded padding eliminates observed phone edge error". Its kernel is
`experiment/device-lab/fused-resample-boundary-v2.js`, which uses `clamp(qy,1u,1026u)` and
contains **zero** `continue` statements.

What is actually deployed is `src/Next/browser/fused-resample-v1.mjs`, whose comment reads
"Product extraction of ordinary gpu-worker-v9 / mod-fusion. No kernel changes." It uses
signed coordinates and skips out-of-range taps:

```wgsl
let sy=i32(y)+i32(fy)-1; if(sy<0||sy>=1026){continue;}
```

That is the **control**, the exact control flow the kept candidate replaced. I diffed the
runtime asset the deployed manifest points at (`1a22ae6c…`) against the source file: byte
identical. So the product ships the pre-fix kernel.

The 686 ms number has never been in the product. Comparing the product against it is
comparing against code we did not ship.

*Do:* promote `mobile-boundary-bounded` into the product bundle, re-run all 31 cases
against it, and record the runtime digest so the promotion receipt proves which kernel
shipped. Then re-measure. Until this is done, every other performance conclusion on the
GPU route is measuring the wrong artifact.

*Also do:* make this structurally impossible to repeat. `promote.py` already refuses to
publish without a runtime digest match — extend the same idea one step back, so a bundle
cannot be built from a kernel that has no `keep` row in `results.tsv`, or so that
mismatches are at least named in the promotion receipt. The gap is not a missing gate on
deployment; it is that research winners and product bundles were never bound to each other.

### C-02 — The unfixed kernel plausibly costs the GPU route entirely

Follow the consequence through the shipped code.

The bounded fix exists because the unfixed kernel produced an **observed phone edge
error**. The product's admission gate is 7 canaries at RGB max ≤ 1 and sampled float
≤ 0.002 (`src/Next/browser/ort-worker.mjs:47`) — a border error is exactly what that
rejects. On failure, `admit()` adds the route to `failedRoutes`, tears down, and falls
back: WebGPU → WebGL → CPU (`src/Next/browser/runtime.mjs`).

So the likely lived sequence on the operator's phone is: pay for canaries on the GPU route,
fail, throw that work away, then pay for canaries again on CPU, then generate at CPU speed.
Nothing in the UI says any of this happened — the status line says "Checking this device…"
throughout, and the route that was finally used is never displayed.

This is a hypothesis about that specific session, not a measurement, and C-08 is how we
confirm it. But it is the hypothesis the code most supports, and it is consistent with
"so much slower than our bench".

### C-03 — Eight inferences before the first face

`qualify()` loops **every** canary in the manifest. The deployed manifest has **7**. Each
is a complete 1024×1024 synthesis, plus a 1.5 MB reference PNG through
`DecompressionStream`, plus a compare across ~3.1 M channel values.

`admit()` runs it whenever `validated` is false, and `validated` is per runtime instance —
so it runs on the first generation of **every page load**, plus again after any route
change or error.

The arithmetic on the operator's phone:

| | inference before first face |
|---|---|
| Bench single-face | 0.686 s |
| Product, GPU route, if it qualifies | 8 × 0.686 = **5.5 s** |
| Product, after GPU fails → CPU-1 | 7 × 0.686 wasted + 8 × 5.911 = **~52 s** |

Against a 0.686 s bench number that is **8×** at best and **~75×** at worst, from
correctness checking alone, before a single byte of download or hashing.

The checks themselves are not the problem — they are why we can trust the output. Paying
for all seven, on the critical path, once per page load, is.

*Do:*
- Persist the qualification result keyed by `(manifestSha256, route, canary set)`. A device
  that passed 7/7 yesterday on an unchanged bundle has not become numerically different
  overnight. Qualify **once per device per bundle**, not once per session.
- On a genuinely cold device, gate admission on **one** canary, generate the user's face,
  and finish the other six in the background. If a later canary fails, invalidate that face
  loudly and drop the route.
- Keep all 7 mandatory and non-skippable in CI and in release qualification. This changes
  *when* the user pays, not whether the bundle is proven.

### C-04 — The CPU fallback is pinned to one thread

`ort.env.wasm.numThreads=1`, unconditionally (`ort-worker.mjs:13`, again for the encoder at
`:22`, again in `webgpu-engine.mjs`). It came out of the iPhone shared-WASM work
(`inference_learnings.md`, 15 September).

On the operator's S24, the bench measured both: CPU-4 at 2,582 ms, CPU-1 at 5,911 ms. The
product ships the 5,911 ms configuration. **On that exact device, the product's fallback is
2.3× slower than a CPU path we have already measured on the same phone.** That is not a
hypothesis; both numbers are in the same run file.

*Do:* make thread count a per-route, per-platform manifest value with a measured default of
`min(4, hardwareConcurrency)`, pinned to 1 only on the profiles that needed it. Check
whether the Cloudflare static config sends COOP/COEP first — threads need
`SharedArrayBuffer` — and if it does not, that header change is the prerequisite and should
be sized as such.

### C-05 — Cached models are SHA-256'd twice in JS on every load

`ensure()` re-verifies a cache **hit** by streaming the whole blob through the JS `Sha256`
(`Assets/model-cache.mjs:103`), then `open()` verifies it **again** on consumption
(`:185`, "Verify on consumption as well").

Per generation: 2 × 124 MB synthesis + 2 × 8.4 MB mapping + the noise set. Per photo, add
2 × ~100 MB landmarks and the streamed encoder's ~108 assets. That is a few hundred
megabytes of JS hashing to open files that are already local and were verified when
written — and it is on the critical path, every session.

*Do:* drop the `ensure()` re-verification on a hit (`open()` already verifies before use —
a free 2× cut); record a `verifiedAt` marker and re-verify once per bundle version rather
than once per open; and use native `crypto.subtle.digest` wherever the consumer takes the
bytes as one `ArrayBuffer` anyway. Keep the streaming JS implementation for the download
path, where incremental verification is the whole point.

### C-06 — Morph frames round-trip through PNG, then get thrown away

Three separate problems, and the operator asked directly about the middle one.

**The round trip.** Per frame today: synthesise → `rgba1024()` → `encodeRgbaPng` (deflate
4 MB) → Blob → `digest()` of that Blob for a cache key → `framePixels()` decodes the PNG
back → draws it into a 512 canvas → `getImageData` → posts RGBA to ffmpeg.

The video encoder wants RGBA. It gets there by compressing an image and decompressing it
again, per frame, and hashing it in between — for frames that pass `persist:false` and are
never stored. Pure overhead against the bench's 26-frame throughput metric.

**The 512 itself.** To answer the question: the *size* is classic parity, not arbitrary.
`Config.fs:34` sets `videoDim = 512`, and classic's slider ran at that same 512 with 25
frames. So there is a reason, but it is a **server-era** reason: classic rendered the video
on the server for a roughly 300px display, and 512 was the sensible thing to send down the
wire. Neither half of that constraint still applies — we synthesise at 1024 locally and
send nothing.

So the operator is right that this is unnecessary handling of data, with one caveat worth
measuring rather than assuming: ffmpeg.wasm encode cost scales with pixels, so 1024 is 4×
the encode work and 4× the frame memory. That is a real budget question on a phone, not a
reason to keep a round trip.

*Do:*
- Hand the writer raw RGBA straight from the worker. No PNG encode, no digest, no decode.
  Skip the originals-store lookup entirely when `persist === false`.
- If a resize is still wanted, do it **once, from the raw buffer** — one `drawImage` into a
  512 canvas, or `createImageBitmap(imageData,{resizeWidth:512,resizeHeight:512,
  resizeQuality:'high'})` — never via an encode/decode pair.
- Measure 1024 vs 512 encode time and peak memory on a phone and on a desktop, and choose
  per device — but do C-11 first, because a hardware encoder may make the question moot. Offer 1024 where it is affordable; keep 512 as the fallback. The output is
  now ours to choose, which it was not in the classic architecture.
- Keep the PNG path for faces that *are* cached, where the canonical-bytes contract in
  `inference_learnings.md` applies.

**Throwing the frames away.** `persist:false` means every intermediate frame is discarded
the moment ffmpeg has it. That is what forecloses the slider (U-14), and it is why a user
who wants to pick a blend point has to regenerate.

*Do:* retain the frames, and **persist them**. Decided rather than left open, because the
choice has consequences the slider and session restore both depend on:

- **Where.** A dedicated morph-frame store in IndexedDB, keyed by the morph's identity —
  geometry version, kind, width, pinch, frames and fps, plus the ordered latent hashes of
  its controls. **Not** the originals store: that is keyed by a single face's latent
  identity and is a different thing. The gate "no originals-store lookup for `persist:false`
  frames" still holds; frames get their own store.
- **What.** Two representations. The canonical 1024 PNG, which is what gets exported or
  saved, and a display-size derivative (the slider's width), which is what scrubbing
  decodes. Classic's `SliderMorph` preloads every frame as an `<img>`; at 1024 that is
  roughly 4 MB decoded per frame, so scrubbing a 26-frame morph would hold ~104 MB of
  bitmaps on the device least able to afford it. Scrub the derivative, keep the original.
- **Why persist at all.** Three things fall out of it for free: the slider scrubs with no
  regeneration; a reload or a tab eviction restores the morph instead of regenerating it,
  which is the same problem U-05 solves for faces and the operator has already been bitten
  by on a phone; and repeating a morph with unchanged settings becomes a cache hit exactly
  as a repeated face is.
- **Budget and failure.** Roughly 1.4 MB per 1024 PNG, so ~36 MB for 26 frames and ~90 MB
  for 64. Cap the store, evict least-recently-used whole morphs, and make the whole thing
  **best effort**. This must not inherit the model cache's behaviour of treating exhausted
  storage as fatal — a device that cannot persist frames keeps them in memory for the
  session, scrubs fine, and loses them on reload. It never fails a generation.

This is the one place a PNG encode per frame *is* justified, and it should be the only one.

### C-07 — The phone encoder's shape runs on every machine

`encodeStream` exists because a 1.07 GB e4e session will not fit a phone. It creates **108
sequential ORT sessions** — its own progress event says so (`ort-worker.mjs:26`, "Sum of108
sequential ORT session creations"). The worker selects it unconditionally on the mere
presence of `manifest.encoderStream` (`:54`), so the whole-model path underneath is dead
code, and a 32 GB desktop pays 108 session creations to dodge a limit it does not have.

On top: `browser/runtime.mjs:35` terminates and restarts the inference worker **twice**
around the encode, so the synthesis model is torn down and re-created (and, per C-05,
re-hashed) inside one photo job. And the first photo of a session runs
`qualifyEncoderReference` — a complete reference encode — before the user's own.

C-03, C-04 and C-07 are all phone-motivated decisions currently applied to everyone. That
is the operator's "keep iPhone specific workarounds separate if they have negative perf on
other arch's, keep if positive", and the answer in each case is a measured per-device
selection rather than a constant.

*Do:* choose the encoder path from a measured device budget, cache the encoder
qualification per bundle as in C-03, and keep sequential worker residency only on profiles
that need it.

### C-08 — Nothing measures any of this, on the device or in CI

There is no physical-phone report for this candidate. The candidate plan's own open gaps
say "No physical phone has been exercised". The diagnostics collector has never
round-tripped a consented report, so we do not even know a profile would arrive. And the
product never reports the bench's metrics in the bench's vocabulary, so the two numbers
have never been placed side by side.

This is why the constraint keeps slipping: nothing fails when it does.

*Do, in this order:*

1. **One honest phone profile.** Opted-in, foreground, screen on, one generation on the
   operator's actual device. Record: device, browser, **route actually selected**, whether
   any route was rejected and why, cold vs. warm, and per-stage `elapsedMs` for
   `asset-acquisition`, `model-loading`, `canary`, `synthesis`, `encoding`, `export`.
   Confirm the record lands and is readable.
2. **A parity harness.** Run the same fixed latent through the bench and through the
   shipped bundle, on the same device, same route, and emit one table: bench ms, product
   ms, and the per-stage decomposition of the difference. Every row of the difference must
   be attributable to a named ledger entry.
3. **A CI gate.** Extend `next-e2e.yml` to assert the acceptance criterion above on the
   engines CI can run. Non-inference overhead over budget fails the build, the same way a
   correctness regression does. This is consistent with the 16 September decision that
   CI tests the deliverable artifacts, and it is what stops C-01 recurring.
4. **Surface the route in the product.** The provider is already in the provenance
   (`route`, `provider` in `cachedGenerate`) and is never shown. Display the route in use
   and say when a route was rejected. A user should not need it; a tester cannot work
   without it, and neither can we.

### C-09 — The instrument itself is broken, and it blocks C-08

The operator deliberately ran a successful generation with the debug checkbox selected, to
produce the report the plan says is missing. It did not produce a usable one.

I cannot say from here which failure they hit without reading the collector's KV for that
window — that is a five-minute check and it should be the first thing done. But the client
has several verified defects, and at least one of them exactly matches "make debugging stay
on once turned on, even in the middle of a run":

**Turning it on mid-run reports nothing for that run.** `diagnostics.enable(true)` calls
`on()`, and `on()` begins with `off()` — which sets `run=null` and aborts every in-flight
POST (`reporting.mjs`). `run` is only ever set by `start()`, which is called once at
`execute()` entry behind `if(!enabled())return`. So enabling consent at second 30 of a
60-second job leaves `run` null for the rest of it, and every `stage()` and `finish()` call
returns early on `!run`. The user sees "Reporting is on." and never sees a reference,
because none was created. Toggling it on during a run also aborts any sends already in
flight from that run.

**Consent may not survive a reload.** `remember()` wraps `localStorage` in a bare `catch{}`.
Where storage is unavailable or partitioned the write silently does nothing, `restore()`
finds no consent on the next load, and the checkbox renders unchecked. "Stays on until you
turn it off" is the stated contract; this is how it quietly does not.

**A new session id on every enable.** `on()` regenerates `session`, so a mid-run toggle
splits one job across two sessions in KV.

**The status line lies by overwriting.** `DebugStatus` is a single string and every POST
fires its own `notice()`. A run sends start + N stages + finish; the message the user ends
up looking at is whichever POST landed last. One failed POST out of twenty shows "Report
could not be saved"; one late success hides nineteen failures. The reference shown can also
be from the *previous* run, since `notice` falls back to the current `run` value.

**The reference is unholdable.** It exists only as transient status text, overwritten by
the next event and lost on any state change. The friends-and-family checklist asks testers
to "send the report reference". The UI makes that close to impossible to do.

**The terminal event dies with the tab.** `finish()` uses a plain `fetch` with no
`keepalive` and no `sendBeacon`. A phone that backgrounds, or a user who navigates away
after a long job, loses the one event that says the run completed — on the device we most
need it from.

**Stage boundaries get rate-limited away.** `stage()` drops any event without an explicit
`elapsedMs` if less than a second has passed since the last one, and `last` is shared across
all stages. Bursty transitions are exactly the boundaries the parity ledger needs.

**The bundle hash is never on the start event.** `diagnostics.bundle()` is called inside
`engine()`, which runs after `diagnostics.start()` has already posted. The first event of
every run is missing the field that identifies which bundle produced it.

*Do:*
- Make consent, not job lifecycle, own the run. If consent is enabled while a job is
  running, open a run for it immediately and report from that point, flagged as
  `partial`. Never discard an active run to turn reporting on.
- Separate `off()` into "withdraw consent" (abort, clear, forget) and "start a session"
  (idempotent, preserves an active run). `enable(true)` while already consented should be a
  no-op, not a reset.
- Buffer events **while consented** and flush on `visibilitychange` and on
  `finish`, with `keepalive`/`sendBeacon` for the terminal event. This does not weaken
  the "no pre-consent backlog" rule — nothing is buffered before consent, and the buffer is
  dropped the instant consent is withdrawn.
- Report one aggregate outcome per run, not one per POST: "Report saved — reference
  `<uuid>` (18 of 18 events)". Make the reference **selectable and copyable**, and keep it
  visible until the next run starts.
- Surface a failure honestly and once, with what to do about it.
- Set the bundle hash before the first event.
- Verify the collector's live binding. `worker.mjs:28` returns **503** if
  `FREE_PLAN_CONFIRMED!=='true'` or the `DIAGNOSTICS` KV binding is absent. `wrangler.toml`
  sets both, but its README records that the standalone zone route was rejected on
  permissions and the handler is now imported into `next-static/worker.mjs` instead — so
  confirm the vars and binding exist *on that combined worker*, not only in the standalone
  config.

Note on the existing evidence: `docs/review/next-delivery/diagnostics-public-proof.json`
records `publicPostStatus: 204` with the record stored and expiring. That proves the
**collector** works when POSTed to directly. It does not exercise the product's own path,
which is what the plan's open gap is actually about and what failed here.

**C-08.1 cannot be executed until this is fixed.** Asking the operator for another phone
profile through an instrument with these defects would waste their time and produce another
unreadable result.

### C-10 — "Working…" then "Downloading model files…" is real, and the status line is wrong

Yes, that is actually what is happening, and no, we should not be doing it. Two separate
bugs produced that sequence.

**The label map has holes.** `progress()` renders
`event.text || labels[stage] || 'Working…'` (`product-bridge.mjs`). The map has 16 entries.
Fourteen emitted stages are missing from it, and after discounting the three that carry
their own text (`face`, `morph`, `export`), these all render as the bare word "Working…":

`gpu-prefix-loading`, `gpu-suffix-loading`, `model-loaded`, `synthesis-complete`,
`encoding-complete`, `encoder-loaded`, `alignment-complete`, `original-cache-invalid`,
`fallback-cpu`.

Note what most of those are: **completion events.** The UI says "Working…" at precisely the
moments a phase has just finished. And the exact sequence the operator saw is the WebGPU
load path, verbatim:

```
progress('gpu-prefix-loading')   → "Working…"
await bytes(config.prefix)       → 'asset-acquisition' → "Downloading model files…"
progress('gpu-suffix-loading')   → "Working…"
await bytes(config.suffix)       → 'asset-acquisition' → "Downloading model files…"
report('model-loaded')           → "Working…"
```

Two of those entries deserve more than a label:

- **`fallback-cpu` renders as "Working…".** That is the event where the product gives up on
  the GPU route and silently drops to the path benched at 5,911 ms/face on the operator's
  phone (C-02, C-04). The single most consequential thing that can happen during a run is
  currently communicated as a generic present participle.
- **`original-cache-invalid`** means a cached original failed its checksum and is being
  regenerated. The user is paying for a full synthesis they should not have needed.

**There is no real download progress at all.** `bytes()` reports `{loaded:0,total:size}`
then `{loaded:size,total:size}` — so `fraction` is 0, then 1, per asset, with nothing
between. The model cache *does* emit granular status (`missing`, `downloading`, `saved`,
`quota-exceeded`), but `ort-worker.mjs` calls `createBrowserModelCache()` with no options,
and `report` defaults to `()=>{}`, so every one of those events is discarded. The video
worker passes a `report` callback; the inference worker does not.

The result on a 158 MB asset: the bar sits at zero for a very long time, then jumps to full,
then resets for the next asset — while the text alternates between "Working…" and
"Downloading model files…". That is the operator's observation, and it is a fair summary of
the implementation.

*Do:*
- Give every emitted stage a label, and make completion events either silent or explicitly
  past tense. A stage with no label should fail a test, not fall back to "Working…".
- Wire `report` through `createBrowserModelCache()` in the inference worker and drive a real
  byte-level download indicator from it — bytes of total across the whole acquisition set,
  not per asset.
- Say when a route was rejected and which route is now in use (C-08.4). "Working…" is the
  wrong word for "your GPU failed its correctness check and you are now on the slow path".
- Separate **downloading** from **generating** in the UI entirely. They are different things
  with different remedies, and U-01 moves most of the downloading off this path anyway.

### C-11 — The video encode is software x264, single-threaded, and its cost is invisible

The operator's suspicion is well founded. `video-worker.mjs`:

```
'-c:v','libx264','-preset','ultrafast','-crf','20',
'-profile:v','baseline','-pix_fmt','yuv420p','-threads','1'
```

So: **software x264, one thread, compiled to WASM.** `ultrafast` is the right preset and
`-threads 1` is the constraint. On top of that, frames are flushed in 8-frame segments, each
through its own `core.exec()` with a `core.reset()` after it — a 26-frame morph is four x264
invocations plus a concat pass, each paying WASM process startup. And the codec itself is a
32 MB `ffmpeg-core.wasm` download before any of it starts.

`width` and `height` are hardcoded to `512` in the worker, independently of the `512` default
in `framePixels()` — so the resolution lives in two places and is derived from nothing.

**The cost is invisible, which is why this is a suspicion rather than a number.**
`writer.add(blob)` is awaited *inside* the per-frame synthesis loop, and the status text for
that whole loop is the `morph` stage's "Generating frame N of M". So synthesis, the PNG
encode, the PNG decode, the downscale, the transfer and x264 are all attributed to
"generating". The product cannot currently tell us how slow the encode is. C-08's parity
harness must break the morph frame into sub-stages; this is a ledger row like any other.

**Also: encode is serialised with synthesis.** Because `add()` is awaited in the loop, the
GPU sits idle during every encode and the encoder sits idle during every synthesis.
Pipelining — encode frame N while synthesising N+1 — is cheap and could hide most of the
encode cost even with x264 unchanged.

**On the faster path the operator asks about: yes, browsers offer one.** WebCodecs
`VideoEncoder` gives access to the platform's hardware H.264 encoder. Availability covers
essentially our whole target matrix — Chrome/Edge 94+ on desktop and Android, Safari 16.4+
on iOS and macOS, Firefox 130+. It takes a `VideoFrame` built directly from `ImageData`, an
`ImageBitmap` or a canvas, so it pairs exactly with C-06: no PNG round trip, no MEMFS copy.
It emits encoded chunks rather than a container, so it needs a small MP4 muxer — a modest
dependency, or hand-rolled for a single H.264 track.

What that buys, in order of value: a hardware encoder on the device that is actually slow;
1024 output becoming affordable rather than ambitious; and the 32 MB ffmpeg.wasm download
removed for supported browsers, which also removes the `cdn.jsdelivr.net` dependency flagged
in U-01.

Honest caveats. `VideoEncoder.isConfigSupported()` must be probed, not assumed — hardware
H.264 at 1024×1024 is near-universal but is a claim requiring evidence. ffmpeg.wasm stays as
the fallback for browsers without `VideoEncoder` or without H.264, but becomes a fallback
download rather than a mandatory one. And the plan already records that Playwright's
Chromium and WebKit ship without proprietary codecs, so H.264 playback is not checkable in
automation; the same limitation applies to WebCodecs H.264 *encode*, so this route needs
real-browser evidence exactly as the current one does. That is not a reason to avoid it, but
it should not arrive as a surprise at qualification.

**On defaulting to a lower resolution:** it is the lever of last resort, not the first.
Order the work as: (1) remove the PNG round trip, which is free; (2) move to WebCodecs where
available, which is where the phone win is; (3) *then* measure, and only lower resolution if
the encode is still significant. Doing it in the other order would degrade output on every
device to work around a bottleneck we have not measured and may be about to delete. If it is
still significant after (1) and (2), a per-device default chosen from measurement is correct
— and by then we will have C-08 to choose it with.

### The ledger

Every non-inference cost on the critical path, what it should cost, and where it belongs.
Budgets are proposals to be set against real numbers from C-08.

| Cost | Paid now | Should be paid | Item |
|---|---|---|---|
| Wrong kernel shipped | every face, forever | never | C-01 |
| Failed route + retry on fallback | per session, invisible | once per device per bundle, visible | C-02 |
| 7 canaries | per page load, critical path | once per device per bundle; 1 on the path | C-03 |
| 1-thread WASM | every CPU face | only where measured to be better | C-04 |
| Double model hashing | per session | once per bundle version | C-05 |
| PNG encode/hash/decode per frame | every morph frame | never for non-persisted frames | C-06 |
| 108 encoder sessions | every photo, every device | only on memory-bounded devices | C-07 |
| Encoder reference encode | first photo per session | once per device per bundle | C-07 |
| Model download (~1.5 GB) | at first Generate, 2 connections | StyleGAN from page load, background, resumable | U-01 |
| Morph frames retained | never — discarded after encode | persisted per morph identity; slider and reload need no regeneration | C-06 / U-14 |
| A usable diagnostic report | not produced by a consented run | every consented run, with a copyable reference | C-09 |
| Video encode | software x264, 1 thread, serialised with synthesis | hardware WebCodecs where available, pipelined | C-11 |
| ffmpeg-core (32 MB) | downloaded by everyone | fallback only | C-11 |
| Honest status text | 9 stages render as "Working…"; no byte-level progress | every stage labelled; real download progress | C-10 |
| Provenance on exported media | none | provenance chunks on export; canonical bytes unchanged | U-16 |
| Published gallery (8,966 images) | published, entirely unreferenced by the product | three-tier lookup; first load lands with faces | U-18 |
| Triton census and archive upload | never finished; oldSeeds never scanned | completed census, classified, sized, published | U-19 |

---

## Status check — 17 September

Re-verified against the working tree and the live site, not against the commit messages.
Four items are genuinely done. The two largest are not, and one of them is the operator's
own complaint.

### Done, and verified

- **C-04 — threads.** `cpuThreads()` now returns `min(4, hardwareConcurrency−1)` when
  `SharedArrayBuffer` and `crossOriginIsolated` are both available, with a matching
  `encoderThreads()`. And it actually activates: `next.facemorph.me` returns
  `cross-origin-embedder-policy: require-corp` and `cross-origin-opener-policy: same-origin`,
  so the prerequisite I flagged as needing a check was already satisfied. The diagnosis in
  the commit is better than the one in this document: the shipped runtime was already the
  *threaded* build, so `numThreads=1` was pinning a multi-threaded binary to one thread.
  **Partial:** `webgpu-engine.mjs:8` and `webgl-vector-v1.mjs:266` still hardcode
  `numThreads=1`. The WebGPU one is defensible (JSEP does its compute on the GPU); the
  WebGL one runs the CPU prefix stage, which is real inference work.
- **C-08.4 — route visibility.** `route-admitted` is emitted, and on all three branches:
  successful qualification, the WebGL retry, and the CPU fallback.
- **U-12 — estimates.** Implemented from measurement rather than device class: a median over
  the last eight measured face times, with cached faces excluded because a cache hit is not a
  measurement of work. The slow-device guidance now keys off that measurement instead of the
  route's name, which correctly catches a qualified GPU route that is slow anyway.
- **The collector, end to end.** A real browser with no DNS override opted in, generated, and
  its reports were accepted (204). The namespace holds 200 records across 12 runs, every one
  with an expiry measuring 29.52–30.00 days, containing only the allowlisted fields; an
  unauthenticated POST and a foreign origin are still refused with 403. That closes the
  plan's "never round-tripped" gap. It also came with a correction worth keeping: an earlier
  probe had used `--host-resolver-rules` pointing `next.facemorph.me` at a local
  qualification server, so "the deployed site" was a `SimpleHTTP/0.6` instance refusing every
  POST — a convincing false failure, and a collector change made against it was reverted.

### Not done — still verified broken

- **C-01 — the kernel.** `src/Next/browser/fused-resample-v1.mjs` still contains the
  `continue`. The `keep`-status `mobile-boundary-bounded` candidate that produced 686 ms/face
  on the operator's S24 is still not in the bundle. This is the largest item in the document
  and it is untouched.
- **C-09 — consent mid-run.** `on()` still begins with `off()`, `run` is still only ever set
  by `start()`, and there is still no `keepalive` or `sendBeacon`. **Verifying the collector
  is not the same as fixing the client.** The collector evidence proves reports arrive when
  consent is already on before a run; the operator's report is about turning it on during
  one, and that path still produces nothing. The reference is also still unholdable — with
  200 records now in KV it is worth checking whether the operator's run is actually in there
  and they simply had no way to capture the reference.
- **C-03** — `qualify()` still runs all seven canaries per session.
- **C-05** — still hashed on `ensure()` and again on `open()`.
- **C-06** — `framePixels(blob)` unchanged; frames still discarded.
- **C-10** — `route-admitted` is special-cased inside `progress()`, but the `labels` map is
  otherwise unchanged, so `fallback-cpu`, `model-loaded`, `synthesis-complete`,
  `encoding-complete`, `encoder-loaded`, `alignment-complete` and `original-cache-invalid`
  still render as "Working…". `createBrowserModelCache()` in `ort-worker.mjs` still passes no
  `report`, so there is still no byte-level download progress.
- **C-11** — still `libx264 -threads 1`; `VideoEncoder` appears nowhere in the tree.
- **C-07, U-01 through U-11, U-13 through U-15** — unchanged. `Inputs.Length>2` is still
  there, `commit()` still lands every face at once, nothing prefetches on load.

**Net:** the fast, well-scoped items landed and landed well. The two that need doing next are
the kernel promotion and the mid-run consent path, and neither has been started.

## Part 2 — The two direct questions

### "Isn't share image and save image the same now?"

Different code paths, frequently the same outcome. `shareFile` falls back to `saveFile`
whenever the Web Share API cannot take a file (`src/Next/media.mjs:10`). On Firefox desktop
the two buttons are literally the same call; on the operator's phone they differ (share
sheet vs. a download iOS handles badly).

**Do (U-06):** one capability-labelled action per result — `Share` when
`canShare({files})` is true at render time, `Save` when it is not. Not two buttons per
face, times up to 64 faces.

### "What is the project thing? Why would I export and open?"

It is JSON of the W+ latents, morph settings and model/noise checksums — no images, no
photos (`ProjectJson.fs`, `product-bridge.mjs:exportProject`). Reopening re-synthesises
each face from its latent, which is a cache hit if the originals store still has it.

Three real reasons it exists:

1. **There is no server any more.** Classic put the whole state in the URL and the server
   regenerated from it. There is no link to send yourself now.
2. **A photo-derived face is expensive and unrepeatable.** e4e is the costliest operation
   in the product; the latent is the cheap, permanent, photo-free result of it.
3. **Reloading the tab loses everything.** Faces live in a module-level `Map`
   (`product-bridge.mjs:8`); there is no session restore. Export is currently the *only*
   way to survive a refresh or a tab eviction.

Reason 3 is a missing feature wearing a feature's clothes, and it is why the button feels
arbitrary — it is in the primary action row competing with Save and Share, but the thing it
actually protects you from is something the product should just not do to you.

**Do (U-05):** persist the canonical project JSON on every completed job and rehydrate on
load (faces return from the originals cache — hits, no inference). Then rename it to "Save
a copy you can edit later", move it out of the primary row, and explain reasons 1 and 2 in
the FAQ — moving a photo-derived face between your phone and your laptop without the photo
ever moving is a genuinely good answer, and nothing currently says it.

---

## Part 3 — Everything else raised

Real, worth doing, not the constraint. Sequenced after Part 1 unless noted.

| ID | Item | Current behaviour |
|---|---|---|
| **U-01** | **Start the StyleGAN download at page load.** Route-independent assets first — `mapping` (8.4 MB) and the 17 noise tensors — unconditionally, immediately; they are small and every name/seed face needs them. Then the synthesis weights. There is a real ordering question here worth naming: *which* synthesis artifact depends on the route, and the route is not known until an adapter is probed. `navigator.gpu.requestAdapter()` is cheap and can run at load. Recommendation: fetch the **CPU `synthesis` (124 MB) first regardless**, because it is the universal fallback and the route can still be rejected by the canary gate after the GPU bytes have landed (C-02) — then the route-specific bytes (`webgpu.prefix` 158 MB + runtime wasm 21.9 MB). About 282 MB for a GPU device, against the ~1 GB the product already demands. **e4e:** the operator leans earlier and that is right, but 1.07 GB plus `landmarks` (99.7 MB) on cellular for someone who only types names is not defensible — start both the moment a photo tile exists (a tile switched to photo mode, or a file picked), not on page load. That is still far earlier than today. Also: raise `maxConcurrent` above 2 and measure; make acquisition resume across tab switches (chunks already commit individually — the resume logic is the gap); call `navigator.storage.persist()` once from the UI. Flag separately: **ffmpeg core (32 MB) is fetched from `cdn.jsdelivr.net`**, the only product asset not independently hosted. Its sha256 is pinned and verified so integrity holds, but availability does not, and the plan requires independently hosted runtimes | `engine()` is first called inside `execute()`, i.e. on the first button press — nothing downloads before that; ~1.5 GB at 2 connections; `storageStatus({requestPersistence:true})` exists in `Assets/ModelAssets.fs` and is exercised only by tests, so Safari's 7-day eviction can silently un-cache a device |
| **U-02** | Per-face progress; render each face the moment it lands | `inputs()` (`product-bridge.mjs:28`) generates every face into a local `Map` and `commit()`s only after the loop (`:40`) — no face appears until all faces are done; one global `<progress>` (`Product.fs:276`) whose fraction only steps between faces |
| **U-03** | Per-face Generate; start alignment + e4e immediately on upload | Two global buttons (`Product.fs:272-274`); changing one input regenerates everything |
| **U-04** | **Everything already made on this device comes back instantly — see the requirement below** | The originals cache is checked before admission and before any model load, so hits are already cheap. But nothing looks until Generate is pressed, there is no morph-level cache at all, and `navigator.storage.persist()` is never called, so Safari can evict the lot after seven days. Default state is `hello`/seed `389` (`Product.fs:112`), so a returning user has a hit sitting there and still sees a grey `+`. Classic showed the face as you typed (`MorphForm.fs:16`) |
| **U-05** | Session restore; demote Export/Open project | See Part 2 |
| **U-06** | One save action | See Part 2 |
| **U-07** | Allow a single face | `init()` starts with two; `Remove` is gated on `Inputs.Length>2` (`Product.fs:169`, button at `:255`) |
| **U-08** | Auto-align; crop only on failure | Backwards today. `selectPhoto` (`photo-selection.mjs:29`) admits directly only at ≤ 4 MP **and** a container the JS header parser knows — so every 12 MP or HEIC phone photo opens the manual cropper before anything is attempted, though finding and cropping the face is the landmark model's entire job. `previewPhoto` already produces a bounded re-encode; it is currently used only to feed the cropper. And alignment failure is a dead end — `didAlign!==true` throws "Choose a clear photo containing exactly one face" with no offer to crop, which is exactly when cropping would help. Multiple faces is a hard error rather than a pick-one |
| **U-09** | Replace the Advanced panel | A `<details>` containing a bare "Width" range, "Pinch centre", "16/32/64 frames / segment" and a Processing-mode select (`Product.fs:266-270`). The first three are internal latent-path parameter names; the fourth asks a user to pick an inference backend. Proposal: Length and Shape controls with real diagrams, geometry numbers behind a developer flag, and Processing mode moved to the diagnostics area as "Force a processing mode (for testing)" — it must stay reachable and keyboard-operable because CI selects CPU through it. Pairs with C-08's route display |
| **U-10** | Match classic FaceMorph styling — **full design plan in [candidate visual alignment](candidate-visual-alignment.md)**, with screenshots and measurements | The candidate wraps itself in `App.ThemedApp` and then uses almost none of it: hand-rolled `.button`/`.box`/`.input` classes, a `<details>`, raw `<progress>`, two bespoke `position:fixed` dialogs with their own focus traps, ~55 lines of custom CSS (`style.scss:253-308`), `#ce621d` hardcoded in three places. Classic is MUI throughout: outlined `SetpointInput` per face with mode-change and browse/upload adornments, one large contained **Morph** button, MUI dialogs, theme tokens (`MorphForm.fs`, `App.fs:277-380`). Rebuild the face tile on `SetpointInput`; keep the tile grid, crop surface and per-tile progress, which classic never had |
| **U-11** | Wake lock, checkpointing, an honest background story | A `sessionStorage` marker (`checkface-runtime-active-v1`) detects an interrupted run and refuses a silent same-route retry — that is why it recovered. It is recovery, not continuity. `navigator.wakeLock` (Safari 16.4+) is used nowhere in the repo and is the cheap win: held during a job it keeps the page foregrounded and avoids most throttling. Installing to the home screen does **not** meaningfully reduce iOS suspension — offer it for storage durability (U-01) and say that is the reason. Background Fetch is Chromium-only and cannot run inference. **Genuine background inference in a browser does not exist on iOS; do not imply otherwise.** The honest version is wake lock + per-face and per-frame checkpointing + Part 1 |
| **U-12** | Measured estimates and warnings | No estimate anywhere; the only guard is `totalFrames>4096`, which rejects rather than warns. After the first completed synthesis, store measured ms/frame for this device and route and show "about N minutes"; above a threshold, or on mobile with a multi-face morph, warn **dismissibly** with "Start anyway" as the default. Never block — "but still allow" is the constraint. The desktop link must be labelled honestly: that build is currently unsigned, packaging-only, with inference and GPU reported as not tested, and must not be offered as a GPU remedy until the native matrix is qualified. This depends on C-08, because an estimate from an unmeasured device is a guess |
| **U-13** | Rewrite the FAQ | The Help panel (`Product.fs:289-374`) carries the classic FAQ near-verbatim from `explain.md`. That framing works — short question in the user's words, direct answer, admits when nobody knows — and should stay. What it does not answer is everything that changed: why the first one is slow (say the real size), where photos go (they never left — that is the whole point), why it works offline, what a shared link does and does not carry now (U-15 restores it for text and seed faces; photo faces genuinely cannot travel in a URL, and that boundary should be stated rather than discovered), what the project file is for, why a phone is slower than a laptop, and that classic facemorph.me is unchanged. Revisit after C-08 — several answers depend on numbers we do not have |
| **U-14** | **Bring back the slider.** Classic `SliderMorph.fs` is a canvas plus `Mui.slider`: 25 frames preloaded as `<img>`, scrubbing draws the selected frame. `MorphForm.fs` exposed it as a "Use Slider" checkbox beside the video. The candidate has no equivalent. Depends on C-06 retaining frames — once it does, the slider regenerates nothing, which is exactly the classic behaviour (classic pulled frames from `/api/morphframe/`; we already have them locally, and at 1024 rather than 512). This also restores a documented feature the candidate silently dropped: `explain.md` tells users "After uploading photos of the faces to merge, click Morph and then tick Use Slider to pick how much of the two faces contribute to the combined face." Face *merging* is currently unreachable in the new UI | gone |
| **U-15** | **Restore the rest of the classic features** — see the table below | various |

### U-15 — what the candidate dropped

| Classic | Where | Candidate | Note |
|---|---|---|---|
| URL state, deep links, back/forward, bookmarks | `App.fs` `parseUrl` / `formatPathForVidValues` | gone | **Restorable in full for text and seed faces.** There is no server, but this never needed one: the same text always gives the same face, so `?from_value=alice&to_value=bob` regenerates on-device. Bookmarks, the back button, and sending someone a link all come back. Photo faces cannot go in a URL — they are latents — and that is the honest boundary. This is a much better answer to "you can no longer send someone a link" than the FAQ entry in U-13 |
| Share sheet: copy link, Facebook / WhatsApp / Twitter / Reddit, `navigator.share` of the page | `Share.fs` | file share only | depends on URL state above |
| Use Slider / face merging | `SliderMorph.fs` | gone | U-14 |
| Mode menu with icons (Text Value / Numeric Seed / Upload Image) | `MorphForm.fs` `getInputConfig` | plain `<select>` | U-10 |
| Browse faces by seed (1–100 grid) | `BrowseFacesDialog.fs` | names only | cheap to restore beside Browse names |
| Video poster set to the from-face still, plus the `morph-dummyImg` hack to stop layout flicker | `MorphForm.fs` `renderMorph` | black box, layout shift | we already hold that still in memory |
| Default right-hand value is today's date | `App.fs` `defaultToValue` | seed `389` | a different default morph every day; cheap and characterful |
| Responsive `<picture>`, webp + srcset at 300 / 512 / 1024 | `MorphForm.fs` `renderImageByValue` | one 1024 PNG blob | matters on phones: the tile is ~230–320 CSS px (`style.scss:257`) and we put a 1024×1024 PNG in it — about 4 MB decoded per tile. Generate a display-size derivative once |
| oEmbed and og/twitter meta for link previews | `Server/`, `index.html` | n/a | depends on URL state |

The operator's "it's unclear to me why we've lost so many of the original UI features" is
fair, and the honest answer is that the candidate was built as a new inference product with
a FaceMorph-shaped UI bolted on, rather than as the existing UI with its backend replaced.
Most of the losses above were not decisions; they are things that were never carried over.
U-10 and U-15 together are that carry-over, and they are cheaper done as one pass than two.

### U-04 — arriving at the same latents unlocks everything already made

Operator requirement, 17 September: cache on the device, persistent across reloads, and if
someone arrives at the same latents again they should get back everything already generated
from them — **instantly**.

Most of the machinery exists and is unused. `originals.mjs` already supports alias records,
and `cachedGenerate` already writes a `latent` alias for both `seed` and `photo` kinds, so a
face is addressable by its latent regardless of which route produced it. What is missing is
the morph level, the persistence request, and showing any of it without a button press.

**What must hit, and why:**

| Arriving via | Result |
|---|---|
| Same name or seed | Face returns, no inference |
| **The same photo again**, including a cropped or re-saved copy | Returns the face **without re-running e4e** — the single most expensive thing the product does. Keyed on the aligned tensor, not the source bytes; see the U-04 amendment below |
| A reopened project whose latents came from a photo | Hits through the latent alias |
| The same set of faces with the same morph settings | The **morph** returns too — frames and video — via the morph-frame store in C-06. This is the part that does not exist today |
| Page reload | All of the above survives it |

**The honest boundaries**, so nobody promises more than this does:

- A *different* photo of the same person encodes to a different latent. Miss. That is
  correct, not a bug.
- A **cropped** version of a photo already encoded is different bytes, so it misses and
  re-runs e4e. Worth improving later by keying the encoder step on the hash of the *aligned
  tensor* rather than the source bytes — then crop-then-align of the same face hits — but
  that requires alignment to run first, so it is an optimisation to measure, not a
  requirement here.

**Also required:** call `navigator.storage.persist()` once, from the UI, at the point the
user first generates (U-01). Without it the whole thing is a seven-day cache on Safari, and
"persistent across reloads" is not true.

**Gates:**

- With a warm cache, `hello` renders on load having created **zero** inference workers.
- Re-uploading a previously encoded photo emits no `alignment` and no `encoding` stage.
- Re-requesting a previously generated morph emits **zero** `synthesis` events and produces
  a playable video.
- All three still hold after a page reload.
- Under a constrained quota none of this becomes fatal — it degrades to a miss and generates
  normally (C-06p).

### U-16 — generated media carries provenance metadata

Operator requirement, 17 September: you should be able to tell instantly that an image is a
FaceMorph face.

There are two readers, and they want different things. A **person or a platform** wants
"this was generated, by what, when" in a place their tooling already looks. **Our own app**
wants to recognise its own output when it comes back — which turns an exported PNG into a
lightweight project file: drop it in, read the generation identity, hit the cache, get the
face back instantly with no latent embedded anywhere (U-04, U-05).

**What goes in.** Provenance, not inputs:

- A clear human-readable line: generated with FaceMorph, and the site URL.
- Bundle version, model and noise hashes, geometry version for a morph.
- The `generationSha256` identity already computed in `cachedGenerate` — enough to find the
  face in the local cache, useless for reconstructing it elsewhere.
- `IPTC DigitalSourceType = trainedAlgorithmicMedia`, which is the standard vocabulary for
  "synthetic" and the thing external tooling actually reads.

**The latent goes in.** Operator decision, 17 September. This reverses the cautious default
I had written here, and it is the right call, but it changes a written rule so it is recorded
rather than quietly applied.

*What it buys.* The exported image becomes a **complete, portable project**. Drop it back in
on any device and you get the face, the ability to morph from it, and a cache hit — with no
original photo, no re-encoding, and no separate `.json` to keep alongside it. It also
restores, for photo-derived faces, the thing I had written off as permanently lost: classic's
"send someone this face" worked through a URL and a server, and photo faces cannot travel in
a URL because a latent is 36 KB. They travel in the file instead. U-15's honest boundary
should be updated to say so.

*Why there is no privacy question here, so nobody reopens it.* The image **is** the face.
Anyone determined enough can run the shared image back through an encoder and recover a
latent from the pixels — that is what e4e does. Embedding it adds convenience and speed, not
exposure. Operator, 17 September: no opt-out, no warning, nothing to acknowledge.

*What that requires:*

- **Update the contract text so the docs stop contradicting the code.**
  `next-runtime-contract.md` says ordinary share and save "must not silently attach private
  inputs, latents or project metadata". Rewrite that line in the same change to permit the
  latent and keep the prohibition on the source photo and typed value. This is
  documentation consistency, not a privacy control.
- **Worth a line in the FAQ as a feature, not a warning** (U-13): images you save can be
  reopened and morphed, on any device, without the original photo.
- **On by default for ordinary share and save. No opt-out.** The point is the *recipient*: they open the
  image you sent them, and it is fast, because only synthesis has to run. No alignment, no
  e4e. Leaving it out is the opt-**out**, not the opt-in.
- **Follow the consequence into the download plan.** A person who only ever opens images
  other people shared never needs the **1.07 GB encoder or the 100 MB landmarks model at
  all** — a latent goes straight to synthesis. U-01 should treat "opened a shared image" as a
  distinct, much cheaper entry path, and must not start the encoder download for it.
- **Still never the source photo, and never the typed value by default.** The photo is the
  one input the user did not choose to publish, and the typed word can be a person's name.
- **Export only.** The canonical stored original stays clean — see the collisions below.

*Which latent, and how big.* The operator asked whether a smaller one would do. Per face
kind:

- **Seed faces:** embed the **seed**, not a latent. Four bytes regenerate it exactly, and a
  seed is not sensitive. Cheapest possible and fully faithful.
- **Text faces:** embed W+. The text would be smaller still, but that is the one input we
  are not putting in the file.
- **Photo faces:** W+ is the floor. e4e emits W+ `[1,18,512]` directly and collapsing 18
  layers into a single 512 vector produces a *different, worse* face — the per-layer detail
  is what makes the reconstruction resemble the person. There is no smaller faithful form.

So W+ float32 is 36,864 bytes, about 49 KB base64, roughly 3.5% of a 1.4 MB PNG, in a
compressed `iTXt` chunk (PNG supports that natively). Keep float32; truncating to float16
saves a few KB and breaks reproducibility. For an MP4 morph, embed the project JSON rather
than N separate latents.

On "the q latent": `next-runtime-contract.md` states that the legacy `q`/`d` names "have no
inferred mapping in this contract". Do not guess one. The product's only accepted space is
W+ `[1,18,512]`, enforced by `requireLatent`; if a legacy mapping is ever wanted it is a
separate, evidenced piece of work.

*Also delete the stale code comment.* `src/Next/media.mjs:1` reads "Media sharing never
uploads private inputs or embeds project latents." It contradicts this decision and must go
with the change.

**Two collisions with existing contracts, both real:****Two collisions with existing contracts, both real:**

1. **Canonical bytes.** `cachedGenerate` stores `imageSha256` over the PNG and re-verifies it
   on every cache hit, and `inference_learnings.md` requires the stored original to be the
   validated raw inference bytes. Adding chunks changes those bytes.
2. **Determinism.** The e2e qualification already checks a **byte-identical repeat**. Any
   non-deterministic field — a timestamp, the route, the provider — would break that gate
   outright if it went into the stored image.

**Resolution: the canonical original stays exactly as it is, and metadata is applied to the
export.** `saveFile` / `shareFile` re-wrap the canonical PNG with the chunks at the moment
the user asks for a file. The cache keeps clean, byte-stable, reproducible bytes; the thing
that leaves the device carries its provenance. This satisfies both contracts instead of
trading one away.

**Mechanically** this is small. `png.mjs` already has a generic `pngChunk(type,data)` and we
own `encodeRgbaPng`, so a `tEXt`/`iTXt` chunk before `IDAT` is a few lines. For MP4, the
current ffmpeg concat step can take `-metadata`; if C-11 moves to WebCodecs, the muxer has to
write a `udta`/`meta` atom instead — worth knowing before choosing a muxer.

**C2PA / Content Credentials** is the real standard for this and is worth naming as the
destination rather than pretending XMP is the whole answer. It is not a drop-in here: a C2PA
manifest must be signed, and a static site cannot ship a signing key in the browser bundle
without giving it away. So: IPTC/XMP plus PNG text chunks now, C2PA recorded as later work
with that key-management problem stated rather than discovered.

**Durability.** Platforms strip metadata, which the runtime contract already acknowledges as
the reason Export project exists separately. Metadata is a convenience and an identification
aid; it is never the only path to anything and must never be described as a guarantee.

**Gates:**

- A saved PNG contains the provenance chunk and an `IPTC DigitalSourceType` of
  `trainedAlgorithmicMedia`; a saved MP4 carries the equivalent.
- The saved PNG contains the latent and round-trips: re-importing it reproduces a
  byte-identical face with **zero** inference.
- The saved PNG contains **no source image and no typed value**. Assert by scanning the file
  for the input string and for JPEG/HEIC signatures.
- A shared image opened on a **second device with a cold cache** produces its face with
  **zero** `alignment` and **zero** `encoding` stages, and never requests the encoder or
  landmarks assets.
- A metadata-stripped copy still imports as an ordinary photo, with no error implying the
  file is damaged.
- The **stored canonical original is byte-identical to today's**, and the existing
  byte-identical-repeat check still passes.
- Dropping a previously exported PNG back into the app restores that face from cache with
  **zero** inference.
- A PNG whose metadata has been stripped still imports as an ordinary photo, with no error
  that implies the file is damaged.

**Still off by default:** the typed value. The latent already makes the image fully
re-derivable, so embedding the word adds nothing except the chance that someone learns what
you typed. Leave it out.

### U-17 — the cropper pans badly on a phone, and decodes far more than it shows

Operator, 17 September: panning inside the cropper is bad on the phone, was not like this on
the original, and is worse on bigger images. Classic used `react-advanced-cropper` — still
imported in `style.scss` — and the candidate hand-rolled `photo/crop-view.mjs`. This is a
regression from that swap, and there are four separate causes.

**1. Panning animates layout properties.** `Product.fs` renders the preview with
`style.left` / `style.top` from `frame()`, and only `rotation` goes through `transform`.
Every pointer move therefore invalidates layout and repaints the image. At max zoom on a
4096px preview the `<img>` is laid out at roughly 3400×2560 CSS px inside a 320px box, so
each pointer event repaints a multi-megapixel bitmap. That is exactly "worse on bigger
images".

*Fix:* `transform: translate3d(x, y, 0) rotate(…)`. `frame()` already returns `x` and `y` —
they just go somewhere else. Compositor-only, no layout, no repaint.

**2. Width and height change every frame too.** They only depend on zoom, but they are
re-applied on every pan, re-rasterising the image. Give the element a stable intrinsic size
and express zoom as `scale()` in the same transform, so both pan and zoom stay on the
compositor.

**3. One Elmish dispatch per pointer move.** Every `pointermove` runs the full update/render
cycle. Coalesce to one dispatch per animation frame — `getCoalescedEvents()` where available
— rather than per event.

**4. The preview is decoded at up to 4096px for a 320px viewport.** This is the memory
problem. `PREVIEW_MAX_EDGE` is 4096, so a 4096×3072 preview is **50 MB of decoded bitmap**,
and `previewPhoto` additionally re-encodes it as a full-size **PNG**, so the device
simultaneously holds the source decode, the re-encoded PNG blob and that blob's decode.

Crop quality does not depend on any of this: `cropPhoto` re-decodes from the **original
file**. The preview is display-only, so it should be sized from the crop viewport and device
pixel ratio rather than from a constant, and encoded as JPEG rather than PNG — or kept as an
`ImageBitmap` drawn into a canvas, skipping the blob round-trip entirely. Relationship to
size it against, rather than a number to guess: at `MAX_ZOOM` the visible square is
`side/zoom`, so 1:1 at the 320px viewport needs a short edge of `320 × MAX_ZOOM`. Pick from
that and from DPR, and measure.

**5. And the decode is done twice, at full size first.** `decodeBounded` calls
`createImageBitmap(file)` with no options — a **full-resolution decode of the original** —
and only then downscales with a second `createImageBitmap(probe,{resizeWidth,…})`. A 12 MP
phone photo materialises ~48 MB before it is reduced; a 48 MP one is nearer 190 MB, which is
plausibly fatal on a phone and would present as a crash or a silent failure rather than as
slowness.

`createImageBitmap` takes `resizeWidth`/`resizeHeight` on the **blob**, letting the decoder
downscale during decode — but you need the dimensions first. The project already parses them
without decoding: `photo/image-header.mjs`, which `selectPhoto` is already calling. Use the
header dimensions to compute the target, then decode once, bounded.

**Gates:**

- Panning changes only `transform`. Assert no layout-affecting property is written during a
  pan.
- Peak decoded-bitmap bytes during crop of a 12 MP photo stay under a stated budget, and the
  original is never decoded at full resolution.
- A 48 MP photo opens the cropper on a phone-class memory profile without failing.
- Output quality is unchanged: the crop still comes from the original file, and the existing
  `localCrop` e2e check still passes.

### U-04 amendment — key on identity, not on the source photo

Operator, 17 September: key on the generated image's metadata rather than the photo file,
to avoid holding a lot of memory.

Agreed, and it separates into two cases that were blurred together in the table above.

**A face's canonical cache key is its latent identity**, not its input. That is already true
— `cachedGenerate` writes a `latent` alias for both `seed` and `photo` kinds, so a face is
addressable by what it *is* rather than by where it came from. Source-photo keying is only an
accelerator that skips alignment and e4e on an exact re-upload; it stores no photo and must
never start doing so.

Three consequences:

- **Do not buffer the photo to hash it.** `digest(await blob.arrayBuffer())` materialises the
  whole file — up to 64 MB by the current limit. Hash it by streaming `blob.stream()` through
  the incremental `Assets/sha256.mjs` that already exists for model assets.
- **Key on the latent — but understand what that can and cannot skip.** Operator, 17
  September, and it is right as the *canonical* key: the latent is what a face **is**, it is
  already what the alias records use, and it is what U-16 now puts in the file. An imported
  image with an embedded latent goes straight to a `latentSha256` lookup — hit means instant
  with no inference, miss means synthesis only.
  **But a latent cannot key the encode step**, because the latent is e4e's *output*: you do
  not know it until you have already paid for it. So for a raw photo the user uploads, the
  accelerator has to key on something upstream — the **aligned tensor**, a fixed 3×256×256
  regardless of input size, which is exactly what e4e consumes. That makes a crop, a
  re-encode or a re-save of the same photo skip e4e at the cost of running alignment, and it
  removes the annoyance flagged earlier where cropping an already-encoded photo forces a full
  re-encode.
  The two are complementary layers, not alternatives: **latent** for anything already
  generated or shared, **aligned tensor** for a photo arriving fresh. Do not replace one with
  the other.
- **A re-imported *generated* image is identified by its embedded metadata** (U-16), not by
  hashing pixels. That is the reliable path, it survives re-saving, and it costs nothing to
  read.

Gate: re-uploading a previously encoded photo, and a cropped version of it, both emit no
`encoding` stage. Peak memory during photo admission stays bounded regardless of file size.

### U-18 — the published gallery exists and the product ignores it

Operator, 17 September: was the work to upload and warm a cache of older Triton-generated
images ever finished? It is not showing up in numeric seed selection, and first load should
land with faces already on screen the way the deployed site does.

**It was finished.** `hosting/gallery/README.md` records the publication, 16 September, at
`https://facemorph-seed-gallery.cdilga.workers.dev`:

| Published | Count |
|---|---|
| Public-name previews at 200px | 5,055 |
| Historic full-size name images | 2,911 |
| **Numeric seeds 0–999 at 1024px** | 1,000 |
| Total | 8,966 images / 364,039,372 bytes |

Every name identity was recomputed from its exact lowercase request with SHA-256, every
numeric identity derived from its seed, and every file checked against its measured size and
hash before publication. The ledger is
`review-artifacts/static-assets-2026-09-16/verified-selection.json`, with three public
byte/hash checks in `cloudflare-publication.json`.

**What is missing is the wiring, in three places.**

1. ~~**The catalogue the app downloads contains only a third of it.**~~ **Done, 17
   September.** `scripts/build-catalogue.py` rebuilds `catalogue.json` from
   `verified-selection.json`, refusing to emit unless the ledger is publication-approved,
   every published path derives from the documented rule, and the seed range is contiguous.
   The catalogue now covers all 8,966 assets — 5,055 names with a `full` marker on the 2,911
   that have a 1024 image, and the seed range 0–999 — and it is **582,145 bytes, 41% smaller
   than the 995,907-byte original**, because it carries identities instead of repeating
   8,966 URLs. `desktop/catalogue-source.json` pins it by hash and has been updated.
   `loadNames()` derives preview URLs from the identity and still accepts the old shape.
2. **Nothing in the product ever fetches a hosted image as a result.** `loadNames()` uses the
   catalogue purely for Browse-names thumbnails; `cachedGenerate` checks the local IndexedDB
   originals store and nothing else. The closeout decision of 16 September says "the product
   checks valid local and eligible hosted cache entries **before initializing models**" —
   that is unimplemented. Picking `charlotte` runs a full local generation while a verified
   image of exactly that face sits on Cloudflare.
3. **Seed browsing was dropped from the UI entirely.** Classic's `BrowseFacesDialog` offered
   a seed grid; the candidate offers names only (already noted in U-15). The published 0–999
   at 1024px is precisely the set that browser wants.

**What to build.**

*A three-tier lookup, in order, before any model loads:*

| Tier | Source | Status of the result |
|---|---|---|
| 1 | Local originals store (IndexedDB) | **Canonical.** Lossless 1024, exact, already implemented |
| 2 | Hosted collection | **Preview only.** Shows instantly; never enters the originals store |
| 3 | Local generation | **Canonical.** Produces the 1024 original and replaces the preview |

Tier 2 is a display accelerator, not a cache entry. The gallery README and the 16 September
closeout are already explicit about this — "all historic lossy originals", and "new 1024 PNG
canonical originals belong in the device cache and are not substituted by these historic
images". A 200px JPEG must never be written into the originals store: it would take a real
`imageSha256` slot with bytes that are not inference output, and poison identity for
everything downstream. Label it in the UI as a preview until the canonical render lands.

*Lookup is free, because the identity already exists.* The gallery path for a text face is
`hash-<sha256 of the exact lowercase value>` — the same hash `inputLatent` already computes
for `mode:'text'`. Verified: `sha256("charlotte")` is `4a2b5e1822ca1158…`, which is the
published path. So tier 2 is "hash what you were going to hash anyway, and try a URL".
Numeric seeds need their own published path scheme derived from the seed, which the gallery
already uses.

*First load lands with faces.* Classic renders two faces immediately. Extend the catalogue to
cover seeds and full-size names, then pick the two default inputs from values that are
**in** the collection, so the page always lands with real faces at essentially zero cost —
two small images, no model, no compute. Note `hello` is **not** in the 5,055 names, so the
current default cannot resolve; either publish it or change the default. Classic's other
default is today's date, which can never be precomputed — accept a single generated face
there, or pick a different second default.

*Restore the seed browser* using seeds 0–999, which now have 1024px images.

**One thing to fix before release.** The gallery is served from
`facemorph-seed-gallery.cdilga.workers.dev` — a personal `workers.dev` subdomain. It is
Cloudflare, so it satisfies the no-TrueNAS requirement, but it is an ad-hoc origin rather
than the site's own assets and it does not look like part of the product. Move it onto
`next.facemorph.me` (or a `facemorph.me` subdomain) before release, and keep the hashes.

**Gates:**

- `catalogue.json` covers all three published sets: 5,055 names at 200px, 2,911 full-size
  names, 1,000 seeds at 1024px. Every referenced URL returns HTTP 200 at its ledger size.
- Selecting a name or a seed that is in the collection shows a face with **zero** inference
  workers created and no model bytes requested.
- That preview is **not** in the originals store afterwards; generating canonically then
  replaces it and the stored `imageSha256` is the inference output.
- First load shows two real faces with no interaction.
- A cache miss, an offline device and a 404 from the gallery all fall back to local
  generation without an error.
- The seed browser renders 0–999 from the hosted 1024 images.

### U-19 — finish the Triton census and the upload it was meant to feed

U-18 wires up what is already published. This is the other half: the archive work that
produced it was never finished, and the record does not currently say so clearly.

**What is actually true today.**

| | State |
|---|---|
| Published and live | 8,966 files / 364,039,372 bytes |
| Names at 200px | 5,055 — complete |
| Names at full size | 2,911 of 5,055. **2,144 have none** (`summary.json: missing1024JpgAndWebp`) |
| Numeric seeds at 1024px | 0–999 |
| `publicationApproved` | **false** |
| `allFilesChecksummed` | **false** |
| `losslessOriginalsEstablished` | **false** |

**The census was never completed.** `review-artifacts/cache-census-2026-09-15/README.md` is
explicit: a 30-second bounded metadata scan exhausted its budget after 2,367 strict seed-path
candidates (73,747,385 bytes) in the active tree, and **oldSeeds was never reached**. Its own
"Next" step — checkpointed inventory of the active tree, an independent oldSeeds scan,
source-era reconciliation, then checksum and export — has not been done. The ~2 TB figure is
an operator estimate of a mixed tree, not a measurement of anything.

So the 15 September full-scope decision — preserve *all* eligible seed and hash-generated
images, not a curated subset — is almost entirely outstanding: seeds beyond 0–999, text
hashes beyond the 5,055 names, and the whole of oldSeeds.

**Correction to an earlier reading of the flags.** `summary.json` carries
`publicationApproved: false`, but that is the *candidate* stage — `candidate-selection.json`
is explicitly "NOT upload-ready". The approved ledger is `verified-selection.json`, which has
`publicationApproved: true` across all 8,966 entries with a SHA-256 and measured byte size
each. Staging verification is therefore complete. What remains partial is verification of
what is **served**: `cloudflare-publication.json` records three post-publication byte/hash
checks, not 8,966. `hosting/gallery/README.md` should say which of the two it means.

**The task, in order.**

1. **Finish the census.** Checkpointed and resumable, read-only, bounded per pass, across both
   roots. Metadata first, no pixels. Report counts and bytes by source root, provenance class,
   still versus video/intermediate, resolution, format, model era and unique checksum, with
   unreadable, changed and unknown files reported separately. Never one unbounded pass over
   the whole tree. **Triton stays read-only** — that is a standing safety boundary, not a
   preference.
2. **Classify.** Eligible means a proven seed or text-hash generated still. Exclude
   recovered, uploaded and e4e-derived output, GUID-registered arbitrary latents, mixed and
   unknown provenance. A numeric-looking filename, a hash-shaped path or a plausible face is
   not provenance.
3. **Close the gap on what is already live** before adding to it: check all 8,966 *served*
   files against `verified-selection.json` rather than three, and record the result. A
   40-asset random sample on 17 September returned 200 at the exact ledger byte size for
   every one, across all three classes — encouraging, not a substitute for the full pass.
4. **Fill the 2,144 missing full-size names** — from the completed census if the files exist,
   otherwise by generating canonical 1024 PNGs on a qualified non-production route with
   separate provenance. Upscaling a 200px JPEG is not recovery of an original, and the
   historic image is retained either way.
5. **Size the options and come back before uploading.** Cloudflare Static Assets file-count
   and size limits are something to measure, not assume. No paid storage and no overage is
   authorised, so the long tail is a decision to present, not to take.
6. **Move the origin** off `cdilga.workers.dev` onto a `facemorph.me` host, hashes preserved
   (U-18).
7. **Extend `catalogue.json` as each batch lands**, so the product sees new coverage without
   a code change. `scripts/build-catalogue.py` regenerates it from the ledger; the tracked
   source is `hosting/next-static/catalogue.json` and `promote.py --catalogue` publishes it.

**Done on 17 September:** the catalogue half (see U-18) and the tracked-source fix — the
published catalogue was previously an untracked file under a gitignored `public/`, supplied
to `promote.py --catalogue` by path, so what shipped had no version-controlled origin. It now
has one.

**Gates:**

- The census completes over both roots, is resumable, and reports unreadable and unknown
  files separately. A sampled scan is not a census.
- A classification ledger exists with a provenance class per file, and nothing outside the
  eligible class is staged.
- All served files are checksummed against the ledger, and the three approval flags in
  `summary.json` reflect measured evidence.
- No writes to Triton of any kind. No paid resources.
- Measured capacity options are presented to the operator before any upload beyond the
  already-published set.


---

## Sequencing

1. **C-09** — fix the reporting instrument, and check the collector's live binding. Nothing
   else can be measured through a broken one, and the operator has already spent a run on it.
2. **C-01** — promote the kept kernel and re-measure. Nothing on the GPU route means
   anything until this is done.
3. **C-08.1** — one honest phone profile, with the route recorded.
4. **C-03, C-04, C-05** — the three largest ledger entries, in that order.
5. **C-08.2–4** — parity harness, CI gate, route display. These are what make it stay fixed.
6. **C-10** — label every stage and wire real download progress. Small, and it stops the
   product misreporting itself while everything above is being measured.
7. **C-06, C-11, C-07, U-01** — the morph path end to end: drop the PNG round trip, move to
   WebCodecs and pipeline the encode, fix the encoder shape, then cold load.
8. **U-14** — the slider, which C-06's retained frames make nearly free.
9. Part 3, with **U-10 + U-15** as one pass, last.

**Open — operator's call:** U-10 (classic styling) is the largest single UX item and
touches most of the surface. It could go before Part 1 so testers see something familiar
sooner. Recommendation is after, because the complaint was speed, not looks — but that is a
call to make, not an assumption.

**Not in this document:** the native desktop GPU backend matrix (CUDA / Core ML / MPS /
DirectML / ROCm), Oliver's mandatory Manjaro gate, branch protection on `master`, the
cross-engine browser matrix rows, and the consented-diagnostics round trip. Those stay
where the delivery plan puts them. Note that C-01 is a warning about that matrix too: it is
a promotion-discipline failure, and a native GPU campaign will produce far more candidates
to promote than this one did.
