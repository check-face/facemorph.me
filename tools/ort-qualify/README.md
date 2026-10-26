# ORT qualification against the product canaries (fm-bxwv)

`qualify.mjs` runs the frozen classic `src/Next` at commit `a42829bb0582b5a7a55ba6b1045a05861612b8a5`
in eris's Chromium on either the pinned runtime manifest or a variant.
The variant replaces only the six onnxruntime-web entries with a local release. The model, every canary input and
every reference stay pinned. The worker runs all seven product canaries at the fixed gates (RGB max ≤ 1, sampled
float ≤ 0.002). The variant's ORT files come from a real local HTTPS server with a self-signed certificate made for
the run; no request is intercepted.

```sh
npm pack onnxruntime-web@latest && tar -xzf onnxruntime-web-*.tgz    # in an empty directory
python3 autoresearch/run.py --timeout 3600 -- \
  node tools/ort-qualify/qualify.mjs --ort <dir>/package --routes cpu,webgpu-ort [--gpu-build webgpu|jspi|jsep]
```

Routes:
- **cpu:** ORT WASM.
- **webgpu-ort:** ORT on WebGPU, the engine phones use. On a desktop the runtime picks it only for a mobile user
  agent, so this route presents one. The GPU and the inference are real.
- **webgpu:** the desktop default, the direct WGSL engine. ORT is not on its path.

## Result on 24 October 2026 (eris, RTX 2080 SUPER, Chromium; all seven canaries pass at the gates)

Each cell is the largest sampled-float error over the seven canaries. RGB max was 1 on every route.

| ORT | CPU (WASM) | WebGPU, JSEP build | WebGPU, native EP build |
| --- | --- | --- | --- |
| pinned: 1.24.3 WASM, 1.22.0 WebGPU | 5.3e-6 | 1.9e-5 | — |
| 1.30.0 | 5.3e-6 (identical per canary) | 1.9e-5 (identical per canary) | 2.8e-5 |

From 1.23 on, `ort.webgpu.min.mjs` loads the native WebGPU execution provider (the asyncify build), and JSEP pairs
with `ort.min.mjs` (`--gpu-build`). `--gpu-build jspi` uses `ort.jspi.min.mjs` with its matching
`ort-wasm-simd-threaded.jspi.mjs` and `.wasm` files. Upstream deprecated JSEP in 1.29.

Every route JSON line, the summary and `--out` result include the same `provenance` object. It records the
classic source commit, exact qualifier and harness SHA-256 digests, the control manifest's SHA-256, and the
candidate manifest's SHA-256 over the exact bytes served. Release identity includes the npm package name,
version and exact `package.json` digest; the pinned control instead names its separate CPU and WebGPU versions.
The selected GPU build and all six asset digests/sizes identify the staged runtime. `runtimeSetSha256` binds
that release and asset set independently of the run's local serving port; `candidateManifestSha256` includes
the actual local URLs and therefore changes when the port changes.

This remains a classic synthesis-canary qualifier. It does not establish monorepo engine compatibility or
qualify the separate 108-shard encoder runtime and its 256 MiB unshared heap contract.

Shipping the runtime mirror is fm-qeh's job: manifest, digests, the e2e lane's `runtime_sha`, the paired performance
comparison and the phone lanes. Physical-phone numerics are untested here.
