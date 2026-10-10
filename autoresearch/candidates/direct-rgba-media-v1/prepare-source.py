"""Freeze source without a checkout/worktree, then patch a transient raw-frame candidate."""
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
SOURCE='b322a26858275f0e361127836d0fd1854e868ef9'
STATE=ROOT/'autoresearch/state/direct-rgba-source-v1'
CONTROL=STATE/'control'
CANDIDATE=STATE/'candidate'

def replace_once(text,old,new):
    if text.count(old)!=1:
        raise RuntimeError(f'Expected exactly one patch site: {old[:70]}')
    return text.replace(old,new)

if STATE.exists():
    raise RuntimeError('Immutable snapshot already exists; use its manifest or a new candidate ID')
CONTROL.mkdir(parents=True)
archive=subprocess.check_output(['git','archive',SOURCE,'src/Next/browser','src/Next/Assets'])
with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
    tar.extractall(CONTROL,filter='data')
shutil.copytree(CONTROL,CANDIDATE)
p=CANDIDATE/'src/Next/browser/ort-worker.mjs'
s=p.read_text()
s=replace_once(s,'const MAX_FRAMES=64;', '''const MAX_FRAMES=64;
const rawAcks=new Map();
function rawAck(id,index){return new Promise((resolve,reject)=>{
 const key=id+':'+index,timer=setTimeout(()=>{rawAcks.delete(key);reject(Error('Raw frame consumer timed out'));},30000);
 rawAcks.set(key,()=>{clearTimeout(timer);rawAcks.delete(key);resolve();});
});}
async function faceRgba(values,id){
 await load(id);if(!webgpu?.submitRgba)return rgba1024(await run(values,id));
 requireLatent(values);report(id,'synthesis');const start=performance.now();
 const rgba=await (await webgpu.submitRgba(values,noise)).rgba;report(id,'synthesis-complete',{elapsedMs:performance.now()-start});return rgba;
}''')
s=replace_once(s,'async function synthesizeFrames(list,id){','async function synthesizeFrames(list,id,rawOutput=false){')
s=replace_once(s,"if(!webgpu?.submit){for(let i=0;i<list.length;i++)postMessage({id,type:'frame',index:i,blob:await png(await run(list[i],id))});return {frames:list.length};}","""if(!webgpu?.submit){for(let i=0;i<list.length;i++){
 const raw=await run(list[i],id);
 if(rawOutput){const rgba=rgba1024(raw),ack=rawAck(id,i);postMessage({id,type:'frame',index:i,rgba:rgba.buffer,width:1024,height:1024},[rgba.buffer]);await ack;}
 else postMessage({id,type:'frame',index:i,blob:await png(raw)});
 }return {frames:list.length};}""")
old="const deliver=async(index,raw,isRgba=false)=>{const blob=isRgba?await encodeRgbaPng(raw):await png(raw),now=performance.now();report(id,'synthesis-complete',{elapsedMs:now-last});last=now;postMessage({id,type:'frame',index,blob});};"
new="""const deliver=async(index,raw,isRgba=false)=>{
 if(rawOutput){const rgba=isRgba?raw:rgba1024(raw),now=performance.now();report(id,'synthesis-complete',{elapsedMs:now-last});last=now;
  const ack=rawAck(id,index);postMessage({id,type:'frame',index,rgba:rgba.buffer,width:1024,height:1024},[rgba.buffer]);await ack;
 }else{const blob=isRgba?await encodeRgbaPng(raw):await png(raw),now=performance.now();report(id,'synthesis-complete',{elapsedMs:now-last});last=now;postMessage({id,type:'frame',index,blob});}
};"""
s=replace_once(s,old,new)
s=replace_once(s,"const {id,type,...request}=data;currentId=id;","const {id,type,...request}=data;if(type==='raw-frame-ack'){rawAcks.get(id+':'+request.index)?.();return;}currentId=id;")
s=replace_once(s,"result=await synthesizeFrames(request.frames,id);","result=await synthesizeFrames(request.frames,id,request.raw===true);")
s=replace_once(s,"result={blob:await faceBlob(values,id),values,shape:[1,18,512],space:'w-plus'};","result={...(request.raw===true?{rgba:(await faceRgba(values,id)).buffer,width:1024,height:1024}:{blob:await faceBlob(values,id)}),values,shape:[1,18,512],space:'w-plus'};")
s=replace_once(s,"postMessage({id,type:'complete',result});}","postMessage({id,type:'complete',result},result?.rgba?[result.rgba]:[]);}")
p.write_text(s)
p=CANDIDATE/'src/Next/browser/runtime.mjs';s=p.read_text()
s=replace_once(s,"if(data.type==='frame'){task.reset();task.onFrame?.(data.index,data.blob);return;}","""if(data.type==='frame'){task.reset();
 if(data.rgba){const owner=worker;Promise.resolve().then(()=>task.onFrame?.(data.index,data.blob,data.rgba)).then(()=>owner.postMessage({id:data.id,type:'raw-frame-ack',index:data.index})).catch(error=>stop(error));}
 else task.onFrame?.(data.index,data.blob);return;
}""")
s=replace_once(s,"const values=requireLatent(latent.values);return cachedGenerate({kind:'latent'", """const values=requireLatent(latent.values);
 if(options.raw===true){if(options.persist!==false)throw Error('Raw source candidate is transient only');await config();if(!validated)await admit(progress,signal);await start(progress);return send('synthesize',{values,raw:true},progress);}
 return cachedGenerate({kind:'latent'""")
s=replace_once(s,"{frames:list.slice(offset)}","{frames:list.slice(offset),raw:options.raw===true}")
s=replace_once(s,"(index,blob)=>{const at=offset+index;", "(index,blob,rgba)=>{const at=offset+index;")
s=replace_once(s,"options.onFrame?.(at,{blob,values:list[at],space:'w-plus',shape:[1,18,512]});", "return options.onFrame?.(at,{blob,rgba,width:1024,height:1024,values:list[at],space:'w-plus',shape:[1,18,512]});")
p.write_text(s)
hashes={}
for label,folder in [('control',CONTROL),('candidate',CANDIDATE)]:
    hashes[label]={str(p.relative_to(folder)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(folder.rglob('*')) if p.is_file()}
manifest={'source':SOURCE,'scope':'Runtime/worker transient raw-frame screening; not compiled UI qualification; unchanged kernels and cache policy','snapshots':str(STATE),'files':hashes}
(HERE/'source-snapshot.json').write_text(json.dumps(manifest,indent=2)+'\n')
for name in ['runtime.mjs','ort-worker.mjs']:
    import difflib
    a=(CONTROL/'src/Next/browser'/name).read_text().splitlines(keepends=True)
    b=(CANDIDATE/'src/Next/browser'/name).read_text().splitlines(keepends=True)
    (HERE/(name+'.patch')).write_text(''.join(difflib.unified_diff(a,b,fromfile='a/src/Next/browser/'+name,tofile='b/src/Next/browser/'+name)))
print(json.dumps({'source':SOURCE,'snapshot':str(STATE),'patches':['runtime.mjs.patch','ort-worker.mjs.patch']}))
