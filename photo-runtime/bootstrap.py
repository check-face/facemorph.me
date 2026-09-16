"""Fetch checksummed upstream source and the pinned Emscripten toolchain.

Developer-only. Downloads/builds belong under the shared local build lease when
this repository is used in the migration workspace. No production host access.
"""
from pathlib import Path
import hashlib,json,subprocess,tarfile,urllib.request
C=Path(__file__).resolve().parent
for name in ['dlib','pillow','jpeg']:
 receipt=json.loads((C/'vendor'/f'{name}-source.json').read_text());archive=C/'vendor'/receipt['url'].rsplit('/',1)[1]
 if not archive.exists():urllib.request.urlretrieve(receipt['url'],archive)
 with archive.open('rb')as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
 if digest!=receipt['sha256'] or archive.stat().st_size!=receipt['bytes']:raise ValueError('Upstream source integrity failed: '+name)
 with tarfile.open(archive)as source:source.extractall(C/'vendor',filter='data')
sdk=C/'work/emsdk';receipt=json.loads((C/'vendor/emsdk-source.json').read_text());sdk.parent.mkdir(exist_ok=True)
if not sdk.exists():subprocess.run(['git','clone','--filter=blob:none','--no-checkout',receipt['repository'],str(sdk)],check=True)
subprocess.run(['git','-C',str(sdk),'checkout','--detach',receipt['commit']],check=True)
subprocess.run([str(sdk/'emsdk'),'install',receipt['toolchain']],check=True)
subprocess.run([str(sdk/'emsdk'),'activate',receipt['toolchain']],check=True)
print('Pinned source/toolchain ready. Run python3 photo-runtime/build.py.')
