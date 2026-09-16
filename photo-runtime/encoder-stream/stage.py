"""Stage the unchanged shards plus an explicitly capped serial ORT binary."""
from pathlib import Path
import argparse,hashlib,json,shutil
C=Path(__file__).resolve().parent;R=C.parents[1]
p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--base-url',required=True);p.add_argument('--preprocessing-manifest',type=Path);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
source=C/'assets';manifest=json.loads((source/'manifest.json').read_text());qualification=json.loads((C/'qualification/report.json').read_text());assert qualification['passed'] and qualification['manifestSha256']==hashlib.sha256((source/'manifest.json').read_bytes()).hexdigest()
if a.preprocessing_manifest:
 manifest['preprocessingSha256']=json.loads(a.preprocessing_manifest.read_text())['preprocessingSha256']
def sha(p):
 with p.open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def asset(name):
 p=a.out/name;return{'url':a.base_url.rstrip('/')+'/'+name,'size':p.stat().st_size,'sha256':sha(p)}
for step in manifest['steps']:
 assert sha(source/step['file'])==step['sha256'];shutil.copyfile(source/step['file'],a.out/step['file']);step['url']=asset(step['file'])['url']
runtime=R/'experiment/device-lab/ort-unshared-1243-v1'
original=(runtime/'ort-wasm-simd.wasm').read_bytes()
def read_leb(data,pos):
 n=0;shift=0
 while True:
  b=data[pos];pos+=1;n|=(b&127)<<shift;shift+=7
  if b<128:return n,pos
def leb(n):
 out=[]
 while True:
  b=n&127;n>>=7;out.append(b|(128 if n else 0))
  if not n:return bytes(out)
assert original[:8]==b'\x00asm\x01\x00\x00\x00';pos=8;patched=None;memory_receipt={}
while pos<len(original):
 kind=original[pos];size,start=read_leb(original,pos+1);end=start+size
 if kind==5:
  count,q=read_leb(original,start);flags,q=read_leb(original,q);minimum,q=read_leb(original,q);maximum,q=read_leb(original,q)
  assert count==1 and flags==1 and minimum==256 and maximum==65536 and q==end
  payload=leb(count)+leb(flags)+leb(minimum)+leb(4096);patched=original[:pos]+bytes([5])+leb(len(payload))+payload+original[end:]
  memory_receipt={'sourceSha256':hashlib.sha256(original).hexdigest(),'sourceMaximumPages':maximum,'initialPages':minimum,'newMaximumPages':4096,'changed':'Only internal memory section maximum, from4GiB to256MiB; no operators/code/data changed','unshared':True};break
 pos=end
assert patched is not None
(a.out/'ort-wasm-simd-256m.wasm').write_bytes(patched);memory_receipt['patchedSha256']=hashlib.sha256(patched).hexdigest()
shutil.copyfile(runtime/'ort-wasm-simd.mjs',a.out/'ort-wasm-simd.mjs')
shutil.copyfile(R/'experiment/onnx/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs',a.out/'ort.wasm.min.mjs')
shutil.copyfile(runtime/'LICENSE',a.out/'ORT-LICENSE');shutil.copyfile(runtime/'ThirdPartyNotices.txt',a.out/'ORT-ThirdPartyNotices.txt')
shutil.copyfile(C/'execute.mjs',a.out/'execute.mjs');shutil.copyfile(C/'qualification/report.json',a.out/'native-qualification.json')
manifest.update(runtime={'version':'1.24.3','unshared':True,'maxWasmBytes':268435456,'module':asset('ort.wasm.min.mjs'),'factory':asset('ort-wasm-simd.mjs'),'wasm':asset('ort-wasm-simd-256m.wasm'),'memoryReceipt':memory_receipt},qualifiedReferenceEvidence=asset('native-qualification.json'),browserQualified=False,phoneAdmitted=False,executor=asset('execute.mjs'))
manifest['canaries']=[]
for case in qualification['cases']:
 for name in [case['inputFile'],case['referenceFile']]:shutil.copyfile(C/'qualification'/name,a.out/name)
 manifest['canaries'].append({'id':case['id'],'input':asset(case['inputFile']),'reference':asset(case['referenceFile']),'threshold':0.0001})
(a.out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');(a.out/'memory-cap-receipt.json').write_text(json.dumps(memory_receipt,indent=2)+'\n')
descriptor={**asset('manifest.json'),'sourceEncoderSha256':manifest['sourceEncoderSha256'],'preprocessingSha256':manifest['preprocessingSha256'],'phoneAdmitted':False,'maxWasmBytes':268435456}
print(json.dumps(descriptor,indent=2));(a.out/'descriptor.json').write_text(json.dumps(descriptor,indent=2)+'\n')
