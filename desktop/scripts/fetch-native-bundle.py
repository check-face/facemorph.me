"""Download an operator-approved, SHA-256 pinned portable ZIP for diagnostic CI."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
import urllib.request
import zipfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native'))
from bundle_paths import resolve_assets

parser = argparse.ArgumentParser()
parser.add_argument('--url', required=True)
parser.add_argument('--sha256', required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
if not args.url.startswith('https://') or not re.fullmatch('[0-9a-f]{64}', args.sha256):
    parser.error('HTTPS URL and full lowercase SHA-256 required')
args.output.mkdir(parents=True, exist_ok=False)
archive = args.output / 'input.zip'
digest = hashlib.sha256()
with urllib.request.urlopen(args.url, timeout=60) as response, archive.open('wb') as target:
    if not response.url.startswith('https://'):
        raise ValueError('Insecure redirect')
    size = 0
    while chunk := response.read(1024 * 1024):
        size += len(chunk)
        if size > 2 * 1024**3: raise ValueError('Bundle download exceeds 2 GiB')
        digest.update(chunk)
        target.write(chunk)
if digest.hexdigest() != args.sha256: raise ValueError('Downloaded bundle checksum mismatch')
with zipfile.ZipFile(archive) as z:
    if len(z.infolist()) > 10000 or sum(i.file_size for i in z.infolist()) > 3 * 1024**3:
        raise ValueError('Oversized archive')
    seen = set()
    for item in z.infolist():
        name = PurePosixPath(item.filename)
        if name.is_absolute() or '..' in name.parts or '\\' in item.filename or ':' in item.filename or item.filename in seen:
            raise ValueError('Unsafe or duplicate archive path')
        seen.add(item.filename)
        if (item.external_attr >> 16) & 0o170000 == 0o120000:
            raise ValueError('Archive symlinks are forbidden')
        target = args.output / item.filename
        if item.is_dir(): target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(item) as source, target.open('xb') as output:
                import shutil
                shutil.copyfileobj(source, output)
manifest = args.output / 'bundle.json'
data = manifest.read_bytes()
if hashlib.sha256(data).hexdigest() != manifest.with_suffix('.sha256').read_text().strip():
    raise ValueError('Manifest integrity mismatch')
bundle = resolve_assets(json.loads(data), args.output, portable=True)
def verify(value):
    if isinstance(value, dict):
        if 'path' in value and 'sha256' in value:
            with Path(value['path']).open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != value['sha256']:
                    raise ValueError('Asset integrity mismatch')
        else:
            for item in value.values(): verify(item)
    elif isinstance(value, list):
        for item in value: verify(item)
verify(bundle)
archive.unlink()
print('Verified portable bundle and every inventoried asset; no inference claim')
