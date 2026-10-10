# Research round: first use and returning visits — 10 October 2026

**Status: active experiments; raw/codec component correctness passed, paired measurement and product integration in progress. Direct display/video component transport wins are recorded; application integration is awaiting exact-artifact qualification. No product speedup or deployment of that integration is claimed yet.** Priorities are instant `hello`, automatic cached-face restoration and ordinary-policy warm hydration. This round also targets **direct RGBA display/video with deferred image encoding, persistence and latent metadata**. Finished-video caching is excluded by operator direction.

The [performance-history README](../../history/performance-through-2026-10-09/README.md) holds the optimization narrative and older per-device comparisons. This document holds only this round's evidence, gaps and decisions. Older-build diagnostics below describe coverage, not current latency. The [round log](log.md) preserves append-only events; the [UI handoff](next-pass.md) defines ownership and the control freeze; [experiment specifications](experiments.md) define the work to try.

## Current experiment progress

The [direct RGBA candidate](../../candidates/direct-rgba-media-v1/README.md) passed bounded raw transport, compact metadata and browser decode/playback checks. Its hello WebP output including exact W+ recovery metadata is 129,932 bytes; PNG is 4,245,531 bytes for the same public fixture. Local contention prevents a speed claim. The bounded CI ABBA screen completed; direct draw65.31→5.02ms and raw video codec1,316.24→186.07ms. WebP file-ready is slower but smaller; realtime settings were discarded. See the [paired analysis](../../candidates/direct-rgba-media-v1/ci-analysis.md). Application integration passed source correctness (including109,188-byte generated WebP recovery and changing-frame video) and product unit checks; compiled artifact qualification is next; see journal events `review-20261010-008` and `review-20261010-009`. Development artifact `e0b2192` passed; a new live/UI observation will supersede the older snapshot below without rewriting its raw evidence.

## Measurement identity and boundaries

