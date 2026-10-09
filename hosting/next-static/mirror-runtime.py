#!/usr/bin/env python3
"""Rebuild the public runtime directory from the pinned manifest, for a CI deploy.

Promotion used to stage from a runtime directory on an operator's machine, so only that machine
could deploy. The runtime is content-addressed and already public, so CI can rebuild the exact
same tree: every file the manifest names is fetched from the origin, or from the overlay when the
overlay carries it, and checked against its pinned size and SHA-256 before it is kept. Pinned
manifests inside the runtime (photo, encoder-stream) are followed the same way, including entries
named by a `file` relative to their manifest. Which host the bytes come from does not matter, since
each one is checked against its pin: when the origin lacks a file, any --fallback origins are
tried. A file already in --output with the right digest is not fetched
again, so an actions/cache of --output makes a redeploy cost only what changed.

An asset that is served in chunks is mirrored as its chunks only: the whole file is above the
25 MiB static-asset limit and is never served. Fails closed on any mismatch or missing file.
"""
import argparse, hashlib, json, shutil, sys, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser()
p.add_argument('--overlay', type=Path, default=Path(__file__).resolve().parent / 'runtime-overlay')
p.add_argument('--origin', default='https://next.facemorph.me')
p.add_argument('--fallback', action='append', default=[])
p.add_argument('--output', type=Path, required=True)
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

def download(rel, tmp):
    for host in [a.origin, *a.fallback]:
        request = urllib.request.Request(host.rstrip('/') + '/runtime/' + rel, headers={'User-Agent': 'facemorph-ci-mirror'})
        try:
            with urllib.request.urlopen(request, timeout=300) as r, open(tmp, 'wb') as out: shutil.copyfileobj(r, out, 1 << 20)
            return
        except urllib.error.HTTPError as error:
            if error.code != 404: raise
    raise SystemExit(f'No origin serves runtime/{rel}')

def fetch(rel, sha256, size):
    dest = a.output / rel
    if dest.is_file() and (size is None or dest.stat().st_size == size) and digest(dest) == sha256: return 'kept'
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + '.part')
    if (a.overlay / rel).is_file(): shutil.copyfile(a.overlay / rel, tmp)
    else: download(rel, tmp)
    if (size is not None and tmp.stat().st_size != size) or digest(tmp) != sha256:
        tmp.unlink(); raise SystemExit(f'Digest mismatch: runtime/{rel}')
    tmp.replace(dest)
    return 'fetched'

def pinned(node, base, out):
    """Every pinned file in a manifest, as {relative path: (sha256, size)}; a chunked asset
    contributes its chunks only (the whole file is never served)."""
    if isinstance(node, dict):
        if isinstance(node.get('manifestUrl'), str) and node.get('manifestSha256'):
            out[relative(node['manifestUrl'])] = (node['manifestSha256'], None)
            if node.get('workerUrl'): out[relative(node['workerUrl'])] = (node['workerSha256'], None)
        sha = node.get('sha256')
        if isinstance(sha, str) and len(sha) == 64 and isinstance(node.get('size'), int):
            if node.get('chunks'): pinned(node['chunks'], base, out); return
            if isinstance(node.get('url'), str): out[relative(node['url'])] = (sha, node['size']); return
            if isinstance(node.get('file'), str) and '/' not in node['file']: out[f"{base}/{node['file']}" if base else node['file']] = (sha, node['size']); return
        for value in node.values(): pinned(value, base, out)
    elif isinstance(node, list):
        for value in node: pinned(value, base, out)

a.output.mkdir(parents=True, exist_ok=True)
manifest_bytes = (a.overlay / 'manifest.json').read_bytes()
(a.output / 'manifest.json').write_bytes(manifest_bytes)
files, done, results = {}, set(), []
pinned(json.loads(manifest_bytes), '', files)
with ThreadPoolExecutor(8) as pool:
    while pending := [rel for rel in files if rel not in done]:
        results += pool.map(lambda rel: fetch(rel, *files[rel]), pending); done.update(pending)
        # A pinned manifest inside the runtime names more files, relative to its own directory.
        for rel in pending:
            if rel.endswith('manifest.json'): pinned(json.loads((a.output / rel).read_bytes()), rel.rsplit('/', 1)[0], files)
wanted = set(files) | {'manifest.json'}
# The photo worker imports its siblings (align-photo, image-header, sha256) by relative URL and
# none of them is a manifest asset: the first CI deploy published the worker alone and every photo
# failed with "The local alignment worker stopped". The photo manifest pins the source of each file
# photo-runtime/stage.py publishes, so they come from the repository, checked against those pins.
for rel in [r for r in files if r.startswith('photo/') and r.endswith('/manifest.json')]:
    sources = json.loads((a.output / rel).read_bytes()).get('sources', {})
    for name in ['align-photo.mjs', 'photo-worker.mjs', 'image-header.mjs', 'sha256.mjs', 'THIRD_PARTY_NOTICES.txt']:
        source = REPO / 'photo-runtime' / name
        if hashlib.sha256(source.read_bytes()).hexdigest() != sources.get(name):
            raise SystemExit(f'photo-runtime/{name} differs from the source {rel} pins')
        target = rel.rsplit('/', 1)[0] + '/' + name
        shutil.copyfile(source, a.output / target); wanted.add(target)
# The model and runtime notices the manifest links to are published with every runtime.
(a.output / 'notices').mkdir(exist_ok=True)
for notice in (REPO / 'hosting' / 'next' / 'notices').iterdir():
    shutil.copyfile(notice, a.output / 'notices' / notice.name); wanted.add('notices/' + notice.name)
# Anything left from an older runtime in a restored cache must not be published with this one.
for stale in [f for f in a.output.rglob('*') if f.is_file() and f.relative_to(a.output).as_posix() not in wanted]: stale.unlink()
# A module that imports a sibling the tree lacks fails only in a browser; catch it here.
import re
for module in a.output.rglob('*.mjs'):
    for target in re.findall(r"""(?:from|import\()\s*['"](\./[^'"]+)['"]""", module.read_text(errors='ignore')):
        if not (module.parent / target).is_file(): raise SystemExit(f'{module.relative_to(a.output)} imports missing {target}')
fetched = sum(1 for how in results if how == 'fetched')
print(json.dumps({'files': len(wanted), 'fetched': fetched, 'kept': len(results) - fetched,
                  'bytes': sum(f.stat().st_size for f in a.output.rglob('*') if f.is_file()),
                  'manifestSha256': hashlib.sha256(manifest_bytes).hexdigest()}))
