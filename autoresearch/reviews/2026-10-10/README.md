# FaceMorph: how the complete experience is getting faster

10 October 2026. **Next-loop priority: faster first use and returning visits**, confirmed by the operator during this review.

**Evidence rule, added during this review:** claims about current product performance must be supported by recent actual analytics or consented debug reports, matched to release, device/browser, route, workload and cache state. The benchmark/history tables below describe their recorded scopes; they are not substitutes for that check. The automated live observations are useful diagnostics, not normal-user analytics. Missing current coverage remains unknown.

The desktop browser is approaching the old server's responsiveness once it is running. This round prioritizes **warm hydration of retained models and automatic restoration of previously generated faces**, rather than first-time model downloads. The interface should show `hello` immediately and useful retained faces on subsequent visits. Current photo processing needs its own baseline; historical acquisition timings are not an estimate of today's experience.

The best recorded eris morph path has progressed from **129.8 → 69.7 → 40.1 → 37.1 ms per frame**. A fresh check of the deployed UI produced its default **32-frame, 1024px video in 1.835 seconds**. That is encouraging evidence of transfer from research to the product. It does not turn every research result into a phone result or a controlled speed comparison with the API.

## What is live, and what these numbers mean

The reviewed candidate is [next.facemorph.me](https://next.facemorph.me/), deployed from [`b322a26`](https://github.com/check-face/facemorph.me/commit/b322a26858275f0e361127836d0fd1854e868ef9) by [successful build, UI qualification and deployment run 37886427733](https://github.com/check-face/facemorph.me/actions/runs/37886427733). Its live application filename matches `app.6f67e921bae679214856.js`; the runtime manifest hashes to `d9e37e50…`. [Deployment receipt](deployment.json).

The native API is the classic TensorFlow/CUDA service at [api.facemorph.me](https://api.facemorph.me/), running on triton's GTX 1080. The PyTorch benchmarks on eris are a separate native implementation and hardware control, not measurements of that live service.

Throughout this report:

- **Synthesis** measures the inference/frame path named by its source. It does not mean a face has been decoded and displayed.
- **Displayed face** in the new observation means a 1024px image has decoded and the UI job is idle. Timing begins before the automated field edit/button action, so it includes controller/UI interaction; it is not a compositor paint timestamp.
- **Video ready** means the actual video element has decoded 1024px media, finite duration and `readyState=4`. It does not measure the operating-system share sheet or a recipient receiving the file.
- **Cold visit**, **models retained after reload**, **same-session warm generation**, and **same output requested again** are different workloads.
- **Latest measured** is not necessarily measured on today's deployed artifact. Historical device rows retain their dates and scope. A missing number is unknown, not zero.

## The original live native API baseline

| Workload | Recorded result | What the timer includes / excludes |
| --- | --- | --- |
| GPU generation, normalized per image | **56.1 ms** over 1 day; **56.8 ms** over 7/30/90 days | 8 October Prometheus observation: generator-call time divided by images generated. Includes mapping/truncation and PIL conversion; excludes HTTP round trip and finished video. Five-minute windows: p10 56.0, median 57.3, p90 62.2 ms. |
| One uncached 1024px WebP request | **530 ms median**, range **385–865 ms**, 8 requests | Earlier client wall measurement from the operator's Mac, including about 141 ms RTT, queueing and response production. An unpaired observation, not a GPU-only single-image test. |
| Batched queue | Up to **10 images/call**, about **4 on average** in the sampled period | A Grafana generator line is per **call/batch**, not per image. Calls with at least four images averaged about 297 ms while the per-image ratio stayed about 56.6 ms. Batching is not a 4× acceleration claim. |
| Uncached 26-output-frame, 1024px MP4 | **3.10 / 2.88 / 2.96 seconds** wall from eris | Three 8 October API requests. The trigonometric schedule deduplicated to **14 unique generated images**; ffmpeg was about **1.15 seconds/MP4** in that window. The approximately 113 ms/output-frame wall ratio includes much more than synthesis. |
| First visit/startup | **No client model download** | The server already owns resident models. A cold server-process startup and classic navigation-to-preview were not measured here; neither is “0 ms.” |
| Existing `hello` image, refreshed today | **107.4 / 61.1 / 78.2 ms** HTTP wall; median **78.2 ms** | Three GETs from eris for the known 92,624-byte historic WebP. All returned identical pinned bytes. This measures existing-image delivery/network, not new generation. [Raw observations](api-hello.json). |

[Native/API baseline explanation and reproduction](../../candidates/native-cuda-morph-v1/README.md) · [evaluation ledger](../../results.tsv). A fresh Prometheus query returned HTTP 401 today, so the GPU/uncached-MP4 values above remain explicitly dated **8 October**, rather than being presented as new measurements.

## Per-device synthesis and sequence evidence

This is the available matrix, including failures and useful controls. The API's compute speed is determined by its server; it does not acquire a different GPU timing for each client phone. Client-network observations are attributed above.

| Device / route | Earlier control or starting point | Latest recorded single / sequence value | Initial-use and video evidence / limits |
| --- | --- | --- | --- |
| **eris, RTX 2080 SUPER, Linux, Chromium 152, browser WebGPU** | Earlier deployed warm face: **388 ms to image URL assignment**; ORT sequence **129.8 ms/frame** before pipelining | Paired runtime: **75.6 ms warm face**, **37.1 ms/morph frame** after direct WGSL + GPU RGBA8. Today's UI: **190–208 ms** to decoded warm face | Today's empty-profile first face **8.751 s**; models retained after reload, new face **2.662 s**. Default 32-frame video **1.835 s**, repeat **1.181 s**. Detailed scope below. |
| **eris, same GPU, native PyTorch CUDA** | Conservative self-host settings **44.4–44.6 ms/frame** | CUDA plugins + fused modulated convolution: **30.7–31.1 ms/frame** at batch 1; **30.1–30.8** at batch 4 | Same 26-frame W+ path, output to host uint8 RGB. No PNG/UI/video/network tail. Native variants agreed within one RGB level; browser-versus-native reference comparison was not done. Batch 10 ran out of memory beside desktop apps. |
| **Mac ARM64, browser WebGPU** | Chrome 144 historical sequence about **486 ms/face**; newer controls about **294–327 ms** | Historical Chrome 151/Brave matrix about **254–300 ms/face**; ledger v9 sequence **277.9 ms/face**. These are sequence averages, not measured single-face medians | Full31 reported for applicable GPU runs; browser-version/environment changes make these unpaired. No refreshed October first-face or finished-video latency for this device. |
| **Mac ARM64, browser WASM CPU** | Historical four-thread control **25.7 s/face** in the matrix; single-thread v9 screen **43.91 s/face** | Another product-era CPU-4 observation was **22.9 s for two faces** (about 11.45 s/face); different environments/scopes, **no paired improvement** | The single-thread row is only 3-case screening. No refreshed October CPU/photo/video or startup speed claim. |
| **Mac ARM64, native ORT CPU / Torch MPS** | CPU controls **633.6–744.5 ms/frame**; MPS controls **220.0–258.8** | Candidate CPU **700.7–709.4**; MPS **210.1–210.5 ms/frame** | All31 passed in four ABBA sessions; timing drift made both outcomes inconclusive. No controlled winner, initial-use number or finished-video number. |
| **Windows x86-64 desktop, Chrome 153, browser WebGPU** | Earlier operator reports about **60–70 ms/face**, different runs | Historical fixed-suite matrix **96.7 ms/face** | Full31 reported; MP4 encoding **2.6 s for 26 chunks**. This is encoding, not total sequence-to-playable-video. GPU model and fresh initial-use timing unavailable in this checkout's retained summary. |
| **Physical Galaxy S24 Ultra, browser WebGPU** | CPU-4 **2,582 ms/face**; CPU-1 **5,911**; WebGL about **13,000** | Bounded-boundary kernel: **616.35 ms single median**, **682.39 ms/sequence face** in the later full31 run; earlier seven-case row **686.12** | Useful qualified synthesis target, not a new October product/photo/video benchmark. No defensible current first-download or finished-video latency. |
| **Other Samsung report, labeled “s2r ultra,” Chrome 152** | CPU-4 about **2,774 ms/face** | GPU candidate **failed frame 00**, RGB max error 184 | No valid GPU timing. Identity is the report's label; do not silently turn it into a particular retail model. Initial-use/video unknown. |
| **Android 10 handset, Chrome 152** | CPU-4 about **2,300–2,400 ms/face** | CPU control passed; CPU-1 stalled for 180 s; tiled GPU candidates failed RGB max error 24 | No usable GPU speedup or complete video/initial-use number. |
| **Physical iPhone, 414×896 report, iOS 18.7 / Safari 26.6.1** | CPU-1/CPU-4 failed frame 00; two earlier runs interrupted by tab reset | **No measured correct complete synthesis/photo/video route in the retained evidence** | Adapter presence was observed; it is not execution qualification. Playback had a NotAllowedError. No phone latency may be borrowed from the Simulator. |
| **iPhone Simulator on Apple Silicon** | CPU-4 about **1.2–3.5 s/face** across historical runs; a product run **1.462 s**, WebGL **7.085 s**, unpaired | Pure WebGL public full31 + cache + MP4 run **8.468 s/face**; other pure-WebGL runs up to about **10.9 s**. CPU-prefix/WebGL-suffix hybrid **4.36–4.85 s/face** | The initial route-probe fix cut cached/downloaded model footprint **330 → 150 MiB**, not milliseconds. Full-chain functional evidence exists; all timings are host-Mac/Simulator results. |
| **32-core Linux desktop, unidentified GPU / WebGL** | Product diagnostics about **7.4 s/face** on WebGL | CPU-first fallback policy was implemented; **no new paired CPU timing** | A routing lesson, not a measured speed gain on this machine. |
| **S21-class target; TrueNAS GTX 1050; Android emulator** | Compatibility work/runner availability is recorded | **No usable comparable generation timing retained here** | Emulator/Simulator cache repair improved 4/7 → 7/7 checks. That is functionality, not physical phone inference. GTX 1050 runner existence is not a benchmark. |

Sources: [ledger](../../results.tsv), [campaign's S24 full31 result](../../benchmark-campaign-v2/README.md), [native status samples](../../../experiment/device-lab/research-status-v9.json), [routing evidence](../../../src/Next/browser/route-priors.mjs), [local device-lab record](../../../docs/local-device-lab.md), and the [historical matrix at the reviewed source revision](https://github.com/check-face/facemorph.me/blob/b322a26858275f0e361127836d0fd1854e868ef9/autoresearch/program.md#best-in-class-per-matrix-cell). The historical matrix summarizes raw September reports that are absent from this checkout; that limitation is preserved rather than giving them invented current timings.

## Today's end-to-end check on the actual deployed product

A single bounded run used eris's hardware NVIDIA/Turing adapter, an isolated empty profile, production HTTPS, cross-origin isolation, synthetic inputs, and the cooperative device lease. Host load was 1.4 before and 3.0 afterward; existing desktop apps stayed open. No diagnostic-report consent was enabled. These are **observations, not an ABBA speedup experiment or full31 qualification**.

| User journey | Observed wall time | Work done |
| --- | --- | --- |
| Navigation to mounted UI | **799 ms** controller wall | Zero face images shown on arrival in this live build. Not a first-paint/Core Web Vitals measurement. |
| First new face, empty profile | **8,751 ms** | One inference worker; downloads/setup; seven automated-test canaries; user synthesis. Model-loaded occurred 5,686 ms after action start. |
| Three different new faces, same session | **190.4 / 193.3 / 207.5 ms** | No additional inference workers; one synthesis each. Recorded synthesis **74.7 / 75.0 / 75.9 ms**. |
| Same face again | **81.8 ms** | Zero new workers, zero synthesis events. |
| Default two-face morph, 32 output frames | **1,834.8 ms** | Thirty new synthesis events plus two retained endpoints; decoded 1024×1024 video, duration 2 s. Includes actual product writer and UI. |
| Same morph again | **1,180.8 ms** | Zero new synthesis events; a new video worker. Cached frames still go through the writer. |
| Same original after reload | **133.8 ms** | Zero inference workers and zero synthesis events. A warm-output hit does not need model initialization. |
| Different face after reload, models retained | **2,662.4 ms** | One inference worker; model-loaded stage duration **643.3 ms**; seven automated-test canaries plus user synthesis. |

[Raw live report](live-eris.json) · [reproduction script](observe-live.mjs).

**Important startup qualification:** `navigator.webdriver=true` makes this automated run execute seven canaries. The ordinary user's current admission policy is different. Consequently 8.751 s and 2.662 s are valid totals for this automated journey, not universal first-visit/revisit promises. The older OPFS research's 859 ms “first synthesis” is also a different boundary: it means the first qualification synthesis, not a displayed user face after all qualification cases.

The **32-frame default loop** also differs from the API's **26 output frames / 14 unique images**. The 1.835-second browser observation should not be called a matched speedup over the API's roughly 3 seconds. Likewise, multiplying 37.1 ms by 26 gives a useful synthesis-budget estimate, not a measured finished export.

Two subsequent cold-process launches using the same isolated profile returned **no WebGPU adapter** before processing started. The probe refused to label them GPU results; neither executed the photo workload. [First refusal](live-eris-photo.json) · [bounded retry](live-eris-photo-retry.json). This raises a returning-process capability/reliability question. It does **not** show that the product's automatic CPU fallback failed: that fallback was not exercised by these GPU-only probes. A fresh October photo/upload/save latency therefore remains unmeasured.

The deployed [CI UI evidence](https://github.com/check-face/facemorph.me/actions/runs/37886427733) does independently cover actual CPU photo/e4e, local crop, repeated-original reuse, named route rejection and a decoded MP4. It establishes those synthetic workflows on Linux Chrome 154, not their phone speed or universal reliability. Project file controls are deliberately hidden; their serialized format is tested separately.

## Photo processing: where the big waits still are

| Evidence / stage | Earlier measured cost | Most recent useful result |
| --- | --- | --- |
| Mac desktop browser streamed e4e, first aligned synthetic photo | Alignment **12.37 s**, encoder **24.83 s**; encoder phase sums: **19.09 s acquire**, **0.755 s create**, **4.364 s inference** | Acquisition is **79% of the three attributed encoder phases**. This is a photo-runtime qualification page, not complete upload-to-displayed-reconstruction latency. |
| eris first photo in a session, models already retained | **17.627 s** encode + reconstructed face | OPFS candidate **12.093 s**, about **5.53 s saved**. Second photo about **9.47 → 10.07 s**, no established improvement. Fixed prepared photo benchmark, not complete new upload/alignment/UI. |
| iOS Simulator streamed encoder | Historical attributed phases about **25.3 s acquire / 0.5 s create / 4.6 s inference**; another retained report totals **32.5–41.8 s encoder** across fixtures | Different transport/run states; no refreshed October Simulator control. Never label these handset timings. |
| fp16 encoder experiment, Mac Node/WASM | fp32 **5.608 s** | fp16 **5.679 s**; matched 108-shard variant **6.273 s**. Weight bytes nearly halve, but session creation/heap worsen and W+ error fails the existing 1e-4 gate. **Not promoted.** |

[Desktop raw photo evidence](../../../photo-runtime/evidence/desktop-browser-five-photos.json) · [Simulator raw evidence](../../../photo-runtime/evidence/sim-photo-927e4446-d5db-49aa-9d6e-b9dcc6d20204/report.json) · [OPFS experiment and sample arrays](../../candidates/opfs-shard-cache-v1/README.md) · [fp16 ledger rows](../../results.tsv).

The live manifest permits bounded friends-and-family photo trials using Simulator admission evidence, while explicitly recording **`releaseQualified=false`** and **`physicalPerformanceQualified=false`**. It does not fill the physical phone photo matrix.

## The most interesting improvements and rejected ideas

**1. We stopped making the GPU wait for the CPU.** An ordinary morph initially spent about 62 ms on GPU work and then about 55 ms on a serial readback/PNG/derivative tail. Queuing the next frame while processing the previous frame took the product-runtime sequence **129.8 → 69.7 ms/frame**, a **1.86×** throughput gain. This is scheduling, not reduced resolution. [Experiment](../../candidates/morph-frame-pipeline-v1/README.md).

**2. The native baseline changed the research question.** Native CUDA on the same RTX 2080 SUPER produced host RGB in about 31 ms, while the pipelined browser still took about 70 ms/frame. The remaining gap was mainly GPU kernels. Tiled direct WGSL convolution and fused work brought browser frames to **40.1 ms**, followed by GPU RGBA8 conversion to **37.1 ms**. The browser's output tail and native host-RGB endpoint still differ; “browser beat native” is not established. [Direct-engine integration](https://github.com/check-face/facemorph.me/commit/ea8450b) · [RGBA8 integration](https://github.com/check-face/facemorph.me/commit/38f62fb).

**3. Smaller transfers mattered after the kernels got faster.** Float readback was 12 MB/frame. Converting to RGBA8 on the GPU brought that to 4 MB and removed the CPU conversion loop, improving the paired warm face **103.5 → 75.6 ms**. A first implementation exposed floating-point contraction differences at exact rounding boundaries; preserving the original two-rounding behavior made the compared frames exact. This is a useful example of validating a small output change rather than assuming it is harmless.

**4. A “cached model” was still expensive to use.** OPFS unit files plus native SHA-256 verification reduced paired warm model loading **1,430 → 640 ms**, first qualification synthesis **1,685 → 859 ms**, and first photo **17.63 → 12.09 s**. Integrity is checked when bytes are read; a durable “verified” flag does not excuse checking changed bytes. The same work repairs an individual corrupt unit rather than re-fetching an entire large asset. Chromium/Firefox storage behavior was measured; Safari/physical-phone OPFS still needs its own evidence. [Experiment](../../candidates/opfs-shard-cache-v1/README.md) · [integration](https://github.com/check-face/facemorph.me/commit/caa17d1).

**5. PNG compression was taking longer than inference.** A worker component measured **213.9 → 32.3 ms** by using stored-deflate PNG output, with identical decoded pixels. The cost was **41% more bytes per saved original**. A smaller sub-filtered PNG took **371.3 ms** and was discarded. IndexedDB durability tuning saved only about 4.5 ms and was also discarded. The lesson is to profile the user's critical path and keep the storage tradeoff visible. [Integration](https://github.com/check-face/facemorph.me/commit/28ed9f3) · [measurements](../../results.tsv).

**6. Download and routing decisions are performance work.** Bounded read-ahead cut an eris acquisition component **6.665 → 5.438 s**; native hashing measured **924 → 112 ms** for its 150 MiB comparison. Probing an actual adapter rather than a `navigator.gpu` object avoided about 180 MiB of wasted Simulator downloads. WebGL's roughly 13 s S24 path lost to 2.582 s CPU-4: “GPU” was not a sufficient selection rule. These results are scoped by device, cache implementation and workload.

**7. Face reuse avoids the whole engine startup.** Today's repeated face avoided the model/worker entirely. Repeated video avoided synthesis but still took 1.18 s because retained frames pass through a new writer. The operator expects exact video repeats to be rare and accepts recomputing them: **finished-video caching is excluded from this round**. Retained-frame behavior remains historical evidence, not a new priority.

A separate first-impression gap is being fixed locally: the historic `hello` asset and public name/seed preview lookup are prepared but were **not in the reviewed live build**. The current check still starts with zero face images. This report's research-only push does not deploy those product edits. A hosted preview is display material, distinct from a newly generated canonical original and its morph latent.

## This round's queue: where we can improve the experience most

The operator asked to add **automatic cached-original restoration and fixing the download gate on cache hits** to this review's work queue, and explicitly permits bounded local caching of previously generated faces with automatic display on subsequent visits. Both are queued for the next delivery. This section records proposed work, not implemented or deployed fixes.

Updated operator direction: **warm hydration matters more than initial model downloads; `hello` should be instant; finished videos can be recomputed.** The operator observes current photo processing as a few seconds (device/cache state not yet recorded). The old 19.09 s encoder-acquisition observation does not establish today's bottleneck or rank photos above warm hydration.

| Order | Expensive part / observed cost | Work for this round | Confidence and limits |
| --- | --- | --- | --- |
| **1** | Finding and using existing faces. Explicit cache hits took **81.8 ms** in-session and **133.8 ms** after reload, yet the reviewed live UI arrived with no face images. | Show the bundled historic `hello` preview as soon as the UI appears, without model initialization or waiting for a catalogue request. Restore recent generated faces locally on subsequent visits; check verified originals **before** asking to download models. | Highest-confidence product gap. A valid original already avoids inference. Navigation-to-restored-face improvement remains to be measured; a hosted preview does not supply a canonical original or latent. |
| **2** | Warm hydration on a later visit: **643 ms model-loaded stage**, plus admission/setup and delivery. | Measure retained-model reads, verification, engine/session creation, upload/compile, admission and first user delivery under ordinary policy. Optimize the dominant avoidable step. Compare reload and fresh browser process. | Primary research lane. The **2.662 s retained** automated total includes seven webdriver canaries and is not an ordinary-user baseline. Existing OPFS work has already reduced paired loading **1,430 → 640 ms**; measure further gains against that current control. |
| **3** | Current first-photo processing with models retained; complete UI baseline still missing. | Measure upload/crop/alignment/e4e/reconstruction/display/save, then next photo, on the current artifact. Select an intervention only if a stage still dominates. | Operator reports a few seconds today. Historical **19.09 s acquire** on Mac and **12.09 s** eris encode + reconstruction have different dates/boundaries; neither is today's UI promise. Desktop encoder residency already exists; fp16 has no qualified win. |
| **4** | Already-warm desktop inference: **37.1 ms/morph frame** throughput; separately **75.6 ms single-face runtime latency**. | Keep kernels secondary to warm hydration and restoration. Report sequence throughput, single-request latency and displayed-face latency separately. | Both measurements are valid at different boundaries. Latest live warm UI faces took **190–208 ms** to decoded display; do not call 37 ms a single-request or UI latency. No desktop gain is assumed to transfer to phones. |

Initial model-download optimization remains in scope for future loops but is secondary this round. There is no new finished-MP4 cache task.

**Acceptance checklist for the cached-face item:**

- Add a cache-only lookup sharing the runtime's existing identity, image/latent integrity and shape validation. A miss returns without inference, admission, model downloads or speculative prefetch; calling normal `generate()` on field edits would not satisfy this.
- Restore the canonical original and latent into both UI and bridge state, enabling save/share and subsequent morphs. Check the original before the download gate for a requested face; a morph may still need models for uncached intermediate frames.
- For the current UI increment, restore the last completed generated result and useful settings through a small versioned index and bridge entry point, as specified in the [UI plan](../../../docs/plans/candidate-ui-2026-10-10.md#welcome-back-and-local-retention). Local caching of prior generated faces is permitted, but a full history/library is deferred. Record retention/eviction/removal behavior; avoid loading every retained full-size image eagerly.
- Reject late lookup results after an input edit, mode change or removal, including their bridge registration. An old face must not become the current face merely because its lookup finished last.
- Verify empty, retained, corrupt and evicted caches; rapid edits; reload; model-version changes; and storage unavailability. A small manifest request may still be needed for identity, so do not claim offline operation until measured.
- Record navigation-to-decoded-original and save availability, plus inference-worker/model-download counts. Keep the public preview's display-only status distinct from verified local-original reuse.

Alongside these priorities, collect bounded physical-phone first/repeat-visit evidence and reproduce the fresh-process GPU adapter refusal with the actual fallback route. These checks establish where optimization can help reliably; neither the Simulator nor desktop results establish phone performance.

The first concrete development task is item 1; the first research control is **ordinary-policy warm hydration**, followed by a paired experiment on its dominant stage. Current retained-model photo measurements determine whether photo processing should be the following experiment.

## Downloaded-media metadata: current delivery gap

**PNG and MP4 latent embedding is not live.** A fresh check of the candidate's HTML still references `app.6f67e921bae679214856.js`, matching the reviewed deployment [`b322a26`](https://github.com/check-face/facemorph.me/commit/b322a26858275f0e361127836d0fd1854e868ef9) and its [successful deployment run](https://github.com/check-face/facemorph.me/actions/runs/37886427733).

At that source, [`saveMedia` / `shareMedia`](https://github.com/check-face/facemorph.me/blob/b322a26858275f0e361127836d0fd1854e868ef9/src/Next/product-bridge.mjs#L303) pass the existing image/video blob directly to file delivery. [`saveFile` / `shareFile`](https://github.com/check-face/facemorph.me/blob/b322a26858275f0e361127836d0fd1854e868ef9/src/Next/media.mjs#L18) do not attach latents or project metadata. The PNG encoder writes image chunks; the video writer returns encoded MP4 bytes without attaching a morph project. Latents/provenance are retained separately in local storage, and the separate JSON project serialization carries morph control latents. That is not embedding in downloaded media. This is a source/export-path check tied to the live asset identity, not a fresh downloaded-file round-trip test.

Embedding is already required by [U-16](../../../docs/round-1-work-order.md) and identified as missing by [R3-22](../../../docs/round-3-plan-review-2026-09-23.md#r3-22--p0--contract--media-metadata-u-16-is-written-into-the-contracts-but-not-implemented-and-it-will-silently-void-an-e2e-gate). Keep it as a delivery gap: add latent/reproduction metadata at export, preserve canonical cache bytes, and verify re-import on both a retained-cache device and a cold second device. The cold second device still needs synthesis; it should bypass photo alignment/e4e. Existing authorization calls for default embedding, with no source photograph or typed value in the export. When implemented, use a metadata-free photo fixture to keep the e4e gate meaningful.

The planned recovery method remains documented: **numeric seed faces carry the seed, text/photo-derived faces carry W+ float32, and MP4s carry the morph project**. Re-upload inspects this metadata **before** crop/alignment/e4e or their download gate, validates the generation identity, then retrieves a verified local original or deliberately regenerates from seed/latent. No current reader in `selectPhoto` implements that dispatch; it follows the ordinary photo path. Targeted available-branch history checks found no implemented metadata writer/reader later removed. This is an unfinished export-and-recovery requirement, not evidence of a working feature being deleted. A file without metadata remains an ordinary photo; older clean downloads cannot recover metadata that was never written.

## Recent actual debug reporting: coverage check

A read-only query of the private diagnostics R2 bucket on 10 October listed **303 objects**. The bounded **8–9 October receipt window** contained **78 objects / 48 run IDs**, of which three lacked a start event within that window. Raw reports were processed in memory; no private report export or backup was added to Git. KV fallback records and GA4 were not queried, so this is not complete product traffic. Receipt time is not necessarily execution time because reports may be retried.

The live application bundle identifies itself as **`next-2ff6791800ad7dbf`**. Only **one** run in this window had that matching build identity: macOS / Chromium 151 / morph / auto, completed at **13,168 ms** on its diagnostic job timer, with model-loaded stages **465 / 824 ms** and 32 synthesis-complete events. The record includes admission and endpoint generation; frame count, exact GPU, cache state and compositor/video-ready boundary are not fully established. This is a recent reported job, **not** a warm-hydration baseline or a comparable eris sequence benchmark.

The recent photo example with a complete start event was on **`next-686bf8145648d399`**, macOS / Chromium 151: its job completed at **11,572 ms**, with alignment **5,857 ms**, encoder session creation **545 ms**, attributed encoder inference **3,876 ms**, and synthesis **521 ms**. It is a different application build and unspecified photo/cache state. It neither establishes today's first-photo latency nor proves/disproves the operator's few-seconds observation. The reported encoder inference itself was a few seconds; the whole reported job includes more work.

Other cohorts include macOS Chromium 154, Windows and Android on older build identities. They are kept separate: browser majors, selected routes, workloads and hardware are not interchangeable. Some Android/Windows run IDs contain both interrupted and completed outcomes, confirming the [UI plan review's lifecycle concern](../../../docs/plans/review-2026-10-10.md): do not compute a failure rate by counting terminal events without an idempotent request denominator.

**Decision:** recent reporting does not yet provide a matched current-build photo or warm-hydration baseline. Collect those under ordinary policy before making a current latency claim or choosing a causal performance change. Historical **37 ms/frame**, **75 ms single request**, and **19 s acquisition** figures remain labeled research/history; none becomes a universal current product value. See the [aligned research/UI handoff](next-pass.md) for the next pass's measurement and integration contract.

## What to collect next, before selecting the next optimization

The goal is now **navigation to a useful result on the first and nth visit**, not a single global ms/frame score. The following queue uses observed delays and keeps phone/native coverage in view.

| Priority / question | Information to collect | Decision it enables |
| --- | --- | --- |
| **1. Show retained results immediately on arrival** | Same device/browser: empty profile, retained model profile, retained original, retained morph, normal reload. Record first preview, original decoded/painted, exact-hit worker/download counts, navigation-to-save availability; include `hello`, a published name, a seed and an unpublished generated identity. Include a valid original with models absent and rapid input changes during lookup. | Distinguish missing preview coverage from missing automatic local-original restoration. Aim for zero inference/model initialization and no unnecessary model-download prompt on a valid original hit, then measure the UI saving. |
| **2. Explain the returning-visit gap** | Same artifact with ordinary admission versus forced test admission; canary scope explicitly recorded. Break down cache read/verify, upload, shader compile, mapping, first user synthesis and paint. Reproduce adapter absence in fresh process versus same-process reload with bounded retries and actual fallback outcome. | Decide among earlier/eager loading, fewer redundant reads, justified residency, admission-policy work, or environment/driver repair. Do not optimize seven test canaries as if every user pays for them. |
| **3. Current retained-model photo: bytes versus compute** | Actual UI upload → alignment → e4e → full1024 display → save, then next photo and identical re-upload. Separate network transfer from reading/verification of already retained bytes. Record encoder and synthesis providers independently, their overlap and memory. | Establish whether a current photo stage warrants an experiment after warm hydration. Revisit fp16 only with an explicit quality policy and browser E2E/memory evidence; the historical Node result does not answer current browser acquisition. |
| **4. Media metadata delivery gap** | Inspect saved PNG chunks and MP4 metadata, then re-import locally and on a second cold-cache device. Count alignment/encoder asset requests and stages; inspect provenance and latent integrity. | Verify the existing U-16 requirement after implementation; current exports do not embed these latents. |
| **5. Phone first/nth-visit coverage** | Bounded ordinary face/photo/default morph attempts on physical S24 and iPhone, exact build/engine, cold versus retained cache, selected fallback, interruptions, coarse memory/storage and playable/save outcome. Use existing consented reports and persist interrupted attempts before a heavy stage. | Establish which stage actually dominates each phone; do not extend desktop WGSL/OPFS speedups or Simulator success by analogy. |
| **6. Desktop ceiling, after larger startup/reuse questions** | Matched native/browser W+→RGBA and complete export on eris, full31, plus another real GPU. Keep frame counts, resolution, conversion and codec boundaries equal. | Decide whether another kernel/convolution change is worth pursuing versus export/UI work. Native batching beyond one has so far bought only about 2%. |

Start with a **measurement pass**, not a new kernel: fix the journey/cache-state definitions and establish paired controls on available hardware. Then select one causal change and measure ABBA with at least three observations per side under the lease. Record full31 and relevant workflow checks separately from performance screening. An interrupted, incompatible or unmeasured route remains a failure/gap, never a slow successful sample.

Three uncertainties deserve special attention: the historical approximately 1-second derivative stall after roughly 19 frames (not seen as a dominating stall in today's successful 32-frame run, but not disproved), Safari/iPhone OPFS and quota behavior, and the restarted eris adapter refusals. They can change the user's complete experience more than a few milliseconds shaved from an already warm desktop frame.

The local v3 loop proposal describes a broader future decision/evidence framework; it is not an implemented runner and is outside this report commit. Today's useful next decision is narrower: **show `hello` immediately, restore recent local faces automatically, and optimize ordinary-policy warm hydration before choosing another desktop kernel experiment**. Measure current photo processing next; finished-video caching is excluded by operator direction.

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
