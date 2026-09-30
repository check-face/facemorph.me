"""Export the b256.conv0 layer selected by per-dispatch GPU profiling."""
from pathlib import Path
import sys,json,hashlib
import torch,numpy as np,onnx,onnxruntime as ort
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'review-artifacts/browser-onnx-block';OUT.mkdir(exist_ok=True)
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'hf'))
from engine import Renderer
from torch_utils.ops import conv2d_gradfix
w=np.fromfile(ROOT/'review-artifacts/browser-onnx-video/w.f32',dtype='<f4').reshape(28,18,512)
g=Renderer('mps').model;layer=g.synthesis.b256.conv0;xs=[];ws=[];ys=[]
def capture(m,args,output):xs.append(args[0].cpu().clone());ws.append(args[1].cpu().clone());ys.append(output.cpu().clone())
h=layer.register_forward_hook(capture)
with torch.inference_mode():
 for i in range(4):g.synthesis(torch.from_numpy(w[i:i+1]).to('mps'),noise_mode='const',force_fp32=True,fused_modconv=False)
h.remove();g=g.cpu();layer=g.synthesis.b256.conv0
x=torch.cat(xs);style=torch.cat(ws);y=torch.cat(ys);noise=layer.noise_const.detach().clone();manifest={'scope':'b256.conv0 complete synthesis layer, including affine, modulation/demodulation, upsampling, convolution, original noise, bias and activation','selection':'Largest individual dispatch in full-model trace: b256 ConvTranspose, 33.030 ms','inputs':{},'outputs':{}}
def save(name,t):
 p=OUT/(name+'.f32');a=t.detach().numpy().astype('<f4');a.tofile(p);return {'file':p.name,'shape':list(a.shape),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
manifest['inputs']={n:save(n,t) for n,t in [('x',x),('w',style),('noise',noise)]};manifest['outputs']['native']=save('native-y',y)
class Layer(torch.nn.Module):
 def __init__(self,m):super().__init__();self.layer=m
 def forward(self,x,w,noise):self.layer.noise_const=noise;return self.layer(x,w,noise_mode='const',fused_modconv=False)
wrap=Layer(layer);conv=torch.nn.functional.conv2d;trans=torch.nn.functional.conv_transpose2d
conv2d_gradfix.conv2d=lambda input,weight,*a,**kw:conv(input,weight.reshape(tuple(int(d) for d in weight.shape)),*a,**kw)
conv2d_gradfix.conv_transpose2d=lambda input,weight,*a,**kw:trans(input,weight.reshape(tuple(int(d) for d in weight.shape)),*a,**kw)
with torch.inference_mode():
 for b in [1,2,4]:
  original=OUT/f'block-b{b}-original.onnx';p=OUT/f'block-b{b}.onnx'
  torch.onnx.export(wrap,(x[:b],style[:b],noise),str(original),input_names=['x','w','noise'],output_names=['y'],opset_version=17,dynamo=False)
  opts=ort.SessionOptions();opts.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_BASIC;opts.optimized_model_filepath=str(p)
  ort.InferenceSession(str(original),sess_options=opts,providers=['CPUExecutionProvider']);onnx.checker.check_model(str(p));print(p,flush=True)
manifest['models']={f'block-b{b}':{'sha256':hashlib.sha256((OUT/f'block-b{b}.onnx').read_bytes()).hexdigest()} for b in [1,2,4]}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
