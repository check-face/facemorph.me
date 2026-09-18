"""Build an explicit deployment asset bundle; never publish workspace or reports."""
from pathlib import Path
import shutil,json,hashlib,argparse
parser=argparse.ArgumentParser();parser.add_argument('--suite',choices=['25','26','32']);args=parser.parse_args()
R=Path(__file__).resolve().parents[3];O=R/'review-artifacts/device-lab-deploy/assets';O.mkdir(parents=True,exist_ok=True)
paths=[]
def add(p):
 p=R/p
 paths.extend(x for x in p.rglob('*') if x.is_file() and '__pycache__' not in x.parts) if p.is_dir() else paths.append(p)
for name in ['index.html','lab.js','gpu-worker.js','gpu-worker-v2.js','gpu-worker-v3.js','compat-worker-v3.js','gpu-worker-v4.js','compat-worker-v4.js','fused-resample-mobile.js','gpu-worker-v5.js','compat-worker-v5.js','compat-worker-v6.js','experiments.json','ffmpeg-worker-v1.js','video-compat.js','lab-v9.js','experiments-v9.json','gpu-worker-v6.js','compat-worker-v7.js','image-diagnostics-v1.js','colour-worker-v1.js','research-status-v9.json','lab-v10.js','experiments-v10.json','save-client-v2.js','diagnostics-v10.js','lab-v11.js','experiments-v11.json','save-client-v3.js','diagnostics-v11.js','lab-v12.js','experiments-v12.json','video-compat-v2.js','lab-v13.js','experiments-v13.json','lab-v14.js','experiments-v14.json','suite-policy-v1.js','lab-v15.js','experiments-v15.json','gpu-worker-v7.js','stage-diagnostics-v1.js','lab-v16.js','experiments-v16.json','gpu-worker-v8.js','fused-resample-boundary-v1.js','lab-v17.js','experiments-v17.json','video-compat-v3.js','save-client-v4.js','lab-v18.js','experiments-v18.json','lab-v19.js','experiments-v19.json','run-status-v1.js','gpu-worker-v9.js','lab-v20.js','experiments-v20.json','lab-v21.js','experiments-v21.json','suite-policy-v2.js','gpu-worker-v10.js','gpu-memory-budget-v1.js','run-status-v2.js','lab-v22.js','experiments-v22.json','gpu-worker-v11.js','fused-resample-boundary-v2.js','save-client-v5.js','diagnostics-v12.js','simulator-runner-v1.html','simulator-runner-v1.js','lab-v23.js','experiments-v23.json','compat-worker-memory-v1.js','gpu-worker-memory-v1.js','wasm-memory-observer-v1.js','simulator-suite-v1.html','simulator-suite-v1.js','simulator-runner-v2.html','simulator-runner-v2.js']:add(Path('facemorph.me/experiment/device-lab')/name)
if (R/'facemorph.me/experiment/device-lab/experiments-v24.json').exists():
 for name in ['lab-v24.js','experiments-v24.json','suite-policy-v3.js','serial-bootstrap-v1.js','cpu-bootstrap-v1.js','compat-worker-unshared-v1.js','simulator-runner-v3.js','simulator-runner-v3.html','simulator-suite-v2.js','simulator-suite-v2.html','ort-unshared-1243-v1/serial-factory-v1.js','ort-unshared-1243-v1/ort-wasm-simd.mjs','ort-unshared-1243-v1/ort-wasm-simd.wasm','ort-unshared-1243-v1/LICENSE','ort-unshared-1243-v1/ThirdPartyNotices.txt']:add(Path('facemorph.me/experiment/device-lab')/name)
if (R/'facemorph.me/experiment/device-lab/experiments-v25.json').exists():
 for name in ['lab-v25.js','experiments-v25.json','suite-policy-v4.js','serial-bootstrap-v2.js','cpu-bootstrap-v2.js','compat-worker-reference-v1.js','compat-worker-unshared-reference-v1.js','gpu-worker-reference-v1.js','png-reference-v1.js','reference-load-v1.js','reference-canvas-diagnostic-v1.js','reference-diagnostic-worker-v1.js','reference-ramp-v1.png','video-compat-v4.js','simulator-runner-v4.js','simulator-runner-v4.html','simulator-suite-v3.js','simulator-suite-v3.html','simulator-playback-v1.js','simulator-playback-v1.html']:add(Path('facemorph.me/experiment/device-lab')/name)
if (R/'facemorph.me/experiment/device-lab/experiments-v26.json').exists():
 for name in ['lab-v26.js','experiments-v26.json','recovery-policy-v1.js','run-status-v3.js','simulator-suite-v4.js','simulator-suite-v4.html']:add(Path('facemorph.me/experiment/device-lab')/name)
