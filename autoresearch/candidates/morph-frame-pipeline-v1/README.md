# morph-frame-pipeline-v1 — eris iteration 3 (8 October 2026)

**Hypothesis.** A morph is the action a generation repeats most (26+ frames against a handful of faces), and
each frame was strictly serial: GPU synthesis (~62 ms on an RTX 2080 SUPER), then a CPU tail of ~55 ms with the
GPU idle — readback 9, `rgba1024` 13, stored PNG 15 in the worker, then sha256 + decode/512 RGBA/JPEG derivative
on the main thread (`profile1`). Queuing frame N+1 on the GPU before doing frame N's tail should approach
GPU-bound throughput with no numeric change.

**Result: keep.** Component 125.4 -> 67.3 ms/frame; product runtime 129.8 -> 69.7 ms/frame (1.86x, ABBA x4,
spread under 1 ms). Raw float output and every frame PNG byte-identical to control; 7/7 deployed canaries pass.
Warm single faces 142.7 -> 134.5 ms (readback buffers are now reused). Rows `eris-it3-*` in `../../results.tsv`.

**Product change.** `webgpu-engine.mjs` gains `submit()` (queue the whole schedule plus the copy into a pooled
readback, start the map, return `{raw}`); `infer()` is `submit().raw`. `ort-worker.mjs` gains the
`synthesize-frames` op (≤64 latents, each frame posted as `{type:'frame'}` when ready; non-WebGPU routes run
the per-frame schedule). `runtime.mjs` gains `synthesizeFrames(latents,{onFrame})` with the same route
fallback as a face, resuming at the first undelivered frame. `product-bridge.mjs` sends windows of 16 when the
runtime has `synthesizeFrames`; the desktop runtime keeps the per-frame loop.

**Not established.** Built-UI/video-writer run, phones (a slow GPU gains only its CPU-tail share), other
browsers. Separate lead found here: a ~1 s main-thread derivative stall after ~19 images in cold headless
profiles, present in HEAD too (`eris-it3-cold-derivative-stall`).

## Re-run

```sh
R="python3 autoresearch/run.py --lane browser-gpu --device eris --timeout 900 --"
# component: engine + product tail, product engine vs pipelined copy
$R autoresearch/candidates/morph-frame-pipeline-v1/run-bench.sh t1-A ../../../src/Next/browser/webgpu-engine.mjs '[["ctl","frames",26,{}]]'
$R autoresearch/candidates/morph-frame-pipeline-v1/run-bench.sh t2-B ./engine-pipelined.mjs '[["cand","batch",26,{}]]'
# product: real runtime + worker of any tree (control: a HEAD worktree), fixed port per tree keeps its model cache
$R autoresearch/candidates/morph-frame-pipeline-v1/run-product.sh ab1-A <old-tree> 8701 '[["qualify"],["faces",4],["morph","seq",26]]'
$R autoresearch/candidates/morph-frame-pipeline-v1/run-product.sh ab2-B . 8702 '[["qualify"],["faces",4],["morph","batch",26]]'
```

`summarize.py` reads the component JSONL. Results land in `~/Work/runs/ar3/<label>/`.
