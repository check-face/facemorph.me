"""Render measured profile-guided experiments; never infer missing Burn timings."""
from pathlib import Path
import json,html,numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'review-artifacts/browser-onnx-throughput'
r=json.loads((OUT/'browser.json').read_text());profile=json.loads((ROOT/'review-artifacts/browser-onnx-profile/summary.json').read_text())
assert r.get('completed') and all(x.get('completed') for x in r['rows'])
rows=[]
for row in r['rows']:
 for m in row['measurements']:
  assert all(m['verifiedDeviceSubmissions']) and m['lastCorrectness']['maxFloatDiff']==0 and row['firstCorrectness']['maxFloatDiff']==0
  rows.append([row['name'],row['batch'],m['depth'],f"{m['msPerUsefulFace']/1000:.3f}",f"{m['msPerUsefulFace']*26/1000:.2f}"])
head=['Graph','Batch','Pipeline depth','Seconds/useful face','Seconds/26 useful faces']
table='| '+' | '.join(head)+' |\n|'+ '|'.join(['---']*len(head))+'|\n'+'\n'.join('| '+' | '.join(map(str,row))+' |' for row in rows)
startup='| Graph | Batch | Load seconds | Warm-up seconds | Observed live GPU buffers (MiB) |\n|---|---:|---:|---:|---:|\n'+'\n'.join(f"| {x['name']} | {x['batch']} | {x['loadMs']/1000:.2f} | {sum(x['warmupMs'])/1000:.2f} | {x['memoryAfter']['observedLiveBufferBytes']/2**20:.0f} |" for x in r['rows'])
profiletable='| Shader family (heuristic) | GPU ms | Dispatches |\n|---|---:|---:|\n'+'\n'.join(f"| {x['name']} | {x['ms']:.2f} | {x['dispatches']} |" for x in profile['categories'])
text=f'''# Profile-guided FP32 WebGPU experiments

13 September 2026. Code Insiders integrated Chromium, Apple M1 Pro / Metal. ORT Web 1.24.3. The complete 1024px synthesis model is faster after two profile-guided graph rewrites. **The 0.2–0.3 s target remains unproven.**

## Repeated completed-work benchmark

{table}

Three timed repeats per row, median reported; each repeat produces 26 useful random faces using the same W+ fixtures. Batch 4 computes 28 including two tail faces. Depth 1 waits for the actual ORT session GPU queue after every batch; depth 4 uses four separate input/output buffer slots and waits after four batches. A final completion wait is included in every timing. Original noise is uploaded once per session; W+ updates use persistent GPU buffers. Output buffers are preallocated. All checked first-face and face-25 tensors are **bit-identical** to the original simplified-graph reference; this is not an all-frames or all-GPUs parity guarantee.

Batch 1 is the preferred configuration: 0.415 s per face, about 2.41 useful faces/s and 10.78 s for 26 faces. Batch 2 is essentially tied; batch 4 is slower. A four-frame pipeline does not improve throughput. The paired simplified baseline is 0.584 s, so batch-one latency fell about 29%. An earlier separate paired experiment measured 0.457 → 0.395 s for spatial → polyphase. Shared-workstation load varies; do not combine fastest numbers from unrelated runs into a speedup claim. Visibility changes are recorded in browser.json; one baseline repeat had tab visibility changes. Native PyTorch MPS previously measured 0.229–0.241 s on these W+ fixtures.

Synthesis timings exclude download/loading, warm-up, mapping, e4e/alignment, image conversion, readback and codecs. They establish synthesis throughput, not completed video-export time.

## Changes and profiling

1. Removed eight statically zero pads and 32 provably full-range slices, then folded 16 spatial zero pads into their following convolutions. Original coefficients and FP32 arithmetic are retained. Graph: 515 → 459 nodes.
2. Replaced eight stride-two 3×3 transposed convolutions with four-phase 2×2 convolution plus DepthToSpace. The following filter absorbs the extra bottom/right boundary. Original coefficients are rearranged with zero entries; independent PyTorch tests cover batches 1/2/4, ordering and boundaries. The checked browser results happen to be bit-identical; floating-point summation order need not be identical on every implementation.
3. Prior original-versus-simplified, resident-buffer and graph-capture experiments remain in ../browser-onnx-optimization. Graph simplification by itself did not establish a speedup, and setting the capture option did not prove capture activation.

One separate instrumented baseline frame contained **498 dispatches**, not 50 kernels. The previous 50 count referred to queue submissions. Each dispatch was put in its own timestamped compute pass for profiling; throughput uses the uninstrumented graph. GPU timestamps sum to 510.20 ms within 524.25 ms wall time; a separate uninstrumented workload averaged 515.33 ms/face.

{profiletable}

Classification is based on saved shader source and graph order, not ORT operator labels. The timestamp resolution is roughly 65.536 µs, so tiny dispatch measurements can be zero. The category called “other” remains unclassified. Wall minus summed GPU time is not a clean independent measurement of CPU scheduling, because this instrumentation changes compute-pass structure.

Resident inference uploaded **36,560 bytes of uniforms**, not 10.7 MiB of noise. The profiler recorded shader code, individual dispatches, transfers and observed buffer allocation sizes. The b256.conv0 upsampling layer was selected for the focused Burn experiment from the eight ordered transposed-convolution dispatches; its transposed convolution was approximately 33 ms. This layer is not the entire b256 synthesis block.

## Startup, memory and custom WGSL output conversion

{startup}

These buffer counts include runtime pooling and four preallocated outputs. They are observed GPUBuffer sizes, not physical GPU/driver peak memory. The cumulative observed peak reached approximately {max(x['memoryAfter']['observedPeakBufferBytes'] for x in r['rows'])/2**30:.2f} GiB during the batch-four case; it is not an isolated per-case peak. Model requests were local and may be cached; loading numbers are not internet download forecasts.

A custom WGSL stage reads the actual ORT output GPUBuffer directly and converts it into packed RGBA8. Full 1024px conversion: **0.610 ms median**, 4 MiB download, 3.355 ms readback in this run. Compared with CPU rounding, 12 channel values differ by one level; no larger difference. The browser displays the GPU-converted face. Optional 512px nearest-neighbour conversion is a diagnostic only: 0.505 ms, 1 MiB download, 1.335 ms readback, three channels differing by one level. It is not a replacement for the production resize filter. Synthesis itself remains full 1024px throughout.

## Burn/CubeCL evidence

Burn 0.21 / CubeCL 0.10 was compiled to browser WASM/WebGPU with the same FP32 parameters. The complete b256.conv0 layer and full synthesis model were imported. `LinearLayout::Col` weight loading blocked on a synchronous wait unsupported in browser WASM; the candidate uses Row layout with exact coefficient transposition and a singleton bias reshape at the import boundary.

The fused layer candidate failed its accuracy gate (max absolute error 23.42). Unfused per-stage diagnostics put the large divergence between the transposed-convolution output and the filtered output: affine max error 1.34e-5; modulated input 9.16e-5; transposed convolution 0.0137 on large intermediate values; filtered output 26,431.09. The full unfused polyphase model also failed (max final float error about 4.23e7). These are failed correctness experiments, **not evidence of a speed win**. Warm-up/tuning and failure records are preserved in ../browser-onnx-block and ../browser-onnx-burn-full. A channel-as-batch filtering workaround compiles and passes independent coefficient/geometry tests, but has **not been browser-validated**: Code Insiders became unavailable to computer-use control (`cgWindowNotFound`) before its rerun. See ../browser-onnx-block/filter-workaround-status.json. Do not treat the workaround as a resolved correctness issue.

## Reproduce and share

Source: ../../facemorph.me/experiment/onnx. Run `hf-trial/.venv/bin/python facemorph.me/experiment/onnx/lan_server.py` from the workspace root. Open http://127.0.0.1:7874/facemorph.me/experiment/onnx/web/throughput.html locally, or http://192.168.11.20:7874/facemorph.me/experiment/onnx/web/throughput.html on another LAN machine.

Each client downloads model assets and runs on **its own WebGPU**. The server performs no inference. Plain LAN HTTP needs the client browser to explicitly allow that origin as secure, or a trusted HTTPS endpoint. Chrome: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`; Edge: the equivalent `edge://flags/` page. Add only `http://192.168.11.20:7874`, enable and relaunch; remove the development exception afterwards. This does not manufacture GPU support: the client still needs an available WebGPU adapter. Remote reports use unique run IDs and cannot overwrite the local benchmark. The UI can download JSON. `?view=1` is an optional live-results viewer. The LAN server exposes only experiment assets, not the rest of the workspace.

For Burn reproduction, see ../../facemorph.me/experiment/onnx/burn-candidate/README.md. No production changes, parity promises, migration trial gates or retirement assumptions changed.
'''
(OUT/'report.md').write_text(text)
raw=np.fromfile(ROOT/'review-artifacts/browser-onnx-polyphase/browser-image.f32',np.float32).reshape(3,1024,1024)
rgb=np.clip(raw*127.5+128,0,255).astype(np.uint8).transpose(1,2,0);Image.fromarray(rgb).save(OUT/'reference-face.png')
tablehtml='<table><thead><tr>'+''.join('<th>'+html.escape(x)+'</th>' for x in head)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+html.escape(str(v))+'</td>' for v in row)+'</tr>' for row in rows)+'</tbody></table>'
(OUT/'index.html').write_text('''<!doctype html><meta charset="utf-8"><title>Facemorph GPU performance results</title><style>body{font:17px system-ui;background:#13171b;color:#eee;margin:32px;line-height:1.6;max-width:1050px}a{color:#8dd8ff}table{border-collapse:collapse}td,th{padding:8px 14px;border-bottom:1px solid #48525e;text-align:left}.result{display:flex;gap:30px;flex-wrap:wrap}img{width:320px;max-width:100%;object-fit:contain;align-self:start}pre{white-space:pre-wrap;font:14px system-ui}</style><h1>1024px synthesis: 0.415 seconds per face</h1><p>Profile-guided FP32 ONNX rewrites reduced paired latency by about 29%. Actual GPU completion; checked outputs bit-identical. Native Metal's 0.2–0.3-second target remains open.</p><p><a href="/facemorph.me/experiment/onnx/web/throughput.html">Run on this device’s WebGPU</a> · <a href="browser.json">Raw measurements</a> · <a href="report.md">Full report</a></p><div class="result">'''+tablehtml+'''<img src="reference-face.png" alt="Validated 1024px synthesis fixture; reference pixel conversion"></div><p>Three repeats per row. Batch 4 computes 28 faces for 26 useful outputs. More batching/pipelining did not help. Custom WGSL converts the full GPU output to RGBA8 in about 0.6 ms, reducing download from 12 to 4 MiB.</p><details><summary>Method, startup, memory and limitations</summary><pre>'''+html.escape(text)+'</pre></details>')
print(OUT/'report.md')
