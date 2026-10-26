# model-conv compatibility

What model-conv has actually been run on. Do not assume a StyleGAN checkpoint converts because it is listed
upstream: NVIDIA's catalogue includes conditional and StyleGAN3 models, and that says nothing about this
converter. Cells are **qualified** (a recorded `convert` + `verify` pass), **unqualified** (plausible, never
run), **unsupported** (fails, with the reason) or **untested**.

> A checkpoint is a Python pickle: loading it runs code. Convert only checkpoints you trust.

## Checkpoints

| Checkpoint | Source format | Architecture | Cond. | Resolution / channels | Z / W / W+ | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FFHQ config-F, `stylegan2-ffhq-config-f.pkl`, SHA-256 `adf127ea…948d` ([NVIDIA](https://nvlabs-fi-cdn.nvidia.com/stylegan2/networks/stylegan2-ffhq-config-f.pkl)) | TF1 pickle, read by upstream `legacy.load_network_pkl` | StyleGAN2 config-F | no | 1024 / 3 | 512 / 512 / 18 | **qualified** (CPU) | [CI run 40081852041](https://github.com/facemorph-me/facemorph.me/actions/runs/40081852041) (`tests/acceptance.sh` on eris); raw 1.2e-4 ≤ 0.002, RGB 1 ≤ 1; product canaries 7/7 (RGB 1 ≤ 1, sampled float ≤ 6.2e-6 ≤ 0.002, lease run `20261024T120354Z-9a32f5e3`); component load in the candidate harness on CPU passed (`tests/component_load.py`, eris) |
| Other StyleGAN2 TF1 pickles (FFHQ 256/512, LSUN…) | TF1 pickle | StyleGAN2 | no | other | other | **unqualified**: needs a declaration in `models.py` with its own tolerance, then a run | none |
| Other stylegan2-ada-pytorch `.pkl` (PyTorch pickles) | PyTorch pickle | StyleGAN2-ADA | no | any | any | **unqualified**: each needs a declaration with its own tolerance, then a run (AFHQ cat is the one run) | none |
| Conditional models (e.g. CIFAR-10, `c_dim > 0`) | either | StyleGAN2 | yes | any | any | **unsupported** (from the code, not run): export passes no class label (`c = None`); the mapping graph would need a `c` input | none |
| StyleGAN3 (`-t`, `-r`) | PyTorch pickle | StyleGAN3 | either | any | any | **unsupported** (from the code, not run): no per-layer constant noise planes, so the export would refuse with "checkpoint noise planes differ from the declaration" | none |
| AFHQ cat, `afhqcat.pkl`, SHA-256 `f62fd750…3a29` ([NVIDIA](https://nvlabs-fi-cdn.nvidia.com/stylegan2-ada-pytorch/pretrained/afhqcat.pkl)) | PyTorch pickle, read by upstream `legacy.load_network_pkl` | StyleGAN2-ADA | no | 512 / 3 | 512 / 512 / 16 | **qualified** conversion (CPU); non-face **support unqualified** until the joint proof (`verify.packages`) passes | eris lease run `20261024T115628Z-b6d0f86b`: raw 6.6e-5 ≤ 1e-3 (its own tolerance, declared from its reference), RGB 1 ≤ 1; manifest valid against `model-manifest.v1.schema.json` |

FFHQ terms: the checkpoint is NVIDIA's under the NVIDIA Source Code License-NC; FFHQ images are CC BY-NC-SA 4.0.
AFHQ cat terms: the checkpoint is NVIDIA's under the NVIDIA Source Code License-NC (stylegan2-ada-pytorch); AFHQ
images are CC BY-NC 4.0. Neither checkpoint is bundled or redistributed; acquire each yourself under its terms.
Converted artifacts carry the terms of the checkpoint they came from.

## Precision, operators and providers

| | Status |
| --- | --- |
| FP32 export, opset 17, ONNX Runtime CPU (1.24.3) parity against upstream PyTorch reference ops | **qualified** (FFHQ, [run 40081852041](https://github.com/facemorph-me/facemorph.me/actions/runs/40081852041)) |
| Graph rewrites: identity Pad/Slice removal, zero-Pad folding, precomputed demodulation energy (FP64 → FP32) | **qualified** inside the FFHQ parity run |
| Research suites (full31) at their own frozen tolerances | **untested** here: their fixed references are not in either repository; the product canaries and the upstream-reference parity above cover the frozen product gates |
| FP16 or mixed precision | **unsupported**: not produced; never widen the frozen tolerance to admit it |
| Browser WASM / WebGPU providers on the converted artifact | **untested** here; the providers qualify it (the FFHQ mapping is byte-identical to the shipped one) |

## Platforms

| OS / arch | Container | Status |
| --- | --- | --- |
| Linux x86-64, Docker 29, CPU | `facemorph/model-conv` | **qualified** (eris, [run 40081852041](https://github.com/facemorph-me/facemorph.me/actions/runs/40081852041)) |
| NVIDIA GPU profile (CUDA PyTorch) | none yet | **untested**: no GPU profile exists; conversion is CPU-only by design |
| Linux arm64, macOS, Windows | | **untested** |

## Photo encoders

Turning a photo into a latent needs a separately trained encoder compatible with the generator. FFHQ e4e
works only for the FFHQ face generator; it is not a generic encoder for non-face models. `convert-encoder` and
`verify-encoder` (ported from classic `e4e_export.py` and `photo-runtime/encoder-stream/export.py`, see
`PROVENANCE.json`) were run on eris, 24 October 2026, in the container (torch 2.14.0+cpu, onnx 1.19.1, ONNX Runtime
1.24.3), against the frozen max abs W+ error of 0.0001.

| Checkpoint | Output | Status | Evidence |
| --- | --- | --- | --- |
| e4e FFHQ, `e4e_ffhq_encode.pt`, SHA-256 `2ace1d9a…0999`, 1,201,649,680 bytes (Google Drive link in [omertov/encoder4editing](https://github.com/omertov/encoder4editing); code MIT, model trained on FFHQ, CC BY-NC-SA 4.0; never bundled) | `encoder.onnx` and 108-session encoder stream | **conversion qualified by identical digests** (encoder and all 108 sessions byte-identical to the hosted, qualified artifacts). Numerical W+ parity on x86-64 ONNX Runtime CPU: 4 of 5 inputs within 4.0e-6; `no-face-aligned` 1.07e-4 > 1e-4, a property of the hosted encoder on this platform (finding below) | convert run `20261024T120512Z-c1d35002`; verify run `20261024T122145Z-0ff6d906` (`paritySatisfiedBy`: identical digests) |

Measured, against the PyTorch e4e built from the original checkpoint (never from converted files):

- **Digests.** `encoder.onnx` is byte-identical to the hosted artifact: SHA-256
  `d525a985a43e4d49ef4590a8b8cc6f487992065bee00014fe8c6f8ab4ac291b1`, 1,068,862,265 bytes (same torch 2.14.0 and
  opset 17 `dynamo=False` export; the export is deterministic here). The stream is identical too: 108 sessions,
  all 108 `part-NNN.onnx` files byte-identical to the hosted ones, identical partitioning and boundary specs, 1,723
  source nodes, `maxShardBytes` 16,682,645. The model-conv stream `manifest.json` differs from the hosted
  manifest (SHA-256 `3d27df84…60bf`) only by fields the hosting stage adds (`runtime`, `executor`, `canaries`,
  `preprocessingSha256`, `qualifiedReferenceEvidence`, `browserQualified`, `qualification` text) and a per-step `url`;
  every other per-step field (digests, sizes, node ranges, boundaries, `releaseAfter`, liveness) is identical.
  Nondeterministic fields: none found in the ONNX files;
  model-conv's own `manifest.json` carries run-specific `provenance.seconds` and the image digest.
- **Stream equals full.** On every case the sequential stream and the full ONNX produced identical W+ (max
  difference 0.0).
- **W+ error, max abs / mean abs, full ONNX = stream, product session options** (single thread, no CPU arena or memory
  pattern, prepacking disabled, as the browser creates them; ORT defaults give the same pass/fail):

| Case | vs PyTorch reference | vs recorded classic reference | at most 1e-4 |
| --- | --- | --- | --- |
| seed-0-aligned | 3.1e-6 / 3.2e-7 | 2.4e-6 | yes |
| seed-0-unaligned | 2.4e-6 / 3.7e-7 | 2.8e-6 | yes |
| seed-1-aligned | 2.2e-6 / 2.8e-7 | 2.7e-6 | yes |
| seed-1-unaligned | 2.4e-6 / 3.0e-7 | 3.0e-6 | yes |
| no-face-aligned | **1.07e-4** / 1.9e-5 | **1.07e-4** | **no** |

  The PyTorch reference agrees with the recorded classic reference to 4.1e-6 on all five cases, so the reference is
  sound. Classic recorded 2.8e-5 for `no-face-aligned` on its local-mac lease; on this x86-64 CPU the same
  byte-identical graphs reach 1.07e-4 (thread count, arena and prepacking make no difference; disabling ONNX Runtime
  graph optimisation gives 2.6e-5). The tolerance is not widened. The converter reproduces the hosted files exactly,
  so this is how the shipped encoder itself behaves on native x86-64 ONNX Runtime; it is a finding for the providers
  (browser WASM/WebGPU, which qualify the encoder on their own routes), raised to the operator, not a conversion
  defect.
- **Untested here:** browser WASM/WebGPU execution of the stream, device memory, and any non-x86 CPU.

