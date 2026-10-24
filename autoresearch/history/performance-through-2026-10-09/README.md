# FaceMorph performance history through 9 October 2026

This archive preserves the optimization story and each measurement's original scope. It ends before the **10 October review round**. It contains no active queue, current-build claims, or new round observations. See the separate [current review](../../reviews/2026-10-10/README.md) for recent reporting and next experiments.

The strongest recorded desktop story is that we first overlapped GPU and CPU work, then improved the GPU kernels, then reduced output transfers. Returning visits also improved when cached model bytes became cheaper to read and verify. These are dated research results; integration links show where code landed, while deployed user latency requires its own evidence.

## Recorded performance jumps

Each row is its own control/candidate comparison. Controls were remeasured between experiments, so this table is not a single uninterrupted benchmark series.

| Recorded period | Change / measured boundary | Control → candidate | Scope and qualification |
| --- | --- | --- | --- |
| Integration 7 October; measurement date not retained | Stored-deflate PNG, 1024 RGBA encoding component | **213.9 → 32.3 ms** | Identical decoded pixels; **+41% bytes**. Projected UI gain not qualified. |
| 8 October | Morph scheduling, product runtime/worker | **129.8 → 69.7 ms/frame** | eris RTX 2080 SUPER, Chromium 152, ABBA ×4; built UI/video and phones not measured by this pair. |
| 8 October | Direct WGSL engine, product runtime/worker | **69.5 → 40.1 ms/frame** | ABBA ×3, **contended load 4–6**; seven canaries, full31 unavailable on eris. Integration is distinct from this limited timing evidence. |
| 8 October | GPU RGBA8 conversion/readback | **42.6 → 37.1 ms/frame**; warm single runtime **103.5 → 75.6 ms** | ABBA ×4, compared PNGs exact, seven canaries. Throughput and single-request latency differ; neither measures decoded UI. |
| 8 October | OPFS retained model read/verify | **1,430 → 640 ms** model-loaded; **1,685 → 859 ms** first qualification synthesis | Warm profile, ABBA ×4; later pairs contended. First qualification synthesis is not a displayed user face. |
| 8 October | OPFS first prepared photo encode + reconstruction | **17,627 → 12,093 ms** | Excludes upload/alignment/UI. Second photo **9,468 → ~10,070 ms**, no gain established. |

The often-cited **37 ms** is morph-frame throughput from this 8 October runtime experiment. The paired **75.6 ms** is a separate single-face runtime measurement. Neither is a universal current-product inference or display promise.

## Historical native API baseline

| Workload | Recorded result | What the timer includes / excludes |
| --- | --- | --- |
| GPU generation, normalized per image | **56.1 ms** over 1 day; **56.8 ms** over 7/30/90 days | 8 October Prometheus observation: generator-call time divided by images generated. Includes mapping/truncation and PIL conversion; excludes HTTP round trip and finished video. Five-minute windows: p10 56.0, median 57.3, p90 62.2 ms. |
| One uncached 1024px WebP request | **530 ms median**, range **385–865 ms**, 8 requests | Earlier client wall measurement from the operator's Mac, including about 141 ms RTT, queueing and response production. An unpaired observation, not a GPU-only single-image test. |
| Batched queue | Up to **10 images/call**, about **4 on average** in the sampled period | A Grafana generator line is per **call/batch**, not per image. Calls with at least four images averaged about 297 ms while the per-image ratio stayed about 56.6 ms. Batching is not a 4× acceleration claim. |
| Uncached 26-output-frame, 1024px MP4 | **3.10 / 2.88 / 2.96 seconds** wall from eris | Three 8 October API requests. The trigonometric schedule deduplicated to **14 unique generated images**; ffmpeg was about **1.15 seconds/MP4** in that window. The approximately 113 ms/output-frame wall ratio includes much more than synthesis. |
| First visit/startup | **No client model download** | The server already owns resident models. A cold server-process startup and classic navigation-to-preview were not measured here; neither is “0 ms.” |

[Native/API baseline explanation and reproduction](../../candidates/native-cuda-morph-v1/README.md) · [evaluation ledger](../../results.tsv).

## Historical device coverage

This is the available matrix, including failures and useful controls. The API's compute speed is determined by its server; it does not acquire a different GPU timing for each client phone. Client-network observations are attributed above.

| Device / route | Earlier control or starting point | Recorded single / sequence value (historical) | Initial-use and video evidence / limits |
| --- | --- | --- | --- |
| **eris, RTX 2080 SUPER, Linux, Chromium 152, browser WebGPU** | Earlier deployed warm face: **388 ms to image URL assignment**; ORT sequence **129.8 ms/frame** before pipelining | 8 October paired runtime: **75.6 ms warm face**, **37.1 ms/morph frame** after direct WGSL + GPU RGBA8 | Runtime/worker boundary, not decoded UI or completed video. Warm loading **1,430 → 640 ms** in the separate OPFS pair; first qualification synthesis **1,685 → 859 ms**. |
| **eris, same GPU, native PyTorch CUDA** | Conservative self-host settings **44.4–44.6 ms/frame** | CUDA plugins + fused modulated convolution: **30.7–31.1 ms/frame** at batch 1; **30.1–30.8** at batch 4 | Same 26-frame W+ path, output to host uint8 RGB. No PNG/UI/video/network tail. Native variants agreed within one RGB level; browser-versus-native reference comparison was not done. Batch 10 ran out of memory beside desktop apps. |
| **Mac ARM64, browser WebGPU** | Chrome 144 historical sequence about **486 ms/face**; newer controls about **294–327 ms** | Historical Chrome 151/Brave matrix about **254–300 ms/face**; ledger v9 sequence **277.9 ms/face**. These are sequence averages, not measured single-face medians | Full31 reported for applicable GPU runs; browser-version/environment changes make these unpaired. No same-build first-face or finished-video latency for this device. |
| **Mac ARM64, browser WASM CPU** | Historical four-thread control **25.7 s/face** in the matrix; single-thread v9 screen **43.91 s/face** | Another product-era CPU-4 observation was **22.9 s for two faces** (about 11.45 s/face); different environments/scopes, **no paired improvement** | The single-thread row is only 3-case screening. No same-build CPU/photo/video or startup speed claim. |
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

