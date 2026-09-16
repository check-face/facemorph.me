"""Content-addressed native assets. Manifest is packaged, never renderer supplied."""
import hashlib
from pathlib import Path
import re
import ssl
import urllib.request
import certifi


def checksum(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def acquire(asset, root, progress=lambda *_: None):
    digest, size, url = asset['sha256'], asset['size'], asset['url']
    if not re.fullmatch('[0-9a-f]{64}', digest) or type(size) is not int or not 0 < size <= 2 * 1024**3:
        raise ValueError('Invalid pinned asset')
    if not url.startswith('https://'):
        raise ValueError('Assets require HTTPS')
    root = Path(root); root.mkdir(parents=True, exist_ok=True)
    target = root / digest
    if target.exists() and target.stat().st_size == size and checksum(target) == digest:
        return target
    partial = root / (digest + '.partial')
    offset = partial.stat().st_size if partial.exists() else 0
    if offset >= size:
        if offset == size and checksum(partial) == digest:
            partial.replace(target); return target
        partial.unlink(); offset = 0
    request = urllib.request.Request(url, headers={'User-Agent': 'FaceMorph-Preview/0.1 model-acquisition', **({'Range': f'bytes={offset}-'} if offset else {})})
    # Frozen Python must not depend on the build machine's OpenSSL CA path.
    with urllib.request.urlopen(request, timeout=120, context=ssl.create_default_context(cafile=certifi.where())) as response:
        if not response.url.startswith('https://'):
            raise ValueError('Insecure asset redirect')
        if offset and response.status == 206:
            content_range = response.headers.get('Content-Range', '')
            if content_range != f'bytes {offset}-{size-1}/{size}':
                raise ValueError('Incorrect resumed range')
        else:
            offset = 0
        with partial.open('ab' if offset else 'wb') as output:
            total = offset
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > size:
                    raise ValueError('Asset exceeds pinned size')
                output.write(chunk); progress(total, size)
    if partial.stat().st_size != size or checksum(partial) != digest:
        partial.unlink(missing_ok=True)
        raise ValueError('Asset integrity mismatch')
    partial.replace(target)
    return target