Snapshot checked **10 October 2026**: [next.facemorph.me](https://next.facemorph.me/) was deployed from [`b322a26`](https://github.com/check-face/facemorph.me/commit/b322a26858275f0e361127836d0fd1854e868ef9), by [run 37886427733](https://github.com/check-face/facemorph.me/actions/runs/37886427733). Its webpack asset is `app.6f67e921bae679214856.js`; its embedded diagnostic build ID is **`next-2ff6791800ad7dbf`**; runtime manifest SHA-256 is `d9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c`. These identify source, bundled bytes, diagnostics and runtime assets respectively; they are different identifiers. [Deployment receipt](deployment.json).

Current performance claims require recent actual analytics or consented debug reports matched to build, device/browser, route, workload, cache state and timer boundary. The automated live probe is diagnostic evidence, not normal-user analytics. No matched evidence means **unknown**.

A decoded displayed face means the 1024px image decoded and the UI job became idle; the probe starts before field/button interaction. It is not a compositor paint timestamp. Video-ready means the actual element decoded 1024px media, finite duration and `readyState=4`; it excludes OS share/recipient completion. Keep empty caches, retained models, continued-session inference and exact output hits separate.

## Automated live journey observation (photo excluded)

A single bounded run used eris's hardware NVIDIA/Turing adapter, an isolated empty profile, production HTTPS, cross-origin isolation, synthetic inputs, and the cooperative device lease. Host load was 1.4 before and 3.0 afterward; existing desktop apps stayed open. No diagnostic-report consent was enabled. These are **observations, not an ABBA speedup experiment or full31 qualification**.

| User journey | Observed wall time | Work done |
| --- | --- | --- |
| Navigation to mounted UI | **799 ms** controller wall | Zero face images shown on arrival in this live build. Not a first-paint/Core Web Vitals measurement. |
| First new face, empty profile | **8,751 ms (seven webdriver canaries)** | One inference worker; downloads/setup; seven automated-test canaries; user synthesis. Model-loaded occurred 5,686 ms after action start. |
| Three different new faces, same session | **190.4 / 193.3 / 207.5 ms** | No additional inference workers; one synthesis each. Recorded synthesis **74.7 / 75.0 / 75.9 ms**. |
| Same face again | **81.8 ms** | Zero new workers, zero synthesis events. |
| Default two-face morph, 32 output frames | **1,834.8 ms** | Thirty new synthesis events plus two retained endpoints; decoded 1024×1024 video, duration 2 s. Includes actual product writer and UI. |
| Same morph again | **1,180.8 ms** | Zero new synthesis events; a new video worker. Cached frames still go through the writer. |
| Same original after reload | **133.8 ms** | Zero inference workers and zero synthesis events. A warm-output hit does not need model initialization. |
| Different face after reload, models retained | **2,662.4 ms (seven webdriver canaries)** | One inference worker; model-loaded stage duration **643.3 ms**; seven automated-test canaries plus user synthesis. |

[Raw live report](live-eris.json) · [reproduction script](observe-live.mjs).

**Important startup qualification:** `navigator.webdriver=true` makes this automated run execute seven canaries. The ordinary user's current admission policy is different. Consequently 8.751 s and 2.662 s are valid totals for this automated journey, not universal first-visit/revisit promises. Historical qualification timings use different boundaries; see the separate archive.

This default loop is not workload-matched to the historical API sequence. It establishes a bounded browser observation, not an API speedup or proof of any individual optimization's transfer.

Two subsequent cold-process launches using the same isolated profile returned **no WebGPU adapter** before processing started. The probe refused to label them GPU results; neither executed the photo workload. [First refusal](live-eris-photo.json) · [bounded retry](live-eris-photo-retry.json). This raises a returning-process capability/reliability question. It does **not** show that the product's automatic CPU fallback failed: that fallback was not exercised by these GPU-only probes. A fresh October photo/upload/save latency therefore remains unmeasured.

The deployed [CI UI evidence](https://github.com/check-face/facemorph.me/actions/runs/37886427733) does independently cover actual CPU photo/e4e, local crop, repeated-original reuse, named route rejection and a decoded MP4. It establishes those synthetic workflows on Linux Chrome 154, not their phone speed or universal reliability. Project file controls are deliberately hidden; their serialized format is tested separately.

## Actual debug-report coverage

A read-only query of the private diagnostics R2 bucket on 10 October listed **303 objects**. The bounded **8–9 October receipt window** contained **78 objects / 48 run IDs**, of which three lacked a start event within that window. Raw reports were processed in memory; no private report export or backup was added to Git. KV fallback records and GA4 were not queried, so this is not complete product traffic. Receipt time is not necessarily execution time because reports may be retried.

[Non-identifying aggregate report](reporting-coverage.json) · [collection script](reporting-coverage.py). The query ran at **05:31:09 UTC**, selecting receipts since **8 October 00:00 UTC**; the last receipt was **9 October 05:07:53 UTC**.

The live application bundle identifies itself as **`next-2ff6791800ad7dbf`**. Only **one** run in this window had that matching build identity: macOS / Chromium 151 / morph / auto, completed at **13,168 ms** on its diagnostic job timer, with model-loaded stages **465 / 824 ms** and 32 synthesis-complete events. The record includes admission and endpoint generation; frame count, exact GPU, cache state and compositor/video-ready boundary are not fully established. This is a recent reported job, **not** a warm-hydration baseline or a comparable eris sequence benchmark.

The recent photo example with a complete start event was on **`next-686bf8145648d399`**, macOS / Chromium 151: its job completed at **11,572 ms**, with alignment **5,857 ms**, encoder session creation **545 ms**, attributed encoder inference **3,876 ms**, and synthesis **521 ms**. It is a different application build and unspecified photo/cache state. It neither establishes the snapshot build's first-photo latency nor proves/disproves the operator's few-seconds observation. The reported encoder inference itself was a few seconds; the whole reported job includes more work.

Other cohorts include macOS Chromium 154, Windows and Android on older build identities. They are kept separate: browser majors, selected routes, workloads and hardware are not interchangeable. Some Android/Windows run IDs contain both interrupted and completed outcomes, confirming the [UI plan review's lifecycle concern](../../../docs/plans/review-2026-10-10.md): do not compute a failure rate by counting terminal events without an idempotent request denominator.

**Decision:** recent reporting does not yet provide a matched current-build photo or warm-hydration baseline. Collect those under ordinary policy before making a current latency claim or choosing a causal performance change. Historical benchmark values remain in the separate archive. See the [aligned research/UI handoff](next-pass.md) for the next pass's measurement and integration contract.

## Export and recovery status at the snapshot

**PNG and MP4 latent embedding was absent at the reviewed live snapshot.** BlueHarbor has committed the U-16 implementation in [`f506892`](https://github.com/check-face/facemorph.me/commit/f506892); a source commit does not establish qualified or live behavior. A fresh check of the candidate's HTML still references `app.6f67e921bae679214856.js`, matching the reviewed deployment [`b322a26`](https://github.com/check-face/facemorph.me/commit/b322a26858275f0e361127836d0fd1854e868ef9) and its [successful deployment run](https://github.com/check-face/facemorph.me/actions/runs/37886427733).

At that source, [`saveMedia` / `shareMedia`](https://github.com/check-face/facemorph.me/blob/b322a26858275f0e361127836d0fd1854e868ef9/src/Next/product-bridge.mjs#L303) pass the existing image/video blob directly to file delivery. [`saveFile` / `shareFile`](https://github.com/check-face/facemorph.me/blob/b322a26858275f0e361127836d0fd1854e868ef9/src/Next/media.mjs#L18) do not attach latents or project metadata. The PNG encoder writes image chunks; the video writer returns encoded MP4 bytes without attaching a morph project. Latents/provenance are retained separately in local storage, and the separate JSON project serialization carries morph control latents. That is not embedding in downloaded media. This is a source/export-path check tied to the live asset identity, not a fresh downloaded-file round-trip test.

Embedding is already required by [U-16](../../../docs/round-1-work-order.md) and identified as missing by [R3-22](../../../docs/round-3-plan-review-2026-09-23.md#r3-22--p0--contract--media-metadata-u-16-is-written-into-the-contracts-but-not-implemented-and-it-will-silently-void-an-e2e-gate). Keep it as a delivery gap: add latent/reproduction metadata at export, preserve canonical cache bytes, and verify re-import on both a retained-cache device and a cold second device. The cold second device still needs synthesis; it should bypass photo alignment/e4e. Existing authorization calls for default embedding, with no source photograph or typed value in the export. When implemented, use a metadata-free photo fixture to keep the e4e gate meaningful.

The planned recovery method remains documented: **numeric seed faces carry the seed, text/photo-derived faces carry W+ float32, and MP4s carry the morph project**. Re-upload inspects this metadata **before** crop/alignment/e4e or their download gate, validates the generation identity, then retrieves a verified local original or deliberately regenerates from seed/latent. The reviewed deployed reader in `selectPhoto` does not implement that dispatch; it follows the ordinary photo path. Targeted available-branch history checks found no implemented metadata writer/reader later removed. This is an unfinished export-and-recovery requirement, not evidence of a working feature being deleted. A file without metadata remains an ordinary photo; older clean downloads cannot recover metadata that was never written.

## Decisions and next experiments

| Order | Goal | Evidence needed / next action |
| --- | --- | --- |
| 1 | Instant initial preview and automatic restored face | UI development owns implementation. Measure navigation → decoded visible `hello`, then navigation → restored canonical face/save availability, including models absent, corrupt/evicted storage and rapid edits. A valid hit must avoid inference/model download gating. |
| 2 | Ordinary-policy warm hydration | Measure reload and fresh-process retained models with normal admission, separating read/verify, session creation, upload/compile, admission, synthesis and display. The webdriver totals above are insufficient controls. Pair a causal change against the frozen UI revision. |
| 3 | Direct RGBA display and video; encode media out of band | Test removing the per-frame PNG encode/decode round-trip. Send pixels to display and both WebCodecs/FFmpeg; a bounded worker creates downloadable/cacheable PNG or lossy/lossless WebP and adds recovery metadata. Measure display, scrub, playable video **and** Download/Share readiness, memory, storage and failures. [Detailed design and gates](experiments.md#r03--direct-rgba-with-deferred-image-encoding). |
| 4 | Current first/next photo with retained models | Record actual upload/crop/alignment/e4e/reconstruction/display/save on the frozen build. Use a metadata-free fixture; exported-face re-upload is a separate recovery workload. Select a photo optimization only after a matched baseline. |
| 5 | Export writer costs and fallback | Profile raw handoff, conversion/scaling, queue wait, encoder init/flush, mux and playable decode for the **actual selected codec**. Browser WebCodecs and FFmpeg fallback are separate lanes. No extra FFmpeg pass or thread change without evidence. |

Direct RGBA and warm hydration both fit this iteration; measurements determine which delivers the larger user benefit. Faster display alone is insufficient if persistence, immediate download or next-visit restore regresses. No PNG→WebP format switch has been selected and no new codec speedup has been measured. Video quality uses practical visual acceptance, with no exact pixel parity requirement; face downloads may be lossy too, aiming for API-like quality and file-size scale. Record speed/size/quality tradeoffs separately from latent/raw-synthesis correctness. See the [recorded quality ruling](quality-policy.md).

The native API's cached `hello` returned **107.4 / 61.1 / 78.2 ms** HTTP wall from eris (median **78.2 ms**, three identical 92,624-byte responses). [Raw observations](api-hello.json). This measures existing-image network delivery, not generation or browser preview display. A Prometheus refresh returned HTTP 401; the native generation/MP4 baseline remains in the dated history archive.

Current device coverage is narrow: eris has the automated observation above; macOS Chromium 151 has one matching-build reported morph job. No matched ordinary-policy photo/warm-hydration baseline or physical-phone current latency is established. Android and Windows diagnostics belong to other builds; Simulator results remain historical. Collect bounded phone attempts with consented reports, including failure/fallback outcomes; do not infer handset performance from desktop results.

BlueHarbor's UI increment owns queue/restore/infill/metadata/reporting changes and will supply a qualified source/live identity. Research preserves the old probe as historical reproduction and adapts a new harness to the new selector contract. Do not measure a moving working tree as a frozen control. Adapter refusal after process restart, phone storage/quota behavior and lifecycle duplicate terminals remain unresolved coverage questions.

## Evidence and reproduction

This folder commits the raw observational JSON and script so these new values are auditable from Git. Historical local artifacts referenced by the ledger remain outside Git where not otherwise linked; the old matrix does not become newly qualified by appearing in this report.

```bash
# From the repository root; requires an existing Playwright installation and real hardware GPU.
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
DEPLOYED_SOURCE_SHA=<verified-live-source-sha> \
python3 autoresearch/run.py --lane browser-gpu --device eris --timeout 480 -- \
  node autoresearch/reviews/2026-10-10/observe-live.mjs /absolute/path/to/report.json
```

`REVIEW_FOLLOWUP=1` enables the separate synthetic photo/save probe; `REVIEW_PROFILE` selects this probe's own retained isolated profile. Its two retained attempts here stopped at adapter admission, before photo execution. Never point the probe at the operator's normal browser profile. A successful command is observational execution evidence, not a performance or release certificate.

To repeat the reporting query, use the installed/authenticated `cf` CLI and a newly verified live diagnostic build ID:

```sh
python3 autoresearch/reviews/2026-10-10/reporting-coverage.py \
  --window-start 2026-10-08T00:00:00Z \
  --live-build next-2ff6791800ad7dbf \
  --output /absolute/path/to/new-coverage.json
```

Retain only non-identifying cohort aggregates publicly. Raw consented reports keep their existing private expiry. A new collection is a new dated observation, not an overwrite of this round's frozen evidence.
