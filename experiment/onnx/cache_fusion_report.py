"""Validate and summarize the saved cache-plus-fusion experiment, frame by frame."""
from pathlib import Path
import json,hashlib,math
import numpy as np
from PIL import Image,ImageDraw
R=Path(__file__).resolve().parents[3];P=R/'review-artifacts/browser-onnx-round8'
old=json.loads((R/'review-artifacts/browser-onnx-round5/local/cache.json').read_text())['rows'][0]['hashes'];rows=[];sheet=Image.new('RGB',(1536,3*550),'#151922');draw=ImageDraw.Draw(sheet)
for i in range(26):
 a=np.fromfile(P/f'baseline-{i}.f32',dtype='<f4');b=np.fromfile(P/f'segment-{i}.f32',dtype='<f4');assert a.size==b.size==3*1024*1024 and np.isfinite(a).all() and np.isfinite(b).all()
 assert hashlib.sha256(a.tobytes()).hexdigest()==old[i]
 pix=lambda z:np.clip(z*np.float32(127.5)+np.float32(128),0,255).astype(np.uint8)
 x,y=pix(a),pix(b);d=np.abs(x.astype(np.int16)-y.astype(np.int16));df=a.astype(float)-b
 row={'frame':i,'baselineExactToFullModel':True,'maxFloatAbs':float(np.abs(df).max()),'floatRmse':float(np.sqrt(np.mean(df*df))),'rgbChangedChannels':int(np.count_nonzero(d)),'rgbMax':int(d.max()),'rgbRmse':float(np.sqrt(np.mean(d.astype(float)**2))),'candidateSha256':hashlib.sha256(b.tobytes()).hexdigest()};rows.append(row)
 assert row['maxFloatAbs']<=.002 and row['rgbMax']<=1
 if i in [0,12,25]:
  j=[0,12,25].index(i)
  for col,(name,arr) in enumerate([('Cached control',x),('Cache + WGSL',y),('Difference x255',np.clip(d*255,0,255).astype(np.uint8))]):
   im=Image.fromarray(arr.reshape(3,1024,1024).transpose(1,2,0));im.save(P/f'frame-{i}-{col}.png');sheet.paste(im.resize((512,512)),(512*col,550*j+38));draw.text((512*col+12,550*j+12),f'Frame {i}: {name}',fill='white')
sheet.save(P/'comparison.png');orders=[]
for name in ['forward-order','reverse-order']:
 r=json.loads((P/(name+'.json')).read_text());base=next(x for x in r['rows'] if x['mode']=='baseline');candidate=next(x for x in r['rows'] if x['mode']=='segment');assert all(x.get('completed') for x in r['rows']);orders.append({'order':name,'baselineMsPerFace':base['msPerFace'],'candidateMsPerFace':candidate['msPerFace'],'latencyReductionPercent':100*(1-candidate['msPerFace']/base['msPerFace'])})
result={'decision':'Retain candidate for eligible style-mix; not ordinary all-layer morphs','orders':orders,'all26BaselineExactToFullModel':True,'maxFloatAbs':max(x['maxFloatAbs'] for x in rows),'rgbMax':max(x['rgbMax'] for x in rows),'totalChangedRgbChannels':sum(x['rgbChangedChannels'] for x in rows),'totalRgbChannels':26*3*1024*1024,'frames':rows};(P/'summary.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='frames'},indent=2))
