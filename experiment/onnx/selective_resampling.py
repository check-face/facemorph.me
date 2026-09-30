from pathlib import Path
import json
from fold_resampling import transform,ROOT
from polyphase_model import transform as polyphase
out=ROOT/'review-artifacts/browser-onnx-selective';out.mkdir(exist_ok=True);rows=[]
for size in [256,512,1024]:
 intermediate=out/f'partial-{size}.onnx';r=transform(ROOT/'review-artifacts/browser-onnx-profile/synthesis-spatial.onnx',intermediate,min_resolution=size)
 target=out/f'synthesis-{size}.onnx';p=polyphase(intermediate,target);rows.append({'minimum_folded_resolution':size,'fold':r,'remaining_polyphase':p});print(size,target.stat().st_size,flush=True)
(out/'manifest.json').write_text(json.dumps(rows,indent=2))
