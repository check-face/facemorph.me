"""Fixed-batch synthesis candidates for a 26-unique-face video workload."""
from pathlib import Path
import sys,json,hashlib,shutil
from phase1_export import Synthesis
from engine import Renderer
from torch_utils.ops import conv2d_gradfix
import torch,numpy as np,onnx
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'review-artifacts/browser-onnx-video';OUT.mkdir(parents=True,exist_ok=True)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
original_conv=torch.nn.functional.conv2d;original_transpose=torch.nn.functional.conv_transpose2d
def conv(input,weight,*a,**kw):return original_conv(input,weight.reshape(tuple(int(d) for d in weight.shape)),*a,**kw)
def transpose(input,weight,*a,**kw):return original_transpose(input,weight.reshape(tuple(int(d) for d in weight.shape)),*a,**kw)
conv2d_gradfix.conv2d=conv;conv2d_gradfix.conv_transpose2d=transpose
g=Renderer().model;m=Synthesis(g);noise=[x.noise_const.clone() for x in m.layers]
z=np.random.RandomState(20260913).randn(28,512).astype('<f4');z.tofile(OUT/'z.f32')
with torch.inference_mode():
 w=g.mapping(torch.from_numpy(z),None,truncation_psi=.7,truncation_cutoff=8);w.numpy().astype('<f4').tofile(OUT/'w.f32')
 models={}
 for batch in [2,4]:
  print('Export batch',batch,flush=True)
  path=OUT/f'synthesis-b{batch}.onnx'
  torch.onnx.export(m,(w[:batch],*noise),str(path),input_names=['w']+[f'noise_{i}' for i in range(len(noise))],output_names=['image'],opset_version=17,dynamo=False)
  onnx.checker.check_model(str(path));models[str(batch)]={'file':path.name,'bytes':path.stat().st_size,'sha256':sha(path)}
 (OUT/'manifest.json').write_text(json.dumps({'models':models,'workload':{'video_frames':50,'fps':16,'unique_faces':26,'source':'checkface.py mp4 defaults and mirrored frame deduplication','random_seed':20260913,'prepared_latents':28,'tail':'Batch 4 pads final batch to 28 processed faces; useful frame count stays 26'},'w_sha256':sha(OUT/'w.f32'),'z_sha256':sha(OUT/'z.f32'),'opset':17,'dtype':'float32','resolution':1024},indent=2)+'\n')
 print('Ready',flush=True)
