"""Fetch the candidate runtime's canary inputs (manifest.json pinned by digest, sample indices and each canary's
W+, samples and reference PNG) into a directory laid out as the runtime serves them, every file checked
against its digest; fails closed on any mismatch. Usage: python3 tests/fetch_canary_runtime.py <dir>"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

ORIGIN = 'https://next.facemorph.me'
# The candidate runtime manifest the device lab and qualification pin (runtime SHA d9e37e50...).
MANIFEST_SHA256 = 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c'


def fetch(url: str, sha256: str, dest: Path) -> bytes:
    if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() == sha256:
        return dest.read_bytes()
    # The origin refuses urllib's default user agent.
    request = urllib.request.Request(url, headers={'User-Agent': 'facemorph-model-conv canary fetch'})
    with urllib.request.urlopen(request, timeout=120) as r:
        data = r.read()
    if hashlib.sha256(data).hexdigest() != sha256:
        sys.exit(f'{url} does not match its pinned digest {sha256}')
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return data


def main(root: Path) -> int:
    manifest = json.loads(fetch(f'{ORIGIN}/runtime/manifest.json', MANIFEST_SHA256, root / 'manifest.json'))
    assets = [manifest['sampleIndices']] + [c[k] for c in manifest['canaries'] for k in ('w', 'samples', 'reference')]
    for a in assets:
        fetch(a['url'], a['sha256'], root / a['url'].split('/runtime/', 1)[1])
    print(json.dumps({'runtime': str(root), 'manifestSha256': MANIFEST_SHA256, 'assets': len(assets)}))
    return 0


if __name__ == '__main__':
    sys.exit(main(Path(sys.argv[1])))
