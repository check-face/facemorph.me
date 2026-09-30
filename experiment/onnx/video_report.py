from pathlib import Path
import json
OUT=Path(__file__).resolve().parents[3]/'review-artifacts/browser-onnx-video'
r=json.loads((OUT/'browser.json').read_text());assert r.get('completed') and len(r['rows'])==6
rows=r['rows'];assert all(x['completed'] and x['gpuQueueSubmissions']>0 and x.get('deviceSource','').startswith('Actual ORT') for x in rows)
lines=['| Batch | Output | Seconds / 26 useful faces | Useful faces/s | GPU submissions |','|---|---|---:|---:|---:|']
for x in rows:lines.append(f"| {x['batch']} | {x['output']} | {x['totalMs']/1000:.3f} | {x['facesPerSecond']:.3f} | {x['gpuQueueSubmissions']} |")
table='\n'.join(lines)
best_gpu=min((x for x in rows if x['output']=='gpu-buffer'),key=lambda x:x['totalMs'])
best_cpu=min((x for x in rows if x['output']=='cpu'),key=lambda x:x['totalMs'])
text=f'''# Browser video-throughput experiment — 13 September 2026

The normal API video uses **50 frames at 16 fps** (3.125 seconds playback), with mirrored frame deduplication reducing generation to **26 unique faces**. The browser benchmark renders this many random 1024px faces with fixed batch sizes 1, 2 and 4.

{table}

**Corrected synchronization:** These measurements capture ORT's actual GPU device after each session creation and wait on that queue. Earlier records in `before-device-audit/` waited on a separate device; their GPU-output timings are superseded. CPU readback already synchronized earlier CPU-output timings.

## Interpretation

Batch 1 with CPU readback takes {rows[0]['totalMs']/1000:.2f}s for the useful image workload. This is a practical synthesis baseline for a path that needs CPU image pixels; mapping, conversion, resize, codec and muxing costs must be added. GPU-retained output is a diagnostic optimization boundary, not an implemented video encoder.

The fastest completed GPU-output configuration is batch {best_gpu['batch']}: {best_gpu['totalMs']/1000:.2f}s, {best_gpu['facesPerSecond']:.2f} useful faces/s. Batch 2 changes throughput by {(rows[3]['facesPerSecond']/rows[1]['facesPerSecond']-1)*100:.1f}% relative to batch 1; batch 4 changes it by {(rows[5]['facesPerSecond']/rows[1]['facesPerSecond']-1)*100:.1f}%. Batch 4 includes two padded faces (28 computed for 26 useful). Choose the batch size from these corrected measurements, not the superseded results that did not wait on ORT's actual queue.

All candidates retain full 1024px float32 computation and original noise. This single ordered pass on a shared machine does not establish a universal batch-size optimum. Graph capture, resident inputs and FP16 candidates have a separate [optimization report](../browser-onnx-optimization/report.md).

## Method and limits

- Code Insiders 1.133.0-insider / Chromium 148.0.7778.280 / Electron 42.8.0, ONNX Runtime Web 1.24.3. Apple/Metal non-fallback adapter; Apple M1 Pro host.
- Exact deployed converted generator, separate fixed-batch synthesis candidates. Batch 2 and 4 model hashes and random fixture hashes are in `manifest.json`; batch 1 reuses phase-1 synthesis.
- Seed 20260913 produces 28 reproducible NumPy Z vectors, mapped/truncated with converted PyTorch outside timed regions. Random faces isolate synthesis throughput; this is not a morph-schedule parity test.
- Each configuration loads its model and performs one warm-up outside timing. All 26 useful faces are then processed through the persistent session. Wall-clock timers bracket completion of the actual device captured from `ort.env.webgpu.device` after this session was created. Timings include input preparation/transfer, ORT execution and synchronization, and output readback for CPU mode. Per-stage model load/warmup times are retained in `browser.json`.
- GPU `submit` counts prove device work within timed regions. No alternative CPU EP is requested; possible ORT CPU shape/control work is not excluded. Pure per-kernel GPU timing and peak GPU memory are unavailable.
- Each configuration's first face matches the batch-one float output exactly. Broader numerical parity has not been established.
- `outputLocation` in the initial data is the **warm-up tensor after diagnostic getData()** (hence CPU), not the location of timed GPU-retained outputs. The earlier `transfer-check/browser.json` validates residency, but its separate-device waits mean its timing remains provisional. GPU-mode measured loops never call getData().
- One pass in fixed order on a shared workstation; OS load, shader caches, thermals and device contention can affect these results. No confidence intervals or cold-start claims.
- Full 1024px synthesis is done even though the normal movie may be resized smaller. Video playback fps is distinct from face-generation throughput.

## Reproduce

```sh
hf-trial/.venv/bin/python facemorph.me/experiment/onnx/video_export.py
ONNX_RUN_SUBDIR=../browser-onnx-video ONNX_PORT=7867 hf-trial/.venv/bin/python facemorph.me/experiment/onnx/phase1_server.py
```

Open `http://127.0.0.1:7867/facemorph.me/experiment/onnx/web/video.html` in the Code Insiders integrated browser. Click **Run throughput benchmark**. When complete:

```sh
hf-trial/.venv/bin/python facemorph.me/experiment/onnx/video_report.py
```

A transfer-location diagnostic uses the same page with `?transfer-check=1`; serve it with `ONNX_RUN_SUBDIR=../browser-onnx-video/transfer-check ONNX_PORT=7868`. No live API, production change or real video encoding is part of the benchmark.
'''
(OUT/'report.md').write_text(text)
html='<!doctype html><meta charset="utf-8"><title>Facemorph video throughput results</title><style>body{font:18px system-ui;background:#13171b;color:#eee;margin:36px;line-height:1.5}td,th{padding:10px 18px;border-bottom:1px solid #45505a;text-align:left}a{color:#9edcc0}</style><h1>26 faces for a 50-frame video</h1><p>Full 1024px, float32, verified Apple/Metal WebGPU. Loaded models and warm-up excluded.</p><table><tr><th>Batch</th><th>Output</th><th>Seconds</th><th>Faces/s</th></tr>'
for x in rows:html+=f"<tr><td>{x['batch']}</td><td>{x['output']}</td><td>{x['totalMs']/1000:.2f}</td><td>{x['facesPerSecond']:.2f}</td></tr>"
html+=f'</table><p>Corrected waits use the actual ORT device. Fastest CPU output: batch {best_cpu["batch"]}; fastest GPU output: batch {best_gpu["batch"]}. Video conversion/encoding and mapping are additional work.</p><p><a href="report.md">Method and limitations</a> · <a href="browser.json">Measurements</a> · <a href="../browser-onnx-e4e/index.html">e4e GPU round trip</a></p>'
(OUT/'index.html').write_text(html);print(table)
