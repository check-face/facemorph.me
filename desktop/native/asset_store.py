"""Content-addressed native assets. Manifest is packaged, never renderer supplied."""
import hashlib
import http.client
from pathlib import Path
import re
import ssl
import time
import urllib.error
import urllib.request
import certifi


def checksum(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def acquire(asset, root, progress=lambda *_: None):
    if asset.get('chunks') is not None:
        return _acquire_once(asset,root,progress) # Each chunk has its own bounded retry.
    for attempt in range(3):
        try:
            return _acquire_once(asset,root,progress)
        except urllib.error.HTTPError as error:
            if error.code not in (408,429,500,502,503,504) or attempt==2:raise
        except urllib.error.URLError as error:
            if isinstance(error.reason,ssl.SSLCertVerificationError) or attempt==2:raise
        except (ConnectionError,TimeoutError,http.client.IncompleteRead,ssl.SSLEOFError):
            if attempt==2:raise
        time.sleep(2**attempt)


def _acquire_once(asset, root, progress):
    digest, size, url = asset['sha256'], asset['size'], asset['url']
    if not re.fullmatch('[0-9a-f]{64}', digest) or type(size) is not int or not 0 < size <= 2 * 1024**3:
        raise ValueError('Invalid pinned asset')
    if not url.startswith('https://'):
        raise ValueError('Assets require HTTPS')
    chunks = asset.get('chunks')
    if chunks is not None:
        if not isinstance(chunks,list) or not 1 <= len(chunks) <= 128:
            raise ValueError('Invalid asset chunks')
        for chunk in chunks:
            if not isinstance(chunk,dict) or 'chunks' in chunk or not re.fullmatch('[0-9a-f]{64}',chunk.get('sha256','')) or type(chunk.get('size')) is not int or not 0 < chunk['size'] <= 16*1024**2 or not chunk.get('url','').startswith('https://'):
                raise ValueError('Invalid pinned asset chunk')
        if sum(chunk['size'] for chunk in chunks) != size:
            raise ValueError('Asset chunk sizes do not match')
    root = Path(root); root.mkdir(parents=True, exist_ok=True)
    target = root / digest
    if target.exists() and target.stat().st_size == size and checksum(target) == digest:
        return target
    if chunks is not None:
        # Verified chunks survive interruption; only the complete verified file is
        # promoted for model use. Reassembly uses at most one MiB of Python memory.
        assembly = root / (digest + '.assembling')
        completed = 0
        try:
            with assembly.open('wb') as output:
                for chunk in chunks:
                    part = acquire(chunk,root/'chunks',lambda done,total:progress(completed+done,size))
                    with part.open('rb') as source:
                        while block := source.read(1024*1024):output.write(block)
                    completed += chunk['size'];progress(completed,size)
            if assembly.stat().st_size != size or checksum(assembly) != digest:
                raise ValueError('Reassembled asset integrity mismatch')
            assembly.replace(target)
            return target
        finally:
            assembly.unlink(missing_ok=True)
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
    actual = partial.stat().st_size
    if actual < size:
        raise http.client.IncompleteRead(b'',size-actual)
    if actual != size or checksum(partial) != digest:
        partial.unlink(missing_ok=True)
        raise ValueError('Asset integrity mismatch')
    partial.replace(target)
    return target
