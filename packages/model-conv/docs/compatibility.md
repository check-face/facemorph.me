# model-conv compatibility

What model-conv has actually been run on. Do not assume a StyleGAN checkpoint converts because it is listed
upstream: NVIDIA's catalogue includes conditional and StyleGAN3 models, and that says nothing about this
converter. Cells are **qualified** (a recorded `convert` + `verify` pass), **unqualified** (plausible, never
run), **unsupported** (fails, with the reason) or **untested**.

> A checkpoint is a Python pickle: loading it runs code. Convert only checkpoints you trust.

## Checkpoints

| Checkpoint | Source format | Architecture | Cond. | Resolution / channels | Z / W / W+ | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FFHQ config-F, `stylegan2-ffhq-config-f.pkl`, SHA-256 `adf127ea…948d` ([NVIDIA](https://nvlabs-fi-cdn.nvidia.com/stylegan2/networks/stylegan2-ffhq-config-f.pkl)) | TF1 pickle, read by upstream `legacy.load_network_pkl` | StyleGAN2 config-F | no | 1024 / 3 | 512 / 512 / 18 | **qualified** (CPU) | [CI run 40081852041](https://github.com/check-face/facemorph.me/actions/runs/40081852041) (`tests/acceptance.sh` on eris); raw 1.2e-4 ≤ 0.002, RGB 1 ≤ 1 |
| Other StyleGAN2 TF1 pickles (FFHQ 256/512, LSUN, AFHQ…) | TF1 pickle | StyleGAN2 | no | other | other | **unqualified**: needs a declaration in `models.py` with its own tolerance, then a run | none |
| stylegan2-ada-pytorch `.pkl` (PyTorch pickles) | PyTorch pickle | StyleGAN2-ADA | no | any | any | **unqualified**: `legacy.load_network_pkl` reads them; never run here | none |
| Conditional models (e.g. CIFAR-10, `c_dim > 0`) | either | StyleGAN2 | yes | any | any | **unsupported** (from the code, not run): export passes no class label (`c = None`); the mapping graph would need a `c` input | none |
| StyleGAN3 (`-t`, `-r`) | PyTorch pickle | StyleGAN3 | either | any | any | **unsupported** (from the code, not run): no per-layer constant noise planes, so the export would refuse with "checkpoint noise planes differ from the declaration" | none |
| A non-face checkpoint for the providers | | | | | | **pending** `conversion.qualify` (fm-fy2.15) | none |

FFHQ terms: the checkpoint is NVIDIA's under the NVIDIA Source Code License-NC; FFHQ images are CC BY-NC-SA 4.0.
Converted artifacts carry the terms of the checkpoint they came from.

## Precision, operators and providers

| | Status |
| --- | --- |
| FP32 export, opset 17, ONNX Runtime CPU (1.24.3) parity against upstream PyTorch reference ops | **qualified** (FFHQ, [run 40081852041](https://github.com/check-face/facemorph.me/actions/runs/40081852041)) |
| Graph rewrites: identity Pad/Slice removal, zero-Pad folding, precomputed demodulation energy (FP64 → FP32) | **qualified** inside the FFHQ parity run |
| FP16 or mixed precision | **unsupported**: not produced; never widen the frozen tolerance to admit it |
| Browser WASM / WebGPU providers on the converted artifact | **untested** here; the providers qualify it (the FFHQ mapping is byte-identical to the shipped one) |

## Platforms

| OS / arch | Container | Status |
| --- | --- | --- |
| Linux x86-64, Docker 29, CPU | `facemorph/model-conv` | **qualified** (eris, [run 40081852041](https://github.com/check-face/facemorph.me/actions/runs/40081852041)) |
| NVIDIA GPU profile (CUDA PyTorch) | none yet | **untested**: no GPU profile exists; conversion is CPU-only by design |
| Linux arm64, macOS, Windows | | **untested** |

## Photo encoders

Turning a photo into a latent needs a separately trained encoder compatible with the generator. FFHQ e4e
works only for the FFHQ face generator; it is not a generic encoder for non-face models. The e4e exporters
(classic `e4e_export.py`, `photo-runtime/encoder-stream/export.py`) are **not yet ported** (`PROVENANCE.json`),
so every encoder cell is **untested**.
