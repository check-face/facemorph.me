"""Copy a frozen photo bundle into an explicitly selected local staging directory."""
from pathlib import Path
import argparse,json,hashlib,shutil
C=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--runtime-manifest',type=Path,required=True);a=p.parse_args()
runtime=json.loads(a.runtime_manifest.read_text());landmarks=runtime['landmarks']
if landmarks['sha256']!='fbdc2cb80eb9aa7a758672cbfdda32ba6300efe9b6e6c7a299ff7e736b11b92f':raise ValueError('Unexpected landmark model')
files=['align-photo.mjs','photo-worker.mjs','image-header.mjs','sha256.mjs','dist/photo-native.mjs','dist/photo-native.wasm','THIRD_PARTY_NOTICES.txt']
source_files=files+['native/photo.cpp','native/pillow_support.c','native/Python.h','build.py','vendor/dlib-source.json','vendor/pillow-source.json','vendor/jpeg-source.json']
identity={name:hashlib.sha256((C/name).read_bytes()).hexdigest()for name in source_files}
identity['landmarks']=landmarks['sha256'];identity['orientationPolicy']='legacy-ignore-exif'
preprocessing=hashlib.sha256(json.dumps(identity,sort_keys=True,separators=(',',':')).encode()).hexdigest()
a.out.mkdir(parents=True,exist_ok=True)
for name in files:shutil.copyfile(C/name,a.out/Path(name).name)
def asset(name):
 data=(a.out/name).read_bytes();return{'url':name,'sha256':hashlib.sha256(data).hexdigest(),'size':len(data)}
manifest={'schemaVersion':1,'preprocessingSha256':preprocessing,'orientationPolicy':'legacy-ignore-exif','landmarks':landmarks,'module':asset('photo-native.mjs'),'wasm':asset('photo-native.wasm'),'inputPolicy':{'maxBytes':25*1024*1024,'maxPixels':4*1024*1024,'formats':['PNG8','JPEG8 grayscale/RGB']},'sources':identity,'qualification':'Consult candidate verification and actual-browser report; staging is not qualification'}
(a.out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
for name in ['verification.json','dist/build-receipt.json']:
 if(C/name).exists():shutil.copyfile(C/name,a.out/Path(name).name)
print(json.dumps({'output':str(a.out),'preprocessingSha256':preprocessing,'module':manifest['module'],'wasm':manifest['wasm']},indent=2))
