"""Build pinned dlib on native Windows ARM64; upstream setup hardcodes x64.

Selects ARM64 and disables upstream MSVC's x86-only SIMD defaults. No model bytes.
"""
import hashlib
import io
from pathlib import Path
import platform
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

URL='https://files.pythonhosted.org/packages/25/1e/17570a07f9db19014f5df9cc5de2b4acfb47834e9921e019372b51d7cc03/dlib-20.0.1.tar.gz'
SHA='7cb2a09467de032332c743bc967007f016598c66c9c9ebc54a5b66d3d9e46d54'
if platform.system()!='Windows' or platform.machine().lower() not in ('arm64','aarch64'):
    raise SystemExit('This patch is only for native Windows ARM64')
with urllib.request.urlopen(urllib.request.Request(URL,headers={'User-Agent':'FaceMorph-Preview/0.1 build-acquisition'}),timeout=60) as source:data=source.read(3327543)
if len(data)!=3327542 or hashlib.sha256(data).hexdigest()!=SHA:raise ValueError('Pinned dlib source mismatch')
with tempfile.TemporaryDirectory(prefix='checkface-dlib-') as temporary:
    root=Path(temporary)
    with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:archive.extractall(root,filter='data')
    source=root/'dlib-20.0.1';setup=source/'setup.py';code=setup.read_text()
    old="cmake_args += ['-A', 'x64']"
    if code.count(old)!=1:raise ValueError('dlib architecture patch does not match pinned source')
    setup.write_text(code.replace(old,"cmake_args += ['-A', 'ARM64', '-DUSE_SSE2_INSTRUCTIONS=OFF', '-DUSE_SSE4_INSTRUCTIONS=OFF', '-DUSE_AVX_INSTRUCTIONS=OFF']"))
    subprocess.run([sys.executable,'-m','pip','install','--no-build-isolation',str(source)],check=True)
