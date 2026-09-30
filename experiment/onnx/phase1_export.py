"""Local phase-one export. Run from workspace with hf-trial/.venv/bin/python."""
from pathlib import Path
import sys, json, hashlib, shutil, platform
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'review-artifacts/browser-onnx-phase1'
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'hf'))
from engine import Renderer
import torch, numpy as np, onnx, onnxruntime as ort
from PIL import Image
OUT.mkdir(parents=True, exist_ok=True)
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(name,a):
    a=np.asarray(a,dtype='<f4'); a.tofile(OUT / (name+'.f32')); return {'file':name+'.f32','shape':list(a.shape),'sha256':sha(OUT/(name+'.f32'))}
class Mapping(torch.nn.Module):
    def __init__(self,g): super().__init__(); self.g=g
    def forward(self,z): return self.g.mapping(z,None,truncation_psi=1)
class Synthesis(torch.nn.Module):
    def __init__(self,g):
        super().__init__(); self.g=g
        self.layers=[m for m in g.synthesis.modules() if hasattr(m,'noise_const')]
    def forward(self,w,*noise):
        for m,n in zip(self.layers,noise): m.noise_const=n
        return self.g.synthesis(w,noise_mode='const',force_fp32=True,fused_modconv=False)
def main():
    source=ROOT/'triton-migration/stylegan2-ffhq-config-f.pkl'
    assert sha(source)=='adf127ea7bb8a7788c8bdeda3c9937f7310b669b09ecf799ca53a631ff46948d'
    g=Renderer().model; mapping=Mapping(g); synthesis=Synthesis(g)
    # Batch-one export: anchor convolution kernel dimensions after traced resampling.
    from torch_utils.ops import conv2d_gradfix
    original_conv = torch.nn.functional.conv2d
    original_transpose = torch.nn.functional.conv_transpose2d
    def static_conv(input, weight, *args, **kwargs):
        return original_conv(input, weight.reshape(tuple(int(d) for d in weight.shape)), *args, **kwargs)
    def static_transpose(input, weight, *args, **kwargs):
        return original_transpose(input, weight.reshape(tuple(int(d) for d in weight.shape)), *args, **kwargs)
    conv2d_gradfix.conv2d = static_conv
    conv2d_gradfix.conv_transpose2d = static_transpose
    z=np.random.RandomState(0).randn(1,512).astype('<f4')
    noise=[m.noise_const.clone() for m in synthesis.layers]
    manifest={'seed':0,'psi':0.7,'cutoff':8,'source_sha256':sha(source),'converted_sha256':sha(Path(__file__).resolve().parent.parent/'hf/models/generator.pkl'),'versions':{'torch':torch.__version__,'onnx':onnx.__version__,'onnxruntime':ort.__version__,'python':platform.python_version(),'os':platform.platform()},'z':save('z',z),'average':save('average',g.mapping.w_avg.numpy()),'noise':[dict(name=f'noise_{i}',**save(f'noise_{i}',n.numpy())) for i,n in enumerate(noise)],'opset':17}
    with torch.inference_mode():
        w=mapping(torch.from_numpy(z)); wt=w.clone(); wt[:,:8]=g.mapping.w_avg+(wt[:,:8]-g.mapping.w_avg)*0.7
        save('torch-w',w.numpy()); save('torch-w-truncated',wt.numpy())
        print('Export mapping',flush=True)
        torch.onnx.export(mapping,(torch.from_numpy(z),),str(OUT/'mapping.onnx'),input_names=['z'],output_names=['w'],opset_version=17,dynamo=False)
        print('Export synthesis',flush=True)
        torch.onnx.export(synthesis,(wt,*noise),str(OUT/'synthesis.onnx'),input_names=['w']+[n['name'] for n in manifest['noise']],output_names=['image'],opset_version=17,dynamo=False)
        print('Torch diagnostic',flush=True)
        raw=synthesis(wt,*noise).numpy(); save('torch-image',raw)
        # Legacy TF convert_images_to_uint8: scale, +0.5, saturating cast.
        rgb=np.clip(raw[0].transpose(1,2,0)*127.5+128,0,255).astype('uint8')
        rgb.tofile(OUT/'torch-rgb-1024.u8'); Image.fromarray(rgb).save(OUT/'torch-diagnostic.png')
    for name in ['mapping','synthesis']:
        onnx.checker.check_model(str(OUT/(name+'.onnx')))
    manifest['models']={n:{'sha256':sha(OUT/(n+'.onnx')),'bytes':(OUT/(n+'.onnx')).stat().st_size} for n in ['mapping','synthesis']}
    ref=json.loads((ROOT/'hf-trial/archive/manifest.json').read_text())[0]
    shutil.copyfile(ROOT/'hf-trial/archive'/ref['file'],OUT/'reference.jpg'); assert sha(OUT/'reference.jpg')==ref['sha256']
    manifest['reference']=ref
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Export complete',flush=True)
if __name__=='__main__': main()
