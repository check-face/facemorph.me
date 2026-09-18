from pathlib import Path
import numpy as np,json
from PIL import Image
r=Path(__file__).resolve().parents[3]/'review-artifacts';o=r/'browser-onnx-lab-cache';o.mkdir(exist_ok=True);w=np.fromfile(r/'browser-onnx-video/w.f32',np.float32).reshape(-1,18,512)[:26];w[:,0:9]=w[0,0:9];ix=np.linspace(0,3*1024*1024-1,4091,dtype=np.int32);ix.tofile(o/'indices.i32');cases=[]
for i in range(26):
 c={'name':f'cached-{i}','noise':'original','w':f'{i}.w.f32','samples':f'{i}.samples.f32','reference':f'{i}.png'};cases.append(c)
 if i not in [0,12,25]:continue
 a=np.fromfile(r/f'browser-onnx-round8/baseline-{i}.f32',np.float32);a[ix].tofile(o/c['samples']);w[i].tofile(o/c['w']);rgb=np.clip(a.reshape(3,1024,1024)*np.float32(127.5)+np.float32(128),0,255).astype(np.uint8).transpose(1,2,0);Image.fromarray(rgb).save(o/c['reference'])
(o/'manifest.json').write_text(json.dumps({'sampleIndices':'indices.i32','cases':cases,'reference':'Round 8 full-float uncached baseline, synthetic eligible style mix'},indent=2))
