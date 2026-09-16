"""Independent unchanged Python alignment controls; does not execute candidate code."""
from pathlib import Path
import sys,json,hashlib,io
import numpy as np
from PIL import Image
import PIL,scipy,dlib
C=Path(__file__).resolve().parent;R=C.parent
sys.path.insert(0,str(R/'experiment/hf'))
from vendor.e4e.utils.alignment import align_face,NumberOfFacesError,get_landmarks,get_quad
P=R/'experiment/hf/models/e4e/shape_predictor_68_face_landmarks.dat'
assert hashlib.sha256(P.read_bytes()).hexdigest()=='fbdc2cb80eb9aa7a758672cbfdda32ba6300efe9b6e6c7a299ff7e736b11b92f'
predictor=dlib.shape_predictor(str(P));out=C/'fixtures';out.mkdir(exist_ok=True);cases=[]
inputs=[]
for seed in (0,1):
 image=Image.open(C/'fixture-sources'/f'seed-{seed}.png').convert('RGB');inputs.append((f'seed-{seed}',image))
 if seed==0:
  inputs.append(('seed-0-large',image.resize((1280,1280),Image.Resampling.BILINEAR)))
  inputs.append(('seed-0-border',image.crop((100,40,430,400))))
  inputs.append(('seed-0-jpeg',image.copy()))
  alpha=image.convert('RGBA');alpha.putalpha(Image.fromarray(np.tile(np.arange(512,dtype=np.uint8),(512,1))))
  inputs.append(('seed-0-alpha',alpha))
inputs.append(('no-face',Image.new('RGB',(256,256),(128,128,128))))
for name,image in inputs:
 input_name=name+('.jpg' if name.endswith('-jpeg') else '.png')
 image.save(out/input_name,**({'quality':93}if name.endswith('-jpeg')else{}));image=Image.open(out/input_name).convert('RGB');np.asarray(image).tofile(out/(name+'.rgb'))
 lm=list(get_landmarks(np.asarray(image),predictor));print(name,'faces',len(lm),flush=True)
 for do_align in (False,True):
  prepared=image.copy();did_align=False
  if do_align:
   try:prepared=align_face(None,predictor,img=prepared);did_align=True
   except NumberOfFacesError:pass
  prepared=prepared.resize((256,256),Image.Resampling.BILINEAR)
  suffix=name+('-aligned' if do_align else '-unaligned');rgb=np.asarray(prepared);rgb.tofile(out/(suffix+'.rgb'))
  tensor=((rgb.astype(np.float32)/255-.5)/.5).transpose(2,0,1).copy();tensor.tofile(out/(suffix+'.f32'))
  cases.append({'id':suffix,'input':input_name,'inputRgb':name+'.rgb','width':image.width,'height':image.height,'tryAlign':do_align,'didAlign':did_align,'landmarks':[x.tolist()for x in lm],'prepared':suffix+'.rgb','tensor':suffix+'.f32','preparedSha256':hashlib.sha256(rgb.tobytes()).hexdigest(),'tensorSha256':hashlib.sha256(tensor.tobytes()).hexdigest()})
(out/'manifest.json').write_text(json.dumps({'source':'Unmodified deployed alignment.py and Pillow RGB/bilinear preprocessing','sourceSha256':hashlib.sha256((R/'experiment/hf/vendor/e4e/utils/alignment.py').read_bytes()).hexdigest(),'versions':{'dlib':dlib.__version__,'pillow':PIL.__version__,'scipy':scipy.__version__,'numpy':np.__version__},'cases':cases},indent=2)+'\n')
