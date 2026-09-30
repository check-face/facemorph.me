"""Compare browser outputs; host Pillow postprocessing is explicitly diagnostic."""
from pathlib import Path
import hashlib,json
import numpy as np
import PIL
from PIL import Image, ImageChops, ImageEnhance,ImageDraw,features
OUT=Path(__file__).resolve().parents[3]/'review-artifacts/browser-onnx-phase1'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def arr(a,b):
 d=np.abs(a.astype('float64')-b.astype('float64'))
 return {'shape':list(a.shape),'unequal_values':int(np.count_nonzero(a!=b)),'max_absolute_difference':float(d.max()),'mean_absolute_difference':float(d.mean())}
def raw(n):return np.fromfile(OUT/(n+'.f32'),dtype='<f4')
def pixels(a):return np.clip(a.reshape(3,1024,1024).transpose(1,2,0)*np.float32(127.5)+np.float32(128),0,255).astype('uint8')
a=pixels(raw('browser-image'));a.tofile(OUT/'browser-rgb-1024.u8')
Image.fromarray(a).save(OUT/'browser-onnx-1024.png')
im=Image.fromarray(a).resize((512,512),Image.Resampling.LANCZOS);np.array(im).tofile(OUT/'browser-rgb-512.u8');im.save(OUT/'browser-onnx.jpg','JPEG')
x=(OUT/'reference.jpg').read_bytes();y=(OUT/'browser-onnx.jpg').read_bytes();n=min(len(x),len(y))
ref=Image.open(OUT/'reference.jpg').convert('RGB');out=Image.open(OUT/'browser-onnx.jpg').convert('RGB')
diff=ImageChops.difference(ref,out);ImageEnhance.Brightness(diff).enhance(8).save(OUT/'difference-x8.png')
canvas=Image.new('RGB',(1536,554),'#13171b');draw=ImageDraw.Draw(canvas)
for i,(img,label) in enumerate([(ref,'Preserved classic JPEG'),(out,'Browser ONNX + local Pillow JPEG'),(ImageEnhance.Brightness(diff).enhance(8),'Absolute decoded difference x8')]):
 canvas.paste(img,(i*512,42));draw.text((i*512+12,12),label,fill='white')
canvas.save(OUT/'comparison.png')
r={'jpeg':{'reference_sha256':sha(OUT/'reference.jpg'),'browser_sha256':sha(OUT/'browser-onnx.jpg'),'reference_bytes':len(x),'browser_bytes':len(y),'identical':x==y,'differing_bytes_including_trailing':sum(a!=b for a,b in zip(x,y))+abs(len(x)-len(y))},'input_latent':{'identical':(OUT/'z.f32').read_bytes()==(OUT/'browser-z.f32').read_bytes(),'sha256':sha(OUT/'z.f32')},'mapping_vs_converted_torch':arr(raw('torch-w').reshape(1,18,512),raw('browser-w').reshape(1,18,512)),'truncated_w_vs_converted_torch':arr(raw('torch-w-truncated').reshape(1,18,512),raw('browser-w-truncated').reshape(1,18,512)),'synthesis_vs_converted_torch':arr(raw('torch-image').reshape(1,3,1024,1024),raw('browser-image').reshape(1,3,1024,1024)),'pre_encoding_rgb_vs_converted_torch':arr(pixels(raw('torch-image')),a),'legacy_pre_encoding_rgb':{'available':False,'reason':'Archived JPEG has no accompanying uncompressed legacy output. Decoding JPEG cannot recover its input pixels.'},'decoded_jpeg_comparison':arr(np.asarray(ref),np.asarray(out)),'processing':{'pixel_conversion':'float32 x*127.5+128, clip [0,255], uint8 truncation','resize':'Local Python Pillow LANCZOS 1024 to 512','jpeg':'Local Python Pillow default JPEG (quality 75), not browser codec','pillow':PIL.__version__,'libjpeg':features.version_codec('jpg'),'limitation':'Legacy installed Pillow/libjpeg versions and original raw RGB unavailable; browser resize/JPEG reproduction remains unimplemented.'}}
(OUT/'comparison.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
