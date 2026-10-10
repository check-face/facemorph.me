#!/usr/bin/env python3
"""Build a resumable public-name-only catalogue supplement from pinned mapping assets.

Does not read source photos or recover arbitrary API cache identifiers. API images remain
lossy public previews; W+ is independently derived from exact lowercase public name identities.
Requires numpy, onnxruntime, Pillow. Publication is a separate verified step.
"""
import argparse, concurrent.futures, hashlib, io, json, subprocess, time, urllib.parse, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
def sha(data):return hashlib.sha256(data).hexdigest()
def fetch(url,limit=4*1024*1024):
    req=urllib.request.Request(url,headers={'User-Agent':'FaceMorph-public-catalogue/1'})
    with urllib.request.urlopen(req,timeout=60) as response:
        data=response.read(limit+1)
        if len(data)>limit:raise ValueError('Asset exceeds limit')
        return data

def main():
    import numpy as np
    import onnxruntime as ort
    from PIL import Image
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--origin',required=True);p.add_argument('--limit',type=int);a=p.parse_args()
    if not a.origin.startswith('https://'):raise ValueError('Use an HTTPS static origin')
    base=json.loads((ROOT/'hosting/next-static/catalogue.json').read_text());m=json.loads((ROOT/'hosting/next-static/runtime-overlay/manifest.json').read_text())
    names=base['names'];seen=set()
    for n in names:
        if n['value']!=n['value'].lower() or sha(n['value'].encode())!=n['id'] or n['id'] in seen:raise ValueError('Invalid public-name allowlist')
        seen.add(n['id'])
    a.output.mkdir(parents=True,exist_ok=True)
    for folder in ['full','latent']: (a.output/folder).mkdir(exist_ok=True)
    work=a.output.parent/'catalogue-inputs';work.mkdir(exist_ok=True)
    for key in ['mapping','average']:
        asset=m[key];path=work/key
        if not path.exists() or sha(path.read_bytes())!=asset['sha256']:
            data=fetch(asset['url'],asset['size']);assert len(data)==asset['size'] and sha(data)==asset['sha256'];path.write_bytes(data)
    # NumPy RandomState is the independent reference for the product's JS MT19937/Gaussian path.
    node="""import fs from 'node:fs';import {inputLatent,generationIdentity} from './src/Next/browser/identity.mjs';import {digest} from './src/Next/browser/originals.mjs';const names=JSON.parse(fs.readFileSync(0,'utf8'));const m=JSON.parse(fs.readFileSync('hosting/next-static/runtime-overlay/manifest.json'));const zs=[];for(const n of names)zs.push(await digest((await inputLatent('text',n)).values));console.log(JSON.stringify({zs,generationSha256:await digest(JSON.stringify(generationIdentity(m,'seed')))}));"""
    reference=json.loads(subprocess.run(['node','--input-type=module','-e',node],input=json.dumps([n['value'] for n in names]),text=True,cwd=ROOT,capture_output=True,check=True).stdout)
    options=ort.SessionOptions();options.intra_op_num_threads=1;options.inter_op_num_threads=1
    session=ort.InferenceSession(str(work/'mapping'),options,providers=['CPUExecutionProvider']);average=np.frombuffer((work/'average').read_bytes(),dtype='<f4')
    for i,n in enumerate(names):
        seed=np.frombuffer(bytes.fromhex(n['id']),dtype='<u4');z=np.random.RandomState(seed).randn(1,512).astype(np.float32)
        if sha(z.tobytes())!=reference['zs'][i]:raise ValueError('Independent input latent mismatch: '+n['value'])
        w=session.run(['w'],{'z':z})[0].astype(np.float32).reshape(18,512);w[:8]=average+(w[:8]-average)*np.float32(.7)
        if not np.isfinite(w).all():raise ValueError('Nonfinite mapping output')
        data=w.astype('<f4').tobytes();path=a.output/'latent'/f"{n['id']}.f32";path.write_bytes(data)
        n['latent']={'url':a.origin+'/latent/'+path.name,'sha256':sha(data),'size':len(data),'space':'w-plus','shape':[18,512],'modelSha256':m['modelSourceSha256'],'generationSha256':reference['generationSha256']}
    missing=[n for n in names if not n.get('full')]
    if a.limit:missing=missing[:a.limit]
    def image(n):
        path=a.output/'full'/f"{n['id']}.jpg"
        for attempt in range(3):
            try:
                data=path.read_bytes() if path.exists() else fetch('https://api.facemorph.me/api/face/?'+urllib.parse.urlencode({'value':n['value'],'dim':1024}))
                with Image.open(io.BytesIO(data)) as im:
                    if im.format!='JPEG' or im.size!=(1024,1024):raise ValueError('Invalid full-size API preview')
                    im.verify()
                path.write_bytes(data)
                return n,{'url':a.origin+'/full/'+path.name,'sha256':sha(data),'size':len(data),'quality':'api-lossy','width':1024,'height':1024}
            except Exception:
                if attempt==2:raise
                time.sleep(attempt+1)
    done=0
    # Network acquisition only; two requests bound remote load. Local heavy app jobs stay serial.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for n,asset in pool.map(image,missing):
            n['fullAsset']=asset;done+=1
            if done%100==0:print(json.dumps({'fullImages':done,'total':len(missing)}),flush=True)
    base.update(version='2026-10-10-v2',latentIdentity='pinned-mapping-numpy-z-truncation-0.7-8-v1')
    # Existing 2911 historic full-size URLs remain on their original static origin.
    (a.output/'catalogue.json').write_text(json.dumps(base,separators=(',',':'))+'\n')
    ledger=[{'path':str(f.relative_to(a.output)),'size':f.stat().st_size,'sha256':sha(f.read_bytes())} for f in sorted(a.output.rglob('*')) if f.is_file() and f.name!='ledger.json']
    (a.output/'ledger.json').write_text(json.dumps({'publicNameCount':len(names),'newFullCount':done,'independentZIdentities':len(reference['zs']),'mappingSha256':m['mapping']['sha256'],'averageSha256':m['average']['sha256'],'files':ledger},separators=(',',':'))+'\n')
    (a.output/'_headers').write_text('/*\n  Access-Control-Allow-Origin: *\n  Cross-Origin-Resource-Policy: cross-origin\n  Cache-Control: public, max-age=604800\n')
    print(json.dumps({'names':len(names),'newFullImages':done,'files':len(ledger),'output':str(a.output)}),flush=True)
if __name__=='__main__':main()
