"""Render recorded performance/accuracy evidence without running inference."""
from pathlib import Path
import json,html
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'review-artifacts/browser-onnx-optimization'
native=json.loads((OUT/'native.json').read_text())
records={f:json.loads((OUT/f'{f}.json').read_text()) for f in ['round1','round2','round3','runtime1232','runtime122']}
lines=['| Runtime / candidate | Seconds per face | Seconds / 26 | First / last RGB max difference | Result |','|---|---:|---:|---:|---|']
for r in native['rows']:
 lines.append(f"| PyTorch MPS, fused={r['fused_modconv']} | {r['seconds_per_face']:.3f} | {r['seconds']:.3f} | Separate native baseline | Completed |")
htmlrows=[]
for record,r in records.items():
 assert r.get('completed')
 for x in r['rows']:
  name=x['name'].replace('jsep-','runtime1232-') if record=='runtime1232' else x['name']
  if x.get('completed'):
   assert x['verifiedDeviceSubmissions']>0 and x['lastFaceDiffers']
   seconds=f"{x['msPerFace']/1000:.3f}";total=f"{x['totalMs']/1000:.3f}"
   diff=f"{x['correctness']['rgbMaxDiff']} / {x['lastFaceCorrectness']['rgbMaxDiff']}"
   state='Experimental; accuracy not accepted' if x.get('mixed') else 'Float32 diagnostic passed'
  else:seconds=total=diff='—';state=x['error']
  lines.append(f"| {r['runtime']} / {name} | {seconds} | {total} | {diff} | {state} |")
  htmlrows.append('<tr>'+''.join(f'<td>{html.escape(v)}</td>' for v in [r['runtime']+' / '+name,seconds,total,diff,state])+'</tr>')
