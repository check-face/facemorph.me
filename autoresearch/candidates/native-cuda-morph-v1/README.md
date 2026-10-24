# native-cuda-morph-v1 — native and live-server baselines for the morph lane (8 October 2026)

Question: after eris iteration 3 (browser WebGPU morph frames 130 -> 70 ms), how does the browser compare to
native GPU inference? Iteration 3's summary implied the browser beat the native API. **It does not.**

| Route | Hardware | ms per morph frame/image |
|---|---|---|
| Browser WebGPU product route (eris-it3) | RTX 2080 SUPER | 69.7 |
| Native PyTorch, self-host settings (reference ops, unfused) | RTX 2080 SUPER | 44.4–44.6 |
| Native PyTorch, CUDA plugin ops, fused modconv, batch 1 | RTX 2080 SUPER | 30.7–31.1 |
| Native PyTorch, same, batch 4 | RTX 2080 SUPER | 30.1–30.8 |
| Live API (TF + custom ops, batched queue), GPU time per image | GTX 1080 (triton) | 56.8 (30/90 d), p10 56.0, p90 62.2 |
| Live API, uncached 26-frame 1024px MP4, wall from eris | GTX 1080 (triton) | ~113 per output frame (2.9–3.1 s; 14 unique images, ~1.15 s ffmpeg) |

On the same GPU, native is 2.3x faster than the browser. A five-year-older GTX 1080 server is also faster per
image than the browser on a 2080 SUPER. The gap is in GPU kernels, not in pipeline overhead: browser synthesis on
the GPU alone is ~62 ms (eris-it3 profile, of which the ORT prefix segment is ~56 ms), native is ~30 ms.
Batching adds about 2% natively, and the server's per-image time is the same at 1 or 4+ images per call.

## Reading the Grafana panel

"Request time per second vs generation time" (facemorph.me API dashboard) plots two means:
`request_processing_seconds` per `/api/face` request, which includes disk-cache hits and so is not a generation
latency; and `generator_network_seconds` **per generator call**. A call is a queue batch of up to 10 images
(about 4 on average), so that line reads ~55 ms only when a call holds a single image and ~297 ms at 4+
images. The per-image figure is `increase(generator_network_seconds_sum)/increase(image_generating_total)`,
the inverse of the "Image Generation Efficiency" panel, and it lands at ~57 ms. So reading ~55 ms off the
panel gave about the right per-image number, but the line itself is per batch. The timer also includes
mapping/truncation and PIL conversion.

## Re-run

```sh
# once: venv with torch (CUDA), numpy, pillow, click, requests, scipy, ninja; then the pinned checkpoint
python self-host/prepare_model.py --accept-research-license --directory ~/Work/runs/native-gpu/models
# the plugins need a host compiler nvcc accepts (gcc-15 with CUDA 13.3 here)
CC=gcc-15 CXX=g++-15 NVCC_PREPEND_FLAGS='-ccbin /usr/bin/g++-15' PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
python3 autoresearch/run.py --lane native-gpu --device eris --timeout 900 -- \
  ~/Work/runs/native-gpu/venv/bin/python autoresearch/candidates/native-cuda-morph-v1/bench.py ~/Work/runs/native-gpu/models out.json
```

`REVERSE=1` runs the configs in reverse order. `bench.py` loads the vendored plugins through
`torch.utils.cpp_extension.load` because the vendored loader can no longer import them under torch 2.14. It
does not modify the vendored sources. No pixel comparison against the browser was made. The native settings
agree with each other within 1 RGB level.
