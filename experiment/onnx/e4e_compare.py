from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageChops,ImageEnhance,ImageDraw
OUT=Path(__file__).resolve().parents[3]/'review-artifacts/browser-onnx-e4e'
def raw(n,shape):return np.fromfile(OUT/(n+'.f32'),dtype='<f4').reshape(shape)
def compare(a,b):
 d=np.abs(a.astype('float64')-b.astype('float64'));return {'shape':list(a.shape),'unequal_values':int(np.count_nonzero(a!=b)),'max_absolute_difference':float(d.max()),'mean_absolute_difference':float(d.mean())}
b=json.loads((OUT/'browser.json').read_text());assert b['completed'] and b['gpuValidated'] and b['syntheticFixture']
assert (OUT/'input.f32').read_bytes()==(OUT/'browser-input.f32').read_bytes(),'Preprocessing differs'
x=raw('torch-image',(1,3,1024,1024));y=raw('browser-image',(1,3,1024,1024))
def pixels(a):return np.clip(a[0].transpose(1,2,0)*127.5+128,0,255).astype('uint8')
a=pixels(x);c=pixels(y)
r={'input_tensor_bytes_identical':True,'w_plus':compare(raw('torch-w',(1,18,512)),raw('browser-w',(1,18,512))),'synthesis_float':compare(x,y),'rgb':compare(a,c),'browser_canvas_rgb':compare(c,np.array(Image.open(OUT/'browser-reconstructed.png').convert('RGB'))),'baseline':'Converted CPU PyTorch with original CPU alignment, not legacy API parity','browser':b}
(OUT/'comparison.json').write_text(json.dumps(r,indent=2)+'\n')
img=Image.fromarray(c);img.save(OUT/'browser-reconstructed-host.png');diff=ImageEnhance.Brightness(ImageChops.difference(Image.fromarray(a),img)).enhance(8);diff.save(OUT/'difference-x8.png')
canvas=Image.new('RGB',(2048,560),'#13171b');draw=ImageDraw.Draw(canvas)
for i,(image,label) in enumerate([(Image.open(OUT/'input.png'),'Uploaded synthetic face'),(Image.fromarray(a),'CPU reference reconstruction'),(img,'Browser WebGPU reconstruction'),(diff,'Reconstruction difference x8')]):
 canvas.paste(image.resize((512,512)),(i*512,48));draw.text((i*512+12,14),label,fill='white')
canvas.save(OUT/'comparison.png');print(json.dumps({k:v for k,v in r.items() if k!='browser'},indent=2))
