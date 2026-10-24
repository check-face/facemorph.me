# ORT qualification against the product canaries (fm-bxwv)

`qualify.mjs` runs the candidate's own runtime in eris's Chromium on either the pinned runtime manifest or a variant.
The variant replaces only the six onnxruntime-web entries with a local release. The model, every canary input and
every reference stay pinned. The worker runs all seven product canaries at the fixed gates (RGB max ≤ 1, sampled
float ≤ 0.002). The variant's ORT files come from a real local HTTPS server with a self-signed certificate made for
the run; no request is intercepted.

```sh
npm pack onnxruntime-web@latest && tar -xzf onnxruntime-web-*.tgz    # in an empty directory
python3 autoresearch/run.py --lane browser-gpu --device eris --wait 1800 --timeout 3600 -- \
  node tools/ort-qualify/qualify.mjs --ort <dir>/package --routes cpu,webgpu-ort [--gpu-build webgpu|jsep]
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
with `ort.min.mjs` (`--gpu-build`). Upstream deprecated JSEP in 1.29.

Shipping the runtime mirror is fm-qeh's job: manifest, digests, the e2e lane's `runtime_sha`, the paired performance
comparison and the phone lanes. Physical-phone numerics are untested here.
