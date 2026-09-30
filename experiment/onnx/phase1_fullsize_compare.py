"""Compare API and browser outputs at native 1024px, without resampling."""
from pathlib import Path
import datetime,hashlib,json
import numpy as np
import PIL
from PIL import Image,ImageChops,ImageEnhance,ImageDraw,features,JpegImagePlugin
BASE=Path(__file__).resolve().parents[3]/'review-artifacts/browser-onnx-phase1'
OUT=BASE/'full-size'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def stats(a,b):
 d=np.abs(a.astype(np.float64)-b.astype(np.float64))
 return {'shape':list(a.shape),'unequal_channel_values':int(np.count_nonzero(a!=b)),'max_absolute_difference':float(d.max()),'mean_absolute_difference':float(d.mean())}
def rgb(raw):return np.clip(raw.reshape(3,1024,1024).transpose(1,2,0)*np.float32(127.5)+np.float32(128),0,255).astype(np.uint8)
raw=np.fromfile(OUT/'browser-image.f32',dtype='<f4');pixels=rgb(raw)
pixels.tofile(OUT/'browser-rgb-1024.u8');im=Image.fromarray(pixels);im.save(OUT/'browser-onnx.png')
r={'resolution':[1024,1024],'resizing':'none','browser':json.loads((OUT/'browser.json').read_text()),'source_manifest_sha256':sha(BASE/'manifest.json'),'raw_browser_sha256':sha(OUT/'browser-image.f32'),'input_identical':(OUT/'browser-z.f32').read_bytes()==(BASE/'z.f32').read_bytes(),'diagnostic_rgb_vs_torch':stats(rgb(np.fromfile(BASE/'torch-image.f32',dtype='<f4')),pixels),'legacy_pre_encoding_rgb':'Unavailable: API JPEG and WebP are lossy encoded outputs.','codecs':{'pillow':PIL.__version__,'jpeg':features.version_codec('jpg'),'webp':features.version_module('webp')},'formats':{}}
for fmt in ['jpg','webp']:
 refpath=OUT/('reference.'+fmt);ref=Image.open(refpath);assert ref.size==(1024,1024)
 im.save(OUT/('browser-onnx.'+fmt), 'JPEG' if fmt=='jpg' else 'WEBP')
 candidate=OUT/('browser-onnx.'+fmt);a=refpath.read_bytes();b=candidate.read_bytes();out=Image.open(candidate).convert('RGB');reference=ref.convert('RGB')
 row={'reference_sha256':sha(refpath),'candidate_sha256':sha(candidate),'reference_bytes':len(a),'candidate_bytes':len(b),'bytes_identical':a==b,'differing_bytes_including_trailing':sum(x!=y for x,y in zip(a,b))+abs(len(a)-len(b)),'decoded_pixels':stats(np.array(reference),np.array(out)),'reference_decoded_vs_browser_pre_encoding':stats(np.array(reference),pixels),'encoding':'Host Pillow defaults: JPEG quality 75 / WebP quality 80; not browser codec'}
 if fmt=='jpg':row['quantization_tables_equal']=ref.quantization==Image.open(candidate).quantization;row['sampling']=[JpegImagePlugin.get_sampling(ref),JpegImagePlugin.get_sampling(Image.open(candidate))]
 r['formats'][fmt]=row
 diff=ImageEnhance.Brightness(ImageChops.difference(reference,out)).enhance(8);diff.save(OUT/('difference-'+fmt+'-x8.png'))
 canvas=Image.new('RGB',(3072,1066),'#13171b');draw=ImageDraw.Draw(canvas)
 for i,(img,label) in enumerate([(reference,'Live API 1024px '+fmt.upper()),(out,'Browser ONNX + host '+fmt.upper()),(diff,'Decoded absolute difference x8')]):canvas.paste(img,(i*1024,42));draw.text((i*1024+16,12),label,fill='white')
 canvas.save(OUT/('comparison-'+fmt+'.png'))
 if fmt=='webp':
  (OUT/'reference-webp-provenance.json').write_text(json.dumps({'url':'https://api.facemorph.me/api/face/?dim=1024&seed=0&format=webp','sha256':sha(refpath),'bytes':len(a),'size':list(ref.size),'response_headers':'reference-webp-headers.txt'},indent=2)+'\n')
(OUT/'comparison.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r['formats'],indent=2))
