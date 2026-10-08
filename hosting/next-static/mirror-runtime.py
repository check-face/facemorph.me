#!/usr/bin/env python3
"""Rebuild the public runtime directory from the pinned manifest, for a CI deploy.

Promotion used to stage from a runtime directory on an operator's machine, so only that machine
could deploy. The runtime is content-addressed and already public, so CI can rebuild the exact
same tree: every file the manifest (and the photo manifest it pins) names is fetched from the
origin, or from the overlay when the overlay carries it, and checked against its pinned size and
SHA-256 before it is kept. A file already in --output with the right digest is not fetched
again, so an actions/cache of --output makes a redeploy cost only what changed.

An asset that is served in chunks is mirrored as its chunks only: the whole file is above the
25 MiB static-asset limit and is never served. Fails closed on any mismatch or missing file.
"""
import argparse, hashlib, json, shutil, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--overlay', type=Path, default=Path(__file__).resolve().parent / 'runtime-overlay')
p.add_argument('--origin', default='https://next.facemorph.me')
p.add_argument('--output', type=Path, required=True)
p.add_argument('--photo-only', action='store_true', help='Only the photo directory (qualification serves the pinned assets itself)')
a = p.parse_args()
PREFIX = a.origin.rstrip('/') + '/runtime/'

def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''): h.update(block)
    return h.hexdigest()

def relative(url):
    if not url.startswith(PREFIX): raise SystemExit(f'Runtime URL outside {PREFIX}: {url}')
    rel = url[len(PREFIX):]
    if not rel or rel.endswith('/') or '..' in rel.split('/'): raise SystemExit(f'Unsafe runtime path: {url}')
    return rel

def fetch(url, sha256=None, size=None):
    rel = relative(url); dest = a.output / rel
    if dest.is_file() and (sha256 is None or (dest.stat().st_size == size and digest(dest) == sha256)): return rel, 'kept'
    dest.parent.mkdir(parents=True, exist_ok=True)
    local = a.overlay / rel
    tmp = dest.with_suffix(dest.suffix + '.part')
    if local.is_file(): shutil.copyfile(local, tmp)
    else:
        request = urllib.request.Request(url, headers={'User-Agent': 'facemorph-ci-mirror'})
        with urllib.request.urlopen(request, timeout=300) as r, open(tmp, 'wb') as out: shutil.copyfileobj(r, out, 1 << 20)
    if sha256 is not None and (tmp.stat().st_size != size or digest(tmp) != sha256):
        tmp.unlink(); raise SystemExit(f'Digest mismatch: {url}')
    tmp.replace(dest)
    return rel, 'fetched'

def pinned(node, out):
    """Every {url, sha256, size} in a manifest; a chunked asset contributes its chunks only."""
    if isinstance(node, dict):
        if isinstance(node.get('url'), str) and 'sha256' in node and 'size' in node:
            if node.get('chunks'): pinned(node['chunks'], out)
            else: out[node['url']] = (node['sha256'], node['size'])
            return
        for value in node.values(): pinned(value, out)
    elif isinstance(node, list):
        for value in node: pinned(value, out)

a.output.mkdir(parents=True, exist_ok=True)
manifest_bytes = (a.overlay / 'manifest.json').read_bytes()
manifest = json.loads(manifest_bytes)
(a.output / 'manifest.json').write_bytes(manifest_bytes)
files = {}
pinned(manifest, files)
photo = manifest.get('photo') or {}
photo_files = set()
if photo:
    for url, sha in ((photo['manifestUrl'], photo['manifestSha256']), (photo['workerUrl'], photo['workerSha256'])):
        rel = relative(url); dest = a.output / rel
        if not (dest.is_file() and digest(dest) == sha):
            dest.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'facemorph-ci-mirror'}), timeout=60) as r: data = r.read()
            if hashlib.sha256(data).hexdigest() != sha: raise SystemExit(f'Digest mismatch: {url}')
            dest.write_bytes(data)
    photo_manifest = json.loads((a.output / relative(photo['manifestUrl'])).read_bytes())
    pinned(photo_manifest, files)
    # The worker imports its siblings (align-photo, image-header, sha256) by relative URL, and none
    # of them is a manifest asset: the first CI deploy published the worker alone and every photo
    # failed with "The local alignment worker stopped". The photo manifest pins the source of each
    # file photo-runtime/stage.py publishes, so they come from the repository, checked against it.
    photo_dir = relative(photo['manifestUrl']).rsplit('/', 1)[0]
    for name in ['align-photo.mjs', 'photo-worker.mjs', 'image-header.mjs', 'sha256.mjs', 'THIRD_PARTY_NOTICES.txt']:
        source = Path(__file__).resolve().parents[2] / 'photo-runtime' / name
        if hashlib.sha256(source.read_bytes()).hexdigest() != photo_manifest['sources'][name]:
            raise SystemExit(f'photo-runtime/{name} differs from the source the pinned photo manifest names')
        shutil.copyfile(source, a.output / photo_dir / name); photo_files.add(f'{photo_dir}/{name}')
if a.photo_only: files = {}
with ThreadPoolExecutor(8) as pool:
    results = list(pool.map(lambda item: fetch(item[0], *item[1]), files.items()))
wanted = {rel for rel, _ in results} | {'manifest.json'}
# The model and runtime notices the manifest links to are published with every runtime.
notices = Path(__file__).resolve().parents[1] / 'next' / 'notices'
(a.output / 'notices').mkdir(exist_ok=True)
for notice in notices.iterdir():
    shutil.copyfile(notice, a.output / 'notices' / notice.name); wanted.add('notices/' + notice.name)
if photo: wanted |= {relative(photo['manifestUrl']), relative(photo['workerUrl'])} | photo_files
# Anything left from an older runtime in a restored cache must not be published with this one.
for stale in [f for f in a.output.rglob('*') if f.is_file() and f.relative_to(a.output).as_posix() not in wanted]: stale.unlink()
fetched = sum(1 for _, how in results if how == 'fetched')
print(json.dumps({'files': len(wanted), 'fetched': fetched, 'kept': len(results) - fetched,
                  'bytes': sum(f.stat().st_size for f in a.output.rglob('*') if f.is_file()),
                  'manifestSha256': hashlib.sha256(manifest_bytes).hexdigest()}))
