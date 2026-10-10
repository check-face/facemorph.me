# Research round: first use and returning visits — 10 October 2026

**Status: corrected candidate `bce3204` is qualified and deployed to next.facemorph.me, with matching live bytes. Component direct display/video wins are recorded; the corrected paired e0/bce built-UI screen reached its 1800 s limit; an unchanged-workload rerun has a 3000 s budget. No current-user latency or overall product speedup is claimed yet.** Priorities are instant `hello`, automatic cached-face restoration and ordinary-policy warm hydration. This round also targets **direct RGBA display/video with deferred image encoding, persistence and latent metadata**. Finished-video caching is excluded by operator direction.

The [performance-history README](../../history/performance-through-2026-10-09/README.md) holds the optimization narrative and older per-device comparisons. This document holds only this round's evidence, gaps and decisions. Older-build diagnostics below describe coverage, not current latency. The [round log](log.md) preserves append-only events; the [UI handoff](next-pass.md) defines ownership and the control freeze; [experiment specifications](experiments.md) define the work to try.

## Current experiment progress

The [direct RGBA candidate](../../candidates/direct-rgba-media-v1/README.md) passed bounded raw transport, compact metadata and browser decode/playback checks. Its public hello WebP including exact W+ recovery metadata is 129,932 bytes; PNG is 4,245,531 bytes. Isolated CI measured draw+RAF **65.31 → 5.02 ms** and decoded-playable raw video codec **1,316.24 → 186.07 ms**, excluding synthesis and compiled UI. WebP encoding was slower but smaller; realtime video settings were discarded. See the [paired analysis](../../candidates/direct-rgba-media-v1/ci-analysis.md).

