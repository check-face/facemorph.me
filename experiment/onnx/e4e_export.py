"""Export deployed e4e; save a synthetic full-size image round-trip diagnostic."""
from pathlib import Path
import sys,json,hashlib,time
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'hf'))
from e4e_cpu import Encoder,EXPECTED
from engine import Renderer
import torch,numpy as np,onnx
from PIL import Image
OUT=ROOT/'review-artifacts/browser-onnx-e4e';OUT.mkdir(parents=True,exist_ok=True)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
class ExportEncoder(torch.nn.Module):
 def __init__(self,e):
  super().__init__();self.net=e.net;self.register_buffer('average',e.latent_avg.unsqueeze(0))
 def forward(self,image):return self.net(image)+self.average

def main():
 e=Encoder();m=ExportEncoder(e).eval()
 source=ROOT/'review-artifacts/browser-onnx-phase1/full-size/reference.webp'
 image=Image.open(source).convert('RGB');image.save(OUT/'input.png')
 print('Preparing original alignment and CPU encoder diagnostic',flush=True)
 start=time.perf_counter();w,aligned,did_align=e.encode(image);seconds=time.perf_counter()-start
 aligned.save(OUT/'aligned.png');x=((np.asarray(aligned,dtype=np.float32)/255-.5)/.5).transpose(2,0,1)[None]
 x.astype('<f4').tofile(OUT/'input.f32');w.numpy().astype('<f4').tofile(OUT/'torch-w.f32')
 print('Export e4e 256px -> W+',flush=True)
 with torch.inference_mode():
  torch.onnx.export(m,(torch.from_numpy(x),),str(OUT/'encoder.onnx'),input_names=['image'],output_names=['w'],opset_version=17,dynamo=False)
 onnx.checker.check_model(str(OUT/'encoder.onnx'))
 print('CPU synthesis diagnostic',flush=True)
 g=Renderer().model
 with torch.inference_mode():raw=g.synthesis(w,noise_mode='const',force_fp32=True,fused_modconv=False).numpy()
 raw.astype('<f4').tofile(OUT/'torch-image.f32');rgb=np.clip(raw[0].transpose(1,2,0)*127.5+128,0,255).astype('uint8');Image.fromarray(rgb).save(OUT/'torch-reconstructed.png')
 manifest={'checkpoint_sha256':EXPECTED['e4e_ffhq_encode.pt'],'landmarks_sha256':EXPECTED['shape_predictor_68_face_landmarks.dat'],'encoder_sha256':sha(OUT/'encoder.onnx'),'encoder_bytes':(OUT/'encoder.onnx').stat().st_size,'input_source':str(source.relative_to(ROOT)),'input_sha256':sha(OUT/'input.png'),'input_tensor_sha256':sha(OUT/'input.f32'),'did_align':did_align,'cpu_align_encode_seconds':seconds,'opset':17,'torch':torch.__version__,'onnx':onnx.__version__,'input_shape':[1,3,256,256],'output_shape':[1,18,512],'latent_average':'Added exactly once in exported encoder; bypass generator mapping and truncation','preprocessing':'Original dlib alignment and Pillow bilinear 256px in local Python; /255, then (x-.5)/.5 float32','reference':'Converted PyTorch diagnostic, not legacy production parity proof'}
 (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print('Ready',flush=True)
if __name__=='__main__':main()