if (R/'facemorph.me/experiment/device-lab/experiments-v32.json').exists():
 for name in ['lab-v32.js','experiments-v32.json','recovery-policy-v2.js','recovery-resume-v1.js','run-status-v4.js','suite-policy-v6.js','save-client-v5.js','diagnostics-v12.js','video-compat-v5.js','e4e-coverage-worker-v1.js','e4e-coverage-v1.json','e4e-coverage-v1.html','test_recovery_resume_v1.mjs']:add(Path('facemorph.me/experiment/device-lab')/name)
for name in ['fused-resample.js','gpu-processing.js','gpu-trace.js','qualify-worker.js']:add(Path('facemorph.me/experiment/onnx/web')/name)
for runtime in ['runtime-122/','']:
 base=Path('facemorph.me/experiment/onnx')/runtime/'node_modules/onnxruntime-web/dist'
 for extra in (R/base).glob('*asyncify*'):add(extra.relative_to(R))
 for extra in (R/base).glob('*iphone-memory*'):add(extra.relative_to(R))
 for extra in (R/base).glob('*iphone-memory*'):add(extra.relative_to(R))
 for extra in (R/base).glob('*iphone-memory*'):add(extra.relative_to(R))
 for extra in (R/base).glob('*iphone-memory*'):add(extra.relative_to(R))
 for extra in (R/base).glob('*iphone-memory*'):add(extra.relative_to(R))
 for name in ['ort.webgpu.min.mjs','ort.wasm.min.mjs','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']:add(base/name)
for folder in ['browser-onnx-phase1','browser-onnx-fusion','browser-onnx-mod-fusion','browser-onnx-cache','browser-onnx-cache-fusion','browser-onnx-qualification','browser-onnx-lab-cache','browser-onnx-lab-mod64-fusion','browser-onnx-mobile-fusion']:
 base=Path('review-artifacts')/folder
 for p in (R/base).iterdir():
  if p.suffix in {'.json','.f32','.i32','.png','.onnx'} and (folder!='browser-onnx-phase1' or p.name=='manifest.json' or p.name.startswith('noise_')):add(p.relative_to(R))
add(Path('review-artifacts/browser-onnx-video/w.f32'));add(Path('review-artifacts/browser-onnx-energy/synthesis-spatial.onnx'));add(Path('review-artifacts/browser-onnx-energy/synthesis-polyphase.onnx'))
for name in ['dist/esm/ffmpeg-core.js','dist/esm/ffmpeg-core.wasm','package.json']:add(Path('facemorph.me/experiment/device-lab/node_modules/@ffmpeg/core')/name)
add(Path('review-artifacts/browser-onnx-weight-modulation/spatial-high.onnx'))
add(Path('review-artifacts/mobile-stage-isolation-v1/references.json'))
if args.suite=='32':
 for name in ['manifest.json','aligned.png','input.png','input.f32','torch-w.f32','torch-image.f32','torch-reconstructed.png','encoder.onnx']:add(Path('review-artifacts/browser-onnx-e4e')/name)
manifest={}
for p in paths:
 relative=p.relative_to(R);source=p
 if args.suite=='25' and relative.as_posix()=='facemorph.me/experiment/device-lab/index.html':source=R/'autoresearch/candidates/png-diagnostic-v1/index-v25.html'
 if args.suite=='25' and relative.as_posix()=='facemorph.me/experiment/device-lab/experiments.json':source=R/'facemorph.me/experiment/device-lab/experiments-v25.json'
 if args.suite=='26' and relative.as_posix()=='facemorph.me/experiment/device-lab/index.html':source=R/'autoresearch/candidates/conservative-recovery-v1/index-v26.html'
 if args.suite=='26' and relative.as_posix()=='facemorph.me/experiment/device-lab/experiments.json':source=R/'facemorph.me/experiment/device-lab/experiments-v26.json'
 if args.suite=='32' and relative.as_posix()=='facemorph.me/experiment/device-lab/experiments.json':source=R/'facemorph.me/experiment/device-lab/experiments-v32.json'
 q=O/relative;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,q);manifest[relative.as_posix()]={'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'bytes':source.stat().st_size}
(O/'asset-manifest.json').write_text(json.dumps(manifest,indent=2));print(len(manifest),'assets',sum(x['bytes'] for x in manifest.values()))

version=json.loads((O/'facemorph.me/experiment/device-lab/experiments.json').read_text())['version']
shutil.copy2(O/'asset-manifest.json',O/('asset-manifest-'+version+'.json'))
