
## Profile-guided performance and LAN runs

The 13 September follow-up removes provable spatial no-ops and rewrites transposed convolution into phase filters. Three-repeat completed-work measurements reach about 0.415 seconds per 1024px face, with checked first/last outputs bit-identical. See the workspace `review-artifacts/browser-onnx-throughput/report.md` and `browser_onnx_plan.md` for profiling, batching, startup/memory, GPU pixel conversion and limitations.

Run from the workspace root:

```sh
hf-trial/.venv/bin/python facemorph.me/experiment/onnx/lan_server.py
```

The harness is at `http://192.168.11.20:7874/facemorph.me/experiment/onnx/web/throughput.html` for LAN clients, or the same path on `127.0.0.1` locally. Each client uses its own WebGPU. The page explains secure-origin setup for LAN HTTP; remote report IDs are isolated. Add `?view=1` to watch the local report instead. The server serves only experiment assets, not arbitrary workspace files.

The Burn/CubeCL candidate, import adaptations and accuracy failures are documented in [burn-candidate/README.md](burn-candidate/README.md). The filter workaround and identity-reshape removal were browser-tested and both failed correctness. See the continuing [research log](../../../browser_onnx_research_log.md) for later GPU and CPU experiments; no Burn speed win is established.


Round 5 adds fresh per-shader profiles (`web/profile-winner.html`), isolated and complete-model WGSL fusion tests (`fusion.html`, `fusion-full-122.html`), exact pixel/Lanczos processing (`pixels.html`), bounded H.264 encoding (`pipeline.html`), mixed-resolution batching (`hybrid.html`), eligible prefix caching (`cache.html`), and device qualification (`qualify.html`). Results, limitations and pending work are in the workspace [research log](../../../browser_onnx_research_log.md). `research_server.py` serves local experiments on 7883; `ONNX_PUBLIC=1 ONNX_PORT=7884` enables the exact public-asset allowlist recorded in `review-artifacts/browser-onnx-round5/public-assets.json`. Saved reports are not publicly readable. The phone benchmark uses validated ORT1.24 energy models; new JSEP fusion/cache variants remain local research.
