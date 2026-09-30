from pathlib import Path
import sys,json,time,platform
import numpy as np,torch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'hf'))
from engine import Renderer
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'review-artifacts/browser-onnx-optimization'
w=np.fromfile(ROOT/'review-artifacts/browser-onnx-video/w.f32',dtype='<f4').reshape(28,18,512)
g=Renderer('mps').model;rows=[]
with torch.inference_mode():
 for fused in [False,True]:
  try:
   t=torch.from_numpy(w).to('mps');g.synthesis(t[:1],noise_mode='const',force_fp32=True,fused_modconv=fused);torch.mps.synchronize()
   start=time.perf_counter()
   for i in range(26):result=g.synthesis(t[i:i+1],noise_mode='const',force_fp32=True,fused_modconv=fused)
   torch.mps.synchronize();elapsed=time.perf_counter()-start
   rows.append({'fused_modconv':fused,'float32':True,'faces':26,'seconds':elapsed,'seconds_per_face':elapsed/26,'gpu_allocated':torch.mps.current_allocated_memory(),'driver_allocated':torch.mps.driver_allocated_memory()})
  except Exception as e:rows.append({'fused_modconv':fused,'error':str(e)})
  print(rows[-1],flush=True)
(OUT/'native.json').write_text(json.dumps({'device':'mps','torch':torch.__version__,'platform':platform.platform(),'rows':rows,'scope':'Synthesis only, full 1024 float32, original noise, same 26 W+ fixtures, output retained on GPU; synchronized after 26 calls'},indent=2)+'\n')
