#!/usr/bin/env python3
"""Freeze public runtime URLs without exposing local source inventories."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--base',default='https://next.facemorph.me/runtime');a=p.parse_args()
    source=a.source.resolve();out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((source/('qualification-manifest.json' if (source/'qualification-manifest.json').exists() else 'manifest.json')).read_text());inventory=json.loads((source/'sources.private.json').read_text())
    old=manifest['mapping']['url'].split('/assets/')[0]
    # Inventory is local-only; copy only explicit checksummed asset files.
    for asset in inventory:
        relative=Path(asset['path'])
        if relative.name in ('ffmpeg-core.js','ffmpeg-core.wasm'):continue
        src=(source/relative).resolve()
        if source not in src.parents or relative.is_absolute() or '..' in relative.parts:raise ValueError('Unsafe source asset')
        if src.stat().st_size!=asset['size']:raise ValueError('Source size changed')
        with src.open('rb') as f:
            if hashlib.file_digest(f,'sha256').hexdigest()!=asset['sha256']:raise ValueError('Source hash changed')
        dest=out/relative;dest.parent.mkdir(parents=True,exist_ok=True)
        if dest.exists():
            with dest.open('rb') as f:
                if hashlib.file_digest(f,'sha256').hexdigest()!=asset['sha256']:raise ValueError('Immutable destination changed')
        else:shutil.copyfile(src,dest)
    def rewrite(value):
        if isinstance(value,str):return a.base+value[len(old):] if value.startswith(old+'/') else value
        if isinstance(value,list):return [rewrite(x) for x in value]
        if isinstance(value,dict):return {k:rewrite(v) for k,v in value.items()}
        return value
    manifest=rewrite(manifest)
    photo_source=source/'photo'
    if (photo_source/'manifest.json').exists():
        photo=rewrite(json.loads((photo_source/'manifest.json').read_text()))
        identity=photo['preprocessingSha256'];photo_out=out/'photo'/identity;photo_out.mkdir(parents=True,exist_ok=True)
        for name in ['photo-worker.mjs','image-header.mjs','sha256.mjs','photo-native.mjs','photo-native.wasm','THIRD_PARTY_NOTICES.txt']:
            shutil.copyfile(photo_source/name,photo_out/name)
        (photo_out/'manifest.json').write_text(json.dumps(photo,separators=(',',':')))
        manifest['alignmentSha256']=identity
        manifest['photo']={'manifestUrl':a.base+'/photo/'+identity+'/manifest.json','workerUrl':a.base+'/photo/'+identity+'/photo-worker.mjs'}
    manifest['distribution']={'purpose':'research-and-evaluation','notices':'https://next.facemorph.me/runtime/notices/index.html'}
    # The upstream GPL codec is acquired directly from its versioned publisher.
    if 'codec' in manifest:
        for key,filename in [('module','ffmpeg-core.js'),('wasm','ffmpeg-core.wasm')]:
            manifest['codec'][key]['url']='https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/'+filename
    full=out/'qualification-manifest.json';full.write_text(json.dumps(manifest,separators=(',',':')))
    if len(manifest['canaries'])==31:manifest['canaries']=[manifest['canaries'][i] for i in (0,25,26,27,28,29,30)]
    target=out/'manifest.json';target.write_text(json.dumps(manifest,separators=(',',':')))
    immutable=out/'manifests';immutable.mkdir(exist_ok=True)
    for file in [target,full]:
        data=file.read_bytes();(immutable/(hashlib.sha256(data).hexdigest()+'.json')).write_bytes(data)
    print(json.dumps({'manifestSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'qualificationSha256':hashlib.sha256(full.read_bytes()).hexdigest(),'assets':len(inventory),'deviceCanaries':len(manifest['canaries'])}))
if __name__=='__main__':main()
