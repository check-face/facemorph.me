"""Freeze the native worker for the current OS/architecture, without model weights.

Run in the target architecture's isolated environment with requirements-product.txt.
The trusted product manifest must be provided by the release build, not the UI.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
from urllib.parse import urlparse

DESKTOP=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(DESKTOP/'native'))
from asset_store import acquire
def main():
    p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True);p.add_argument('--output',type=Path,default=DESKTOP/'packaged-native');p.add_argument('--expected-target');a=p.parse_args()
    actual_os={'Darwin':'macos','Windows':'windows','Linux':'linux'}.get(platform.system(),'unknown')
    actual_arch={'arm64':'arm64','aarch64':'arm64','x86_64':'x64','amd64':'x64'}.get(platform.machine().lower(),'unknown')
    if a.expected_target and a.expected_target!=f'{actual_os}-{actual_arch}':raise ValueError('Build interpreter architecture does not match requested artifact')
    manifest=json.loads(a.manifest.read_text())
    for key in ('mapping','synthesis','encoder','landmarks','average'):
        item=manifest.get(key,{})
        if not item.get('url','').startswith('https://') or len(item.get('sha256',''))!=64 or not isinstance(item.get('size'),int):raise ValueError(f'Pinned {key} asset required')
    if manifest.get('runtime',{}).get('version')!='1.24.3':raise ValueError('Runtime lock mismatch')
    # The directory is app resources; PyInstaller carries its own Python and libraries.
    work=DESKTOP/'native-build'
    subprocess.run([sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onedir','--name','checkface-worker',
                    '--distpath',str(work/'dist'),'--workpath',str(work/'build'),'--specpath',str(work),
                    '--paths',str(DESKTOP/'native'),'--collect-binaries','onnxruntime',
                    '--exclude-module','torch','--exclude-module','pandas','--exclude-module','matplotlib',
                    '--exclude-module','transformers','--exclude-module','onnx',
                    '--collect-submodules','scipy._external.array_api_compat.numpy',
                    '--collect-submodules','scipy._external.array_api_extra',
                    '--hidden-import','dlib','--hidden-import','alignment',str(DESKTOP/'native/product_worker.py')],check=True,env={**os.environ,'PYINSTALLER_CONFIG_DIR':str(work/'cache')})
    frozen=work/'dist/checkface-worker'/('checkface-worker.exe' if platform.system()=='Windows' else 'checkface-worker')
    subprocess.run([str(frozen),'--self-check'],check=True)
    if a.output.exists():raise ValueError('Use a fresh staging directory; refusing to replace an existing runtime')
    shutil.copytree(work/'dist/checkface-worker',a.output)
    shutil.copyfile(a.manifest,a.output/'manifest.json')
    shutil.copyfile(DESKTOP/'native/ALIGNMENT-LICENSE',a.output/'ALIGNMENT-LICENSE')
    files=[]
    for path in sorted(a.output.rglob('*')):
        if path.is_file():
            with path.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
            files.append({'path':path.relative_to(a.output).as_posix(),'sha256':digest,'size':path.stat().st_size})
    (a.output/'runtime-inventory.json').write_text(json.dumps({'schemaVersion':1,'platform':platform.system(),'architecture':platform.machine(),'python':platform.python_version(),'files':files},indent=2)+'\n')
    # Tauri resource mapping preserves the executable and its sibling _internal tree.
    # The shared product frontend reads the identical packaged manifest locally.
    frontend_runtime=DESKTOP/'frontend/runtime';frontend_runtime.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(a.manifest,frontend_runtime/'manifest.json')
    catalogue=json.loads((DESKTOP/'catalogue-source.json').read_text())
    catalogue_path=acquire(catalogue,work/'public-assets')
    shutil.copyfile(catalogue_path,DESKTOP/'frontend/catalogue.json')
    origins=set()
    def visit(value):
        if isinstance(value,dict):
            for key,item in value.items():
                if key in ('url','moduleUrl','wasmPaths') and isinstance(item,str) and item.startswith('https://'):
                    parsed=urlparse(item);origins.add(f'{parsed.scheme}://{parsed.netloc}')
                else:visit(item)
        elif isinstance(value,list):
            for item in value:visit(item)
    visit(manifest);allowed=' '.join(sorted(origins))
    images=' '.join(catalogue['imageOrigins'])
    csp=f"default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval' {allowed}; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: {images}; font-src 'self'; connect-src ipc: http://ipc.localhost 'self' {allowed}; object-src 'none'; frame-src 'none'"
    config={'bundle':{'resources':{str(a.output.resolve()):'native/'}},'app':{'security':{'csp':csp}}}
    (DESKTOP/'native-resources-config.json').write_text(json.dumps(config,indent=2)+'\n')
    subprocess.run([sys.executable,str(DESKTOP/'scripts/stage-native-notices.py'),'--output',str(a.output)],check=True)
    print(a.output)
if __name__=='__main__':main()
