"""Independent CPU-ORT references: all pixels plus deterministic float samples."""
from pathlib import Path
import json,hashlib
import numpy as np,onnxruntime as ort
from PIL import Image
R=Path(__file__).resolve().parents[3]/'review-artifacts';O=R/'browser-onnx-qualification';O.mkdir(exist_ok=True)
m=json.loads((R/'browser-onnx-phase1/manifest.json').read_text());noise={n['name']:np.fromfile(R/'browser-onnx-phase1'/n['file'],dtype=np.float32).reshape(n['shape']) for n in m['noise']}
w=np.fromfile(R/'browser-onnx-video/w.f32',np.float32).reshape(-1,18,512);avg=np.fromfile(R/'browser-onnx-phase1/average.f32',np.float32)
cases=[(f'frame-{i:02}',w[i:i+1].copy(),'original') for i in range(26)]
cases.append(('encoded-synthetic-photo',np.fromfile(R/'browser-onnx-e4e/browser-w.f32',np.float32).reshape(1,18,512),'original'))
cases += [('zero-noise',w[:1].copy(),'zero'),('alternate-noise',w[:1].copy(),'alternate')]
# Explicitly test the existing truncation rule on this W+ fixture, not a new mapping claim.
for psi in [0.,1.]:
 v=w[:1].copy();v[:,:8]=avg+(v[:,:8]-avg)*np.float32(psi);cases.append((f'trunc-psi-{psi:g}',v,'original'))
so=ort.SessionOptions();so.intra_op_num_threads=4
session=ort.InferenceSession(str(R/'browser-onnx-profile/synthesis-spatial.onnx'),so,providers=['CPUExecutionProvider'])
rows=[];indices=np.arange(0,3*1024*1024,769,dtype=np.int32);indices.tofile(O/'sample-indices.i32')
for name,v,mode in cases:
 feed=dict(noise)
 if mode=='zero':feed={k:np.zeros_like(a) for k,a in noise.items()}
 if mode=='alternate':feed={k:-a for k,a in noise.items()}
 raw=session.run(None,dict(feed,w=v))[0].reshape(-1)
 rgb=np.clip(raw*np.float32(127.5)+np.float32(128),0,255).astype(np.uint8).reshape(3,1024,1024).transpose(1,2,0)
 Image.fromarray(rgb).save(O/f'{name}.png');v.tofile(O/f'{name}.w.f32');raw[indices].tofile(O/f'{name}.samples.f32')
 rows.append({'name':name,'noise':mode,'w':f'{name}.w.f32','reference':f'{name}.png','samples':f'{name}.samples.f32'});print(name,flush=True)
(O/'manifest.json').write_text(json.dumps({'reference':'ORT 1.24.3 CPU spatial FP32; all RGB pixels and 4091 regularly spaced float samples; synthetic photo only','cases':rows,'sampleIndices':'sample-indices.i32'},indent=2))
