"""Compare saved full-resolution Burn output with a paired FP32 reference."""
import argparse,json,math
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
parser=argparse.ArgumentParser();parser.add_argument('reference',type=Path);parser.add_argument('candidate',type=Path);parser.add_argument('out',type=Path);args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=True)
def load(p):
 x=np.fromfile(p,dtype='<f4');assert x.size==3*1024*1024;assert np.isfinite(x).all();return x.reshape(3,1024,1024).transpose(1,2,0)
a,b=load(args.reference),load(args.candidate)
def pixel(x):return np.clip(x*np.float32(127.5)+np.float32(128),0,255).astype(np.uint8)
x,y=pixel(a),pixel(b);d=np.abs(x.astype(np.int16)-y.astype(np.int16));df=a.astype(float)-b;rmse=float(np.sqrt(np.mean(d.astype(float)**2)))
r={'reference':str(args.reference),'candidate':str(args.candidate),'floatMaxAbs':float(np.abs(df).max()),'floatRmse':float(np.sqrt(np.mean(df**2))),'rgbChangedChannels':int(np.count_nonzero(d)),'rgbChannels':d.size,'rgbMaxAbs':int(d.max()),'rgbMeanAbs':float(d.mean()),'rgbRmse':rmse,'rgbPsnrDb':20*math.log10(255/rmse) if rmse else None,'rgbExact':not bool(d.any())}
canvas=Image.new('RGB',(1536,550),'#151922');draw=ImageDraw.Draw(canvas)
for i,(name,img) in enumerate([('reference',x),('candidate',y),('difference-x255',np.clip(d*255,0,255).astype(np.uint8))]):
 Image.fromarray(img).save(args.out/(name+'.png'));canvas.paste(Image.fromarray(img).resize((512,512)),(i*512,38));draw.text((i*512+12,12),name,fill='white')
canvas.save(args.out/'comparison.png');(args.out/'metrics.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
