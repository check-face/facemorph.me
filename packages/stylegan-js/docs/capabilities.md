# stylegan-js capability table

What the library itself, `@facemorph/stylegan-js` used with no model manager and no app, is qualified to do. It is
separate from the FaceMorph app's product routes, whose release cells (eris Chrome and Firefox, the Huawei P30 Pro,
CPU and WebGPU) belong to the release Beads and are run against the deployed app, not this package.

A cell is **qualified** only where a real run on the stated browser and provider passed every product canary at the
frozen gate (max RGB difference 1 on 0-255, max sampled raw-float error 0.002; `PRODUCT_CANARY_TOLERANCE`) against
the runtime's independent references, with zero engine-initiated requests. Anything else says **unqualified** and
why. Falling back to the CPU never counts as a WebGPU pass.

Recorded 26 October 2026 on eris (Linux x64, 12 cores, NVIDIA GeForce RTX 2080 SUPER, driver 610.57.04), with the
pinned runtime (manifest SHA-256 `d9e37e50…0a5c`, ORT web 1.24.3 from the manifest's own bytes) and this package's
working tree based on commit `b9c878f`. Max values are over all seven product canaries unless stated.

## Browser providers

| Provider (engine)                     | Browser                                          | Status                                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CPU (`ort-wasm`, 4 threads, isolated) | Playwright Chromium 156.0.8078.4, Linux headless | Qualified                                      | `test/engine/browsers.test.ts`: 7/7 canaries, max RGB 1, max float 5.30e-6, faces 3.5-4.0 s, zero engine requests, sessions released. `test/engine/caller-loaded-example.test.ts` (packed tarball in a clean project, no manager): 7/7 admission canaries max RGB 1, float 5.30e-6; five original-noise canary latents through public `synthesize`, compared outside the package: max RGB 1/255, max float 4.95e-6 over 4091 samples; faces 3.2-4.0 s. |
| CPU (`ort-wasm`, 4 threads)           | Playwright Firefox 157.0, Linux headless         | Qualified                                      | `browsers.test.ts`: 7/7 canaries, max RGB 1, max float 5.30e-6, faces 3.2-3.4 s, zero engine requests, released. The caller-loaded example has not been run here.                                                                                                                                                                                                                                                                                              |
| CPU (`ort-wasm`, 4 threads)           | Playwright WebKit 27.2, Linux headless           | Qualified                                      | `browsers.test.ts`: 7/7 canaries, max RGB 1, max float 5.30e-6, faces 2.0-2.1 s, zero engine requests, released. The caller-loaded example has not been run here.                                                                                                                                                                                                                                                                                              |
| WebGPU (`ort-webgpu`, ORT EP)         | System Chromium 152.0.7977.82, headed, Vulkan    | Qualified (desktop NVIDIA only)                | `browsers.test.ts`: 7/7 canaries, max RGB 1, max float 1.87e-5, `map-async-complete` timings, pipelined sequence, real GPU-process crash settles `route-failed`/`device-loss` and releases everything. The first attempt in the full run timed out loading its probe page (harness `waitForFunction`, before any engine code); the rerun of the cell passed. Caller-loaded example: 7/7 admission canaries max float 1.87e-5; five reference latents through public `synthesize`: max RGB 1/255, max float 1.87e-5. |
| WebGPU (`direct-webgpu`, WGSL)        | System Chromium 152.0.7977.82, headed, Vulkan    | Qualified (desktop NVIDIA only)                | `browsers.test.ts`: 7/7 canaries, max RGB 1, max float 2.64e-5, faces 84-91 ms, device loss settles typed. Not reachable from the caller-loaded example, which uses the ORT engine.                                                                                                                                                                                                                                                                            |
| WebGPU, any engine                    | Firefox, WebKit/Safari                           | Unqualified                                    | Not run: the WebGPU harness cells launch Chromium only.                                                                                                                                                                                                                                                                                                                                                                                                        |
| WebGPU, any engine                    | Other GPUs (Intel, AMD, Apple, mobile)           | Unqualified                                    | Not run by the library harness. The Intel UHD 730 on the same host was not selected.                                                                                                                                                                                                                                                                                                                                                                          |
| CPU or WebGPU                         | Android Chrome, iOS Safari, any real phone       | Unqualified                                    | The library harness has not run on a device. Phone evidence exists only for the app's product routes (release Beads), which is not library qualification.                                                                                                                                                                                                                                                                                                       |
| CPU or WebGPU                         | macOS and Windows desktop browsers               | Unqualified                                    | Not run by the library harness.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Any                                   | Hosted CI runners                                | Unqualified (cells report untested)            | CI's `npm test -w packages/stylegan-js` (contracts-m1, runner triton) has no acquired runtime, so every real-model cell reports `untested: the candidate runtime is not acquired here` (main run 40271140557). Only the packed-surface and model-free tests execute there.                                                                                                                                                                                    |

## Outside the browser

| Target                            | Status                        | Evidence                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js (onnxruntime-web 1.30.0 WASM) | Unqualified: test harness only | `test/engine/cpu.test.ts` drives the CPU adapter in Node 24.21.0 with the caller handing in the npm ORT module: 11/11 pass, 7/7 canaries max RGB 1, max float 5.30e-6. That is a reference harness for this package's tests; Node or headless inference is not a supported or documented consumer target. |
| Native distribution               | Not applicable                | The package ships emitted ES modules and declarations only (`files: ["dist"]`); there is no native build or requirement.                                                                                                                                                                       |

## What every qualified cell also shows

- Construction and status reads start nothing: the caller-loaded test counts zero requests of any host class while
  a demo is constructed and `status()` is read, and the model host's own access log does not move.
- Every model byte is a caller read: after construction, each intercepted request is a model-host request that the
  example's reader logged (CPU: 50 requests, 158.1 MiB, for 50 logged reads; WebGPU ORT: 60 requests, 212.1 MiB),
  plus `blob:` imports of the verified ORT runtime bytes (class `local`). No app, third-party, collector or
  names-host request. Dispose makes no request.
- Abort and errors settle typed: an aborted load is `route-failed` with cause `aborted`, a missing manifest
  `route-failed`/`cache-miss`, an aborted synthesis `cancelled`, a malformed latent or seed `invalid-request`.

## Rerunning

```sh
npm run build -w packages/stylegan-js -w packages/browser-model-manager
node --test packages/stylegan-js/test/engine/browsers.test.ts
node --test packages/stylegan-js/test/engine/caller-loaded-example.test.ts
node --test packages/stylegan-js/test/engine/cpu.test.ts
```

The runtime must be acquired (`scripts/runtime/acquire.mjs`; `FACEMORPH_RUNTIME_CACHE` names the directory). Where
it is not, or the browser or a hardware adapter is missing, the cell reports untested and this table must say
unqualified.