## Historical photo stage evidence

| Evidence / stage | Earlier measured cost | Result and limit at the recorded boundary |
| --- | --- | --- |
| Mac desktop browser streamed e4e, first aligned synthetic photo | Alignment **12.37 s**, encoder **24.83 s**; encoder phase sums: **19.09 s acquire**, **0.755 s create**, **4.364 s inference** | Acquisition is **79% of the three attributed encoder phases**. This is a photo-runtime qualification page, not complete upload-to-displayed-reconstruction latency. |
| eris first photo in a session, models already retained | **17.627 s** encode + reconstructed face | OPFS candidate **12.093 s**, about **5.53 s saved**. Second photo about **9.47 → 10.07 s**, no established improvement. Fixed prepared photo benchmark, not complete new upload/alignment/UI. |
| iOS Simulator streamed encoder | Historical attributed phases about **25.3 s acquire / 0.5 s create / 4.6 s inference**; another retained report totals **32.5–41.8 s encoder** across fixtures | Different transport/run states; no refreshed October Simulator control. Never label these handset timings. |
| fp16 encoder experiment, Mac Node/WASM | fp32 **5.608 s** | fp16 **5.679 s**; matched 108-shard variant **6.273 s**. Weight bytes nearly halve, but session creation/heap worsen and W+ error fails the existing 1e-4 gate. **Not promoted.** |

[Desktop raw photo evidence](../../../photo-runtime/evidence/desktop-browser-five-photos.json) · [Simulator raw evidence](../../../photo-runtime/evidence/sim-photo-927e4446-d5db-49aa-9d6e-b9dcc6d20204/report.json) · [OPFS experiment and sample arrays](../../candidates/opfs-shard-cache-v1/README.md) · [fp16 ledger rows](../../results.tsv).


## What changed and why it mattered

**1. We stopped making the GPU wait for the CPU.** An ordinary morph initially spent about 62 ms on GPU work and then about 55 ms on a serial readback/PNG/derivative tail. Queuing the next frame while processing the previous frame took the product-runtime sequence **129.8 → 69.7 ms/frame**, a **1.86×** throughput gain. This is scheduling, not reduced resolution. [Experiment](../../candidates/morph-frame-pipeline-v1/README.md).

**2. On 8 October, the native baseline changed the research question.** Native CUDA on the same RTX 2080 SUPER produced host RGB in about 31 ms, while the pipelined browser still took about 70 ms/frame. The remaining gap was mainly GPU kernels. Tiled direct WGSL convolution and fused work brought browser frames to **40.1 ms** in a contended load-4–6 ABBA series, followed by GPU RGBA8 conversion to **37.1 ms**. The browser's output tail and native host-RGB endpoint still differ; “browser beat native” is not established. [Direct-engine integration](https://github.com/check-face/facemorph.me/commit/ea8450b) · [RGBA8 integration](https://github.com/check-face/facemorph.me/commit/38f62fb).

**3. On 8 October, smaller transfers mattered after the kernels got faster.** Float readback was 12 MB/frame. Converting to RGBA8 on the GPU brought that to 4 MB and removed the CPU conversion loop, improving the paired warm face **103.5 → 75.6 ms**. A first implementation exposed floating-point contraction differences at exact rounding boundaries; preserving the original two-rounding behavior made the compared frames exact. This is a useful example of validating a small output change rather than assuming it is harmless.

**4. On 8 October, a “cached model” was still expensive to use.** OPFS unit files plus native SHA-256 verification reduced paired warm model loading **1,430 → 640 ms**, first qualification synthesis **1,685 → 859 ms**, and first photo **17.63 → 12.09 s**. Integrity is checked when bytes are read; a durable “verified” flag does not excuse checking changed bytes. Later OPFS pairs ran under load 6.4–7.1, limiting the historical keep claim. The same work repairs an individual corrupt unit rather than re-fetching an entire large asset. Chromium/Firefox storage behavior was measured; Safari/physical-phone OPFS still needs its own evidence. [Experiment](../../candidates/opfs-shard-cache-v1/README.md) · [integration](https://github.com/check-face/facemorph.me/commit/caa17d1).

**5. PNG compression was taking longer than inference.** A worker component measured **213.9 → 32.3 ms** by using stored-deflate PNG output, with identical decoded pixels. The cost was **41% more bytes per saved original**. This is an encoding-component result; the projected displayed-face gain was not product-qualified. The integration commit is dated 7 October; the exact measurement date is not retained in the ledger. A smaller sub-filtered PNG took **371.3 ms** and was discarded. IndexedDB durability tuning saved only about 4.5 ms and was also discarded. The lesson is to profile the user's critical path and keep the storage tradeoff visible. [Integration](https://github.com/check-face/facemorph.me/commit/28ed9f3) · [measurements](../../results.tsv).

**6. Download and routing decisions are performance work.** Bounded read-ahead cut an eris acquisition component **6.665 → 5.438 s**; native hashing measured **924 → 112 ms** for its 150 MiB comparison. Probing an actual adapter rather than a `navigator.gpu` object avoided about 180 MiB of wasted Simulator downloads. WebGL's roughly 13 s S24 path lost to 2.582 s CPU-4: “GPU” was not a sufficient selection rule. These results are scoped by device, cache implementation and workload.
