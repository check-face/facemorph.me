# Browser product runtime — integration candidate

`runtime.mjs` exports `createBrowserRuntime({manifest?,manifestSha256?,manifestUrl?,onProgress?,alignPhoto?,preferredRoute?})`.
Default manifest URL is `/runtime/manifest.json`. The product supplies its deployment
manifest, never asks users to configure model URLs. One operation may run at once.

- `generate({mode:'seed'|'text',value,signal?,onProgress?})` resolves a complete face.
- `synthesize({space:'w-plus',shape:[1,18,512],values:Float32Array}, {signal?,onProgress?,persist?})` resolves a face from explicit W+; use `persist:false` for transient video frames.
- `encodePhoto(blob,{signal?,onProgress?})` needs a real browser `alignPhoto(blob,options)` implementation yielding `{tensor:Float32Array}` in normalized NCHW `[1,3,256,256]`. No HTTP upload or precomputed latent substitution occurs. It invokes the actual ONNX e4e encoder, then releases that session before synthesis; latent-average is already in the encoder, so mapping/truncation is bypassed.
- `qualify('cpu'|'webgl'|'webgpu',options)` explicitly runs numerical canaries. Ordinary generation first checks persisted originals, then lazily qualifies on a miss. Result distinguishes `deviceValidated` from `releaseQualified`; never map a screening-only result to a production release certificate.
- `cancel()` terminates the worker, invalidates admission and rejects active inference after termination. Saved originals remain. `dispose()` additionally closes the database.

Face result: `{blob,latent:{space:'w-plus',shape:[18,512],values},values,space:'w-plus',shape:[1,18,512],width:1024,height:1024,provenance,cached,imageSha256,latentSha256}`.
The Blob is a canonical lossless PNG. UI owns/revokes its object URLs. Explicit seed
numbers and UTF-8 text preserve legacy NumPy RandomState semantics; text is **not**
automatically lowercased. The names catalogue caller must apply its historic lowercase
mapping. Six complete512-vector fixtures match independent NumPy output byte-for-byte.

Progress has a machine `stage`, optionally `loaded/total`, `name` or `elapsedMs`.
Stages include asset-acquisition, runtime-loading, model-loading/model-loaded,
canary, mapping-loading/mapping, alignment, encoder-loading/encoding,
synthesis/synthesis-complete, original-cache-hit/original-cached/transient-frame,
cache-unavailable and original-cache-invalid. Observers must not log input values,
photos or latents. No telemetry is sent by this module.

## Asset staging

From workspace root:

```
python3 facemorph.me/src/Next/browser/stage-assets.py \
  --base-url https://YOUR-ORIGIN/runtime --output /path/to/stage/runtime
```

`--webgpu` includes the qualified-research desktop WebGPU model/runtime/kernel bundle. `--webgl` includes the frozen block-stream GPU assets. `--landmarks` includes the original dlib68 model for the separately implemented alignment adapter. FFmpeg descriptors are included when the pinned local codec exists. `--all31` stages the full fixed synthesis suite; default seven endpoint/noise/truncation
canaries are device screening. `--encoder /path/to/encoder.onnx` includes a freshly exported monolithic
e4e model; **do not enable it on phones without a bounded-memory implementation and
qualified admission policy**. Every asset is copied to a SHA256-addressed URL and
verified after copying. Keep `sources.private.json` out of deployment (local provenance
paths). Output `manifest.json` always starts `releaseQualified:false`.

Serve the compiled frontend/modules and this asset tree over HTTPS. Send correct JS,
WASM/JSON/PNG MIME types, immutable long-lived asset caching, and the intended COOP/COEP
headers; cross-origin asset hosts must permit CORS and the chosen embedding policy.
The existing persistent model cache verifies model/fixture SHA256 and byte count,
retains assets across app versions, and independently verifies consumption. Runtime
JS/WASM bytes are also verified through the persistent cache and imported from
Blob URLs, avoiding an unchecked second network fetch. The owning worker lifetime
bounds those URLs; cancellation releases the entire worker.
Transport URLs and screening metadata are excluded from canonical generation identity. Original PNG and latent commit atomically in IndexedDB. Cached bytes are checked on
reuse; storage failure preserves the generated result and reports reduced persistence.

## Current gaps — do not advertise as complete

CPU mapping+synthesis and the pinned pure WebGL vector16 synthesis engine are integrated.
Seed mapping remains CPU WASM even when synthesis uses WebGL; providers are explicit.
The WebGL module and coefficients are verified and retained through the persistent
asset cache, without modifying the frozen kernel implementation. The ordinary WebGPUv9 split model and unchanged WGSL resampling kernel are integrated with verified ORT1.22 JSEP assets. Its >128MiB binding requirement is checked before loading. Device loss invalidates the route. Numerical semantics tests are distinct from real browser evidence. Browser-only
alignment has no existing reusable implementation: the earlier e4e demo delegates
`/prepare` to native dlib/Pillow. The encoder was re-exported on16 September and can be staged explicitly. The monolithic encoder is not a memory-bounded phone
route. A real alignment module, bounded encoder and photo qualification remain required.
Synthesis/encoder memory admission must be qualified per target; a canary may itself
expose a browser allocation failure, and no universal phone reliability is asserted.
Full31, cancellation/cache/reload/export and target evidence gate release separately.

Run the bounded semantic regressions with `node --test src/Next/browser/runtime.test.mjs`
from the frontend repo. Heavy inference/builds must use the shared local-Mac lease.

Local TLS test server: `serve-local.py --assets STAGE/runtime --cert CERT --key KEY` serves `https://localhost:8443/runtime-test.html`, source runtime modules and the final `deploy-next` artifact. It excludes private provenance and directory listing; it is not a public server. Run it under the shared device lease while measuring. Never change host certificate trust for this test.

Actual16 September Chrome smoke evidence lives in `evidence/`: CPU generated seed0 and reopened its original without model initialization; WebGL passed seven strict numerical canaries and then reused that admitted original. These are component integration checks, not physical-phone or whole-product qualification. `smoke-provenance.json` pins exact tested sources; subsequent verified-Blob runtime import hardening requires a fresh browser run.

The WebGPU adapter subsequently passed all31 strict numerical cases and actual fresh seed2 generation, then reopened the saved canonical original without a worker. See `evidence/webgpu-full31-smoke.json` and its source-pinned provenance. Verified Blob runtime loading was exercised for both GPU synthesis and CPU seed mapping. Initial hidden state and later focus emulation make timings unsuitable for speed claims. This remains runtime integration evidence, not a whole-product or physical-phone certificate.

`preferredRoute` defaults to `auto`: cache-first, then WebGPU when exposed, otherwise WebGL when available, otherwise CPU. Capability-incompatible WebGPU can try WebGL; a failed numerical/GPU route falls back once to independently canary-checked CPU. Explicit routes remain selectable for tests. An interrupted-job marker lives in sessionStorage (no inputs), survives reload, and avoids automatic repetition of the interrupted route. Explicit qualification permits deliberate retry. Photo encoding uses three disposable worker lifetimes (alignment, encoder, synthesis); monolithic encoders over512MiB are refused on phones before worker/alignment allocation. The bounded real encoder remains an outstanding integration/qualification gate.

When supplying a pre-fetched manifest, also pass `manifestSha256` computed from the exact response bytes. Without it, the adapter fetches the manifest URL to verify equality and hash exact bytes. Browser and native portable-project bundle IDs therefore use the same file-byte digest, not different JSON serialization digests. Canonical original identity remains independent of transport URLs and fixture selection.