table='\n'.join(lines)
text=f'''# Browser synthesis optimization — 13 September 2026

**The 0.2–0.3 s/face target is not reached.** Same-machine native MPS reproduces **0.229–0.241 s**. Current ORT Web 1.24.3 float32 stays near **0.52 s**, and the older 1.22.0 JSEP backend reaches **0.484 s** with small float32 rounding differences. Every output is full **1024×1024**; no resolution reduction is hidden in these numbers.

{table}

## GPU execution and timing evidence

`round2.json` contains **32 GPU compute-pass timestamp pairs**, totaling **521.470 ms** inside **531.050 ms** of synchronized wall time for one separate diagnostic inference. That is approximately 98% in GPU compute passes. The subsequent uninstrumented 26-face measurement is 0.529 s/face. Labels are empty, so these timings identify GPU work as the dominant cost but do not assign it to individual ONNX operators.

The same simplified float32 graph also executes successfully with `extra.session.disable_cpu_ep_fallback='1'`: **0.518 s/face**, **832 submissions verified against the actual session's GPU queue** over 26 faces, first and last outputs exactly equal to the original browser float32 reference. This is stronger evidence than selecting WebGPU or observing GPU availability alone. It applies to this synthesis experiment; it does not retroactively certify every e4e node.

ORT 1.24.3 uses the native/asyncify WebGPU backend and creates a device during each session's initialization. Setting `ort.env.webgpu.device` before creation did not bind our separately requested device. The corrected harness captures the actual device after session creation, allocates that session's buffers on it, verifies submit calls on that queue and waits for its completion. Reusing buffers across separately created devices fails. Passing a custom device explicitly also failed in this environment; diagnostic failures are retained separately.

Older GPU-retained video timings waited on the separate device and are superseded. Earlier CPU-output timings still synchronize through readback, and earlier global submit instrumentation still proves GPU activity. The [corrected batch experiment](../browser-onnx-video/report.md) gives **13.517 / 14.145 / 15.357 s** for GPU-output batches 1 / 2 / 4. Batch 1 wins; there is no measured batching benefit after completion is correctly awaited.

## What was learned

- Resident W+/noise and a reused output buffer remove repeated allocation and readback from the measured loop but do not reach the target.
- ORT basic graph simplification reduces 2,814 nodes to 515 without changing the checked float32 outputs or materially improving speed.
- Requesting graph capture and queueing faces did not help. Submission counts did not decrease. A requested capture flag is not proof that capture/replay occurred. NCHW was much slower (1.190 s/face).
- FP16 Conv/ConvTranspose/Gemm reaches 0.453 s, but changes up to 35 / 36 RGB levels on the checked first / last faces. It is not an accepted parity candidate.
- Contiguous FP16 reaches 0.421–0.426 s but causes large output errors (up to 161 levels). Preserving the style branch did not resolve this. The experimental `half-safe` filename describes intent, not validated safety; both variants are rejected. FP16 itself is not ruled out, but these conversions need first-divergence debugging before further speed claims.
- ORT 1.23.2 also loads native/asyncify and performs similarly (0.524 s); its capture candidate fails during buffer binding. The older 1.22.0 JSEP backend achieves 0.484 s. Its first/last RGB changes are only 182/138 channel values, max 1, compared with 1.24.3. This is a limited numerical check, not a browser-wide parity guarantee or a production downgrade recommendation.

## Method and limits

Apple M1 Pro, macOS 26.6.2, Code Insiders 1.133.0-insider / Chromium 148 / Electron 42.8.0. Non-fallback Apple Metal adapter recorded. Native uses PyTorch 2.14.0, MPS tensors and `torch.mps.synchronize()`.

The same 26 W+ fixtures from the video experiment are used with deployed converted weights and original noise. Browser configurations perform three warm-ups, then 26 changing W+ inputs. First and last images are read back outside timing, compared numerically, and checked to differ from one another. Persistent GPU input/output buffers and completed queue work are measured. CPU image readback, mapping, alignment/e4e, loading, image conversion, codecs and video muxing are excluded. Intermediate 24 outputs are computed but not individually retained or parity checked.

Native receives the same W+ values, performs a warm-up and synthesizes 26 full-size float32 outputs, retaining results on MPS. Native fused/unfused variants are reported separately. Native and browser tests were run sequentially, not concurrently. Workstation load, shader caches and thermals are uncontrolled; these are diagnostic runs, not confidence intervals or universal ceilings. No peak GPU-memory measurement is claimed.

## Next performance work

The remaining gap is predominantly GPU compute. To reach 0.3 s from 0.52 s requires about **1.73×** throughput; to match native 0.229 s requires about **2.27×**. Scheduling changes alone are not supported as a route to that improvement by these measurements.

Next, attach operator/shader identities to the timed GPU passes, then prototype a faster convolution/resampling path or fused kernels for the dominant stages. Debug FP16 stage by stage against float32 before accepting reduced precision. Re-test representative e4e W+ inputs as well as random faces. Keep resolution, original noise and accuracy checks explicit. This experiment does not show that WebGPU cannot reach the target; it shows that the tested exports, flags and precision conversions have not done so.

## Reproduce and evidence

Sources are in `facemorph.me/experiment/onnx/`: `native_benchmark.py`, `simplify_model.py`, `mixed_precision_model.py`, `half_precision_model.py`, `safe_half_model.py`, and `web/optimize*.js`. Model transformation records include hashes in `simplify.json`, `mixed.json`, `half.json`, and `half-safe.json`. Dependency lockfiles pin each runtime version.

Serve with:

```sh
ONNX_RUN_SUBDIR=../browser-onnx-optimization ONNX_PORT=7869 hf-trial/.venv/bin/python facemorph.me/experiment/onnx/phase1_server.py
```

Open the Code Insiders integrated browser at `/facemorph.me/experiment/onnx/web/optimize-round1.html`, `optimize-round2.html`, `optimize.html` (round 3), `optimize-1232.html`, or `optimize-122.html`. Click Run. Each run writes `browser.json`; preserve it under its round/version name before another run. Round 3 also writes float32 first/last reference buffers required by the older-runtime comparisons. `browser-zero.f32` here is the last reference face, not a zero-noise test. Regenerate this report with `optimization_report.py` after preserving all records.

See `native.json`, `round1.json`, `round2.json`, `round3.json`, `runtime1232.json`, `runtime122.json`; `custom-device-failure.json` and `device-lifetime-diagnostic.json` retain early failed device experiments. Raw original diagnostic records are not rewritten to pretend they used corrected synchronization. No production deployment or Triton mutation occurred.
'''
(OUT/'report.md').write_text(text)
page='''<!doctype html><meta charset="utf-8"><title>Facemorph · native versus browser GPU</title><style>body{font:17px system-ui;background:#13171b;color:#eee;margin:32px;line-height:1.5;max-width:1200px}td,th{padding:9px 14px;border-bottom:1px solid #45505a;text-align:left}a{color:#9edcc0}.stats{display:flex;gap:36px;flex-wrap:wrap}.stats strong{display:block;font-size:36px;color:#9edcc0}.note{background:#29343d;padding:18px;border-radius:8px}</style><h1>1024px faces: native versus browser GPU</h1><p class="note"><b>0.2–0.3 s target: not reached.</b> GPU execution and completed-work timing are verified. No resolution reduction.</p><div class="stats"><div><strong>0.229 s</strong>Native PyTorch / Metal</div><div><strong>~0.52 s</strong>ORT Web 1.24.3 / WebGPU</div><div><strong>0.484 s</strong>Older 1.22 WebGPU backend</div></div><p>One profiled inference: <b>521 ms GPU compute</b> within 531 ms wall time. Current-runtime synthesis also passes with CPU fallback disabled.</p><p>Corrected batch timing: <b>13.52 / 14.15 / 15.36 seconds</b> for 26 useful faces at batches 1 / 2 / 4. Batch 1 wins. Mapping, model loading, encoding and video muxing are additional work.</p><table><tr><th>Candidate</th><th>s/face</th><th>26 faces (s)</th><th>RGB max Δ first/last</th><th>Accuracy / status</th></tr>'''+''.join(htmlrows)+'''</table><p>FP16 rows are experimental and not accepted for accuracy. First/last comparisons are limited diagnostics. Runs used one shared M1 Pro in Code Insiders.</p><p><a href="report.md">Full report and reproduction</a> · <a href="round2.json">GPU timestamps and no-CPU-fallback evidence</a> · <a href="native.json">Native measurements</a> · <a href="../browser-onnx-video/index.html">Corrected video workload</a></p>'''
(OUT/'index.html').write_text(page)
print('Wrote report.md and index.html')