The contended eris source screen established correctness only. Application integration was pushed as [`d0d8d7a`](https://github.com/check-face/facemorph.me/commit/d0d8d7a6332652dbc09cc7418520f8863aed11f8); build and compiled UI passed, but [real CPU UI qualification](https://github.com/check-face/facemorph.me/actions/runs/38032536121) stopped at repeat-original. A local exact-artifact trace found **zero repeat inference** but a repeated download encode: per-face Generate lost the prepared download. The correction reuses a same-input face and waits for deferred canonical encoding before recording the last result. That fix passed the e590 CPU UI journey. A further worker-clone issue made deferred WebP fall back to PNG; `bce3204` sends only recovery identity/latents and adds Chrome WebP plus no-processing-worker re-upload gates. Regression tests pass; the corrected artifact passed build, compiled UI, full CPU UI and deployment. [Live identity](live-bce-identity.json) binds diagnostic build `next-995b477854d97c7a` and app `app.25b21e2904ae5841d01e.js` to that artifact. Real Chrome downloads are WebP, repeat without workers, and re-upload bypasses processing workers; a saved 1024px / 2 s MP4 carries its two-control project. The corrected [built-UI experiment](https://github.com/check-face/facemorph.me/actions/runs/38034405920) compares e0/bce. Earlier attempts stopped at artifact upload, restored-field interaction or a normalized-photo cache shortcut; they supply no accepted paired timing. Photo variants now change decoded pixels and must execute the encoder. That corrected run hit the 1800 s budget after eight complete measured visits and a partial ninth. Its [retained partial report](../../candidates/direct-rgba-media-v1/built-ui-timeout.json) is inconclusive; [replacement run 38036307932](https://github.com/check-face/facemorph.me/actions/runs/38036307932) repeats the full ABBA ×3 campaign with the same frozen artifacts, inputs and policy with a 3000 s command / 55 min job budget. No partial sample selection is used as a speed result.

The qualified control is now `e0b2192`, with [live byte identity](../../../docs/review/candidate-2026-10-10/live-identity.json). The observations below are the **earlier round snapshot**, retained as dated evidence; they do not describe today's live delivery.

## Delivered behavior and recent reporting

Generated pixels now draw directly to canvas; video consumes ordered raw frames.
Canonical PNG storage and lossy WebP download encoding run in bounded workers.
Four sparse anchors keep early scrub availability before ordered streaming. The
existing video quality/queue settings remain, and finished videos are not cached.
Initial `hello` and automatic original restoration came from the aligned UI control
and remain in the delivered candidate.

The [qualified Chrome UI check](../../candidates/direct-rgba-media-v1/cpu-qualification.json)
covers unchanged-input reuse, true metadata-free photo/e4e, local crop, WebP recovery
without processing workers and decoded 1024px playable video. One actual downloaded
face is **126,158 bytes: 76,116 image + 50,042 metadata**. Its exact 9,216 W+ values
recover; the **1,419,362-byte MP4** carries a two-control project. These are sizes
and correctness results, not latency distributions. Hidden project-file UI remains
explicitly skipped, with serialization tested separately.

A [fresh private-R2 coverage query](reporting-coverage-bce.json) at **07:23:21 UTC**
found 339 listed objects; the 10 October receipt window held 36 objects / 21 run IDs,
with **zero matching the new live build**. Raw private events stayed in memory.
Recent older-build Android reports include mixed provider and cache/job boundaries;
their short job timers do not establish warm inference. Current user/device
latency therefore remains unknown. The prospective collector now separates
requested route from observed provider values.

The explicit **GTX 1050 / Chrome 141** [control attempt](../../candidates/direct-rgba-media-v1/gpu-control-failure.json)
reached processing after its stale selector was fixed, then failed with an invalid
command buffer before a face. It provides no GPU timing and does not qualify the
raw candidate. Eris source correctness and Linux CPU UI qualification remain
separate. Android/iOS component lanes passed. The corrected [iOS product campaign](https://github.com/check-face/facemorph.me/actions/runs/38034719345) also passed: one full-resolution RGBA-canvas face on iPhone 16 Pro Simulator / iOS 18.5, using CPU after no WebGPU adapter was available. The [receipt](../../candidates/direct-rgba-media-v1/ios-qualification.json) records source `549ecdf`, a harness-only follow-up with different bundle identity from live `bce3204`. This is functional simulator evidence, not paired timing, physical-phone speed or photo/download/video/memory qualification.

<details>
<summary>Earlier 10 October snapshot — older build, retained for audit</summary>

## Earlier round snapshot: identity and boundaries

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

The earlier snapshot application bundle identified itself as **`next-2ff6791800ad7dbf`**. Only **one** run in this window had that matching build identity: macOS / Chromium 151 / morph / auto, completed at **13,168 ms** on its diagnostic job timer, with model-loaded stages **465 / 824 ms** and 32 synthesis-complete events. The record includes admission and endpoint generation; frame count, exact GPU, cache state and compositor/video-ready boundary are not fully established. This is a recent reported job, **not** a warm-hydration baseline or a comparable eris sequence benchmark.

The recent photo example with a complete start event was on **`next-686bf8145648d399`**, macOS / Chromium 151: its job completed at **11,572 ms**, with alignment **5,857 ms**, encoder session creation **545 ms**, attributed encoder inference **3,876 ms**, and synthesis **521 ms**. It is a different application build and unspecified photo/cache state. It neither establishes the snapshot build's first-photo latency nor proves/disproves the operator's few-seconds observation. The reported encoder inference itself was a few seconds; the whole reported job includes more work.

Other cohorts include macOS Chromium 154, Windows and Android on older build identities. They are kept separate: browser majors, selected routes, workloads and hardware are not interchangeable. Some Android/Windows run IDs contain both interrupted and completed outcomes, confirming the [UI plan review's lifecycle concern](../../../docs/plans/review-2026-10-10.md): do not compute a failure rate by counting terminal events without an idempotent request denominator.

**Decision:** recent reporting does not yet provide a matched current-build photo or warm-hydration baseline. Collect those under ordinary policy before making a current latency claim or choosing a causal performance change. Historical benchmark values remain in the separate archive. See the [aligned research/UI handoff](next-pass.md) for the next pass's measurement and integration contract.

## Export and recovery status at the snapshot

**PNG and MP4 latent embedding was absent at the reviewed live snapshot.** BlueHarbor had committed the U-16 implementation in [`f506892`](https://github.com/check-face/facemorph.me/commit/f506892); a source commit does not establish qualified or live behavior. The check at that earlier snapshot referenced `app.6f67e921bae679214856.js`, matching the reviewed deployment [`b322a26`](https://github.com/check-face/facemorph.me/commit/b322a26858275f0e361127836d0fd1854e868ef9) and its [successful deployment run](https://github.com/check-face/facemorph.me/actions/runs/37886427733).

At that source, [`saveMedia` / `shareMedia`](https://github.com/check-face/facemorph.me/blob/b322a26858275f0e361127836d0fd1854e868ef9/src/Next/product-bridge.mjs#L303) pass the existing image/video blob directly to file delivery. [`saveFile` / `shareFile`](https://github.com/check-face/facemorph.me/blob/b322a26858275f0e361127836d0fd1854e868ef9/src/Next/media.mjs#L18) do not attach latents or project metadata. The PNG encoder writes image chunks; the video writer returns encoded MP4 bytes without attaching a morph project. Latents/provenance are retained separately in local storage, and the separate JSON project serialization carries morph control latents. That is not embedding in downloaded media. This is a source/export-path check tied to the live asset identity, not a fresh downloaded-file round-trip test.

Embedding is already required by [U-16](../../../docs/round-1-work-order.md) and identified as missing by [R3-22](../../../docs/round-3-plan-review-2026-09-23.md#r3-22--p0--contract--media-metadata-u-16-is-written-into-the-contracts-but-not-implemented-and-it-will-silently-void-an-e2e-gate). That snapshot gap is now closed by qualified and deployed `bce3204`: actual WebP and MP4 downloads carry validated recovery metadata, and Chrome re-upload bypasses processing workers. See the [current qualification](../../candidates/direct-rgba-media-v1/cpu-qualification.json). Physical cold-second-device recovery remains follow-up coverage. The cold second device still needs synthesis; it should bypass photo alignment/e4e. Existing authorization calls for default embedding, with no source photograph or typed value in the export. The delivered e4e gate uses a metadata-free photo fixture to keep true photo processing separate from recovery.

The planned recovery method remains documented: **numeric seed faces carry the seed, text/photo-derived faces carry W+ float32, and MP4s carry the morph project**. Re-upload inspects this metadata **before** crop/alignment/e4e or their download gate, validates the generation identity, then retrieves a verified local original or deliberately regenerates from seed/latent. The old `b322a26` reader in `selectPhoto` did not implement that dispatch; it followed the ordinary photo path. The delivered `bce3204` reader now dispatches validated metadata before photo processing. Targeted available-branch history checks found no implemented metadata writer/reader later removed. The snapshot showed an unfinished export-and-recovery requirement, not evidence of a working feature being deleted; the requirement is now delivered. A file without metadata remains an ordinary photo; older clean downloads cannot recover metadata that was never written.

</details>

## Decisions and next experiments

The [next-direction notes](next-directions.md) separate warm-hydration attribution, padded-photo preparation, streamed-encoder costs and remaining device coverage. They are proposals for the next loop, not additional wins in this round.

| Order | Goal | Evidence needed / next action |
| --- | --- | --- |
| 1 | Instant initial preview and automatic restored face | Preview/restore is delivered. The current screen measures navigation → decoded restored original with zero startup workers; extend model-absent, corrupt/evicted/denied storage and rapid-edit coverage. A valid hit must avoid inference/model download gating. |
| 2 | Ordinary-policy warm hydration | Measure reload and fresh-process retained models with normal admission, separating read/verify, session creation, upload/compile, admission, synthesis and display. The webdriver totals above are insufficient controls. Pair a causal change against the frozen UI revision. |
| 3 | Direct RGBA display and video; encode media out of band | Direct pixels and deferred PNG/WebP are delivered, with recovery qualified. Evaluate the accepted built-UI comparison for display, playable video and download/restore transfer; total memory, physical-device resources and FFmpeg-specific stage profiling remain follow-up. [Detailed design and gates](experiments.md#r03--direct-rgba-with-deferred-image-encoding). |
| 4 | Current first/next photo with retained models | Record actual upload/crop/alignment/e4e/reconstruction/display/save on the frozen build. Use a metadata-free fixture; exported-face re-upload is a separate recovery workload. Select a photo optimization only after a matched baseline. |
| 5 | Export writer costs and fallback | Profile raw handoff, conversion/scaling, queue wait, encoder init/flush, mux and playable decode for the **actual selected codec**. Browser WebCodecs and FFmpeg fallback are separate lanes. No extra FFmpeg pass or thread change without evidence. |

Direct RGBA is component-tested and deployed; the e0/bce comparison measures its whole-journey effect. Warm hydration is the next independent causal research lane, chosen from the stage breakdown. Faster display alone is insufficient if persistence, immediate download or next-visit restore regresses. WebP quality 0.8 is selected and deployed for deferred downloads; canonical PNG persistence remains compatible. Direct raw handoff has a measured component codec benefit, while realtime settings were discarded. Whole-journey transfer is evaluated separately below. Video quality uses practical visual acceptance, with no exact pixel parity requirement; face downloads may be lossy too, aiming for API-like quality and file-size scale. Record speed/size/quality tradeoffs separately from latent/raw-synthesis correctness. See the [recorded quality ruling](quality-policy.md).

The native API's cached `hello` returned **107.4 / 61.1 / 78.2 ms** HTTP wall from eris (median **78.2 ms**, three identical 92,624-byte responses). [Raw observations](api-hello.json). This measures existing-image network delivery, not generation or browser preview display. A Prometheus refresh returned HTTP 401; the native generation/MP4 baseline remains in the dated history archive.

Current device coverage is narrow: eris has the automated observation above; macOS Chromium 151 has one matching-build reported morph job. No matched current-user ordinary-policy photo/warm-hydration baseline or physical-phone latency is established. Android and Windows diagnostics belong to other builds; the corrected simulator result above is current functional evidence with its own source identity. Collect bounded phone attempts with consented reports, including failure/fallback outcomes; do not infer handset performance from desktop results.

BlueHarbor supplied the qualified `e0b2192` control and released the stable integration paths; the corrected `bce3204` artifact is qualified and live. Research retains the old probe as snapshot reproduction and uses the new exact-artifact harness for matched comparisons. Remaining directions are ordinary-policy hydration, first-photo stage costs, fresh-process GPU reliability, physical-device storage/memory and matched reporting coverage.

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
  --window-start 2026-10-10T00:00:00Z \
  --live-build next-995b477854d97c7a \
  --output /absolute/path/to/new-coverage.json
```

Retain only non-identifying cohort aggregates publicly. Raw consented reports keep their existing private expiry. A new collection is a new dated observation, not an overwrite of this round's frozen evidence.
