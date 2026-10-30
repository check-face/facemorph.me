"""Fetch checksummed upstream sources and the pinned Emscripten toolchain for build.py.

Developer-only. Everything lands in the work directory outside the repository (PHOTO_NATIVE_WORK, default
~/.cache/facemorph-photo-native), so repository scans never see third-party trees. No production host access.
"""
from pathlib import Path
import hashlib, json, os, subprocess, tarfile, urllib.request
C = Path(__file__).resolve().parent
W = Path(os.environ.get('PHOTO_NATIVE_WORK', Path.home()/'.cache/facemorph-photo-native')); (W/'vendor').mkdir(parents=True, exist_ok=True)
for name in ['dlib', 'pillow', 'jpeg']:
    receipt = json.loads((C/'vendor'/f'{name}-source.json').read_text()); archive = W/'vendor'/receipt['url'].rsplit('/', 1)[1]
    if not archive.exists(): urllib.request.urlretrieve(receipt['url'], archive)
    with archive.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != receipt['sha256'] or archive.stat().st_size != receipt['bytes']: raise ValueError('Upstream source integrity failed: '+name)
    with tarfile.open(archive) as source: source.extractall(W/'vendor', filter='data')
sdk = W/'emsdk'; receipt = json.loads((C/'vendor/emsdk-source.json').read_text())
if not sdk.exists(): subprocess.run(['git', 'clone', '--filter=blob:none', '--no-checkout', receipt['repository'], str(sdk)], check=True)
subprocess.run(['git', '-C', str(sdk), 'checkout', '--detach', receipt['commit']], check=True)
subprocess.run([str(sdk/'emsdk'), 'install', receipt['toolchain']], check=True)
subprocess.run([str(sdk/'emsdk'), 'activate', receipt['toolchain']], check=True)
print('Pinned sources/toolchain ready in', W, '- run python3 apps/web/photo-native/build.py.')
