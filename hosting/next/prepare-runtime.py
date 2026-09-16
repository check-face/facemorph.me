#!/usr/bin/env python3
"""Publish only verified, immutable runtime assets to independent static hosting."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
from urllib.parse import unquote, urlparse

CHUNK = 16 * 1024 * 1024
LIMIT = 25 * 1024 * 1024

def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def encode(value):
    return json.dumps(value, separators=(',', ':')).encode()

def freeze(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError(f'Immutable destination changed: {path.name}')
    else:
        path.write_bytes(data)

def admit_phone_candidate(manifest, descriptor, receipt_path):
    receipt = json.loads(receipt_path.read_text())
    report_path = (receipt_path.parent / receipt['report']).resolve()
    if sha(report_path) != receipt['reportSha256']:
        raise ValueError('Phone admission evidence changed')
    report = json.loads(report_path.read_text())
    product = report['product']; stats = product['encoderStats']
    qualification = product['encoderQualification']
    checks = [
        receipt['scope'] == 'friends-and-family-candidate',
        receipt['releaseQualified'] is False,
        report['completed'] is True, report['passed'] is True,
        report['synthesisExecuted'] is True, product['passed'] is True,
        product['width'] == 1024, product['height'] == 1024,
        product['maxRgb'] <= 1, product['didAlign'] is True,
        product['reopenedLatentCached'] is True, product['cacheOnlyNewWorkers'] == 0,
        qualification['passed'] is True, qualification['maxAbs'] <= 1e-4,
        stats['maxLiveSessions'] == 1, stats['liveSessions'] == 0,
        stats['wasmPeakBytes'] <= stats['hardWasmMaximumBytes'] <= 256 * 1024 * 1024,
        report['preprocessingSha256'] == manifest['alignmentSha256'] == descriptor['preprocessingSha256'],
        report['encoderManifestSha256'] == descriptor['sha256'] == qualification['manifestSha256'],
        stats['sourceEncoderSha256'] == descriptor['sourceEncoderSha256'] == qualification['sourceEncoderSha256'],
        all(item['rejected'] for item in report['strictRejections']),
        len(report['strictRejections']) >= 2,
    ]
    if not all(checks):
        raise ValueError('Phone candidate admission gates failed')
    manifest['encoderStream'].update(phoneAdmitted=True, releaseQualified=False,
        candidateAdmission={'scope': receipt['scope'], 'reportSha256': receipt['reportSha256'],
          'environment': report['executionEnvironment']['kind'], 'physicalPerformanceQualified': False})

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--phone-admission', type=Path)
    p.add_argument('--base', default='https://next.facemorph.me/runtime')
    a = p.parse_args(); source = a.source.resolve(); out = a.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((source / ('qualification-manifest.json' if (source / 'qualification-manifest.json').exists() else 'manifest.json')).read_text())
    inventory = json.loads((source / 'sources.private.json').read_text())
    old = manifest['mapping']['url'].split('/assets/')[0]
    replacements = {}; published = []
    def publish(relative, expected, size):
        relative = Path(relative); src = (source / relative).resolve()
        if relative.is_absolute() or '..' in relative.parts or source not in src.parents:
            raise ValueError('Unsafe source asset')
        if src.stat().st_size != size or sha(src) != expected:
            raise ValueError(f'Source integrity mismatch: {relative}')
        descriptor = {'url': a.base + '/' + relative.as_posix(), 'size': size, 'sha256': expected}
        if size > LIMIT:
            chunks = []
            with src.open('rb') as stream:
                while data := stream.read(CHUNK):
                    digest = hashlib.sha256(data).hexdigest(); name = f'chunks/{digest}.bin'
                    freeze(out / name, data)
                    chunks.append({'url': a.base + '/' + name, 'size': len(data), 'sha256': digest})
            descriptor['chunks'] = chunks
        else:
            dest = out / relative; dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists():
                if dest.stat().st_size != size or sha(dest) != expected:
                    raise ValueError('Immutable destination changed')
            else:
                shutil.copyfile(src, dest)
        replacements[old + '/' + relative.as_posix()] = descriptor
        published.append(descriptor)
        return descriptor
    for item in inventory:
        if Path(item['path']).name in ('ffmpeg-core.js', 'ffmpeg-core.wasm'):
            continue
        publish(item['path'], item['sha256'], item['size'])
    def rewrite(value):
        if isinstance(value, dict):
            if value.get('url') in replacements:
                replacement = replacements[value['url']]
                if value.get('sha256') != replacement['sha256'] or value.get('size') != replacement['size']:
                    raise ValueError('Manifest descriptor differs from verified inventory')
                return {**value, **replacement}
            return {k: rewrite(v) for k, v in value.items()}
        if isinstance(value, list):
            return [rewrite(v) for v in value]
        if isinstance(value, str) and value.startswith(old + '/'):
            return a.base + value[len(old):]
        return value
    manifest = rewrite(manifest)
    photo_source = source / 'photo'
    if (photo_source / 'manifest.json').exists():
        photo = json.loads((photo_source / 'manifest.json').read_text())
        identity = photo['preprocessingSha256']; prefix = 'photo/' + identity
        photo_out = out / prefix
        for name in ['photo-worker.mjs', 'image-header.mjs', 'sha256.mjs', 'photo-native.mjs', 'photo-native.wasm', 'THIRD_PARTY_NOTICES.txt']:
            data = (photo_source / name).read_bytes()
            key = 'dist/' + name if name.startswith('photo-native.') else name
            if hashlib.sha256(data).hexdigest() != photo['sources'][key]:
                raise ValueError('Photo dependency integrity mismatch')
            freeze(photo_out / name, data)
        photo = rewrite(photo)
        for key in ('module', 'wasm'):
            photo[key]['url'] = a.base + '/' + prefix + '/' + Path(photo[key]['url']).name
        data = encode(photo); freeze(photo_out / 'manifest.json', data)
        manifest['alignmentSha256'] = identity
        manifest['photo'] = {'manifestUrl': a.base + '/' + prefix + '/manifest.json', 'workerUrl': a.base + '/' + prefix + '/photo-worker.mjs', 'manifestSha256': hashlib.sha256(data).hexdigest(), 'workerSha256': photo['sources']['photo-worker.mjs']}
    stream_source = source / 'encoder-stream'
    if (stream_source / 'descriptor.json').exists():
        descriptor = json.loads((stream_source / 'descriptor.json').read_text())
        raw = (stream_source / 'manifest.json').read_bytes()
        if len(raw) != descriptor['size'] or hashlib.sha256(raw).hexdigest() != descriptor['sha256']:
            raise ValueError('Encoder manifest integrity mismatch')
        config = json.loads(raw); prefix = 'encoder-stream/' + descriptor['sha256']
        def stream_rewrite(value):
            if isinstance(value, dict):
                if all(key in value for key in ('url', 'sha256', 'size')):
                    url = value['url']; parsed = urlparse(url)
                    if not url.startswith(old + '/encoder-stream/'):
                        raise ValueError('Unexpected encoder dependency origin')
                    name = unquote(parsed.path.split('/encoder-stream/', 1)[1])
                    relative = Path(name)
                    if relative.is_absolute() or '..' in relative.parts:
                        raise ValueError('Unsafe encoder dependency')
                    file = (stream_source / relative).resolve()
                    if stream_source.resolve() not in file.parents:
                        raise ValueError('Encoder dependency escapes source')
                    if file.stat().st_size != value['size'] or sha(file) != value['sha256']:
                        raise ValueError('Encoder dependency integrity mismatch')
                    if file.stat().st_size > LIMIT:
                        raise ValueError('Encoder shard exceeds static-host limit')
                    freeze(out / prefix / relative, file.read_bytes())
                    return {**value, 'url': a.base + '/' + prefix + '/' + relative.as_posix()}
                return {k: stream_rewrite(v) for k, v in value.items()}
            if isinstance(value, list):
                return [stream_rewrite(v) for v in value]
            return value
        config = stream_rewrite(config)
        for name in ('ORT-LICENSE', 'ORT-ThirdPartyNotices.txt', 'memory-cap-receipt.json'):
            freeze(out / prefix / name, (stream_source / name).read_bytes())
        data = encode(config); freeze(out / prefix / 'manifest.json', data)
        manifest['encoderStream'] = {**descriptor, 'url': a.base + '/' + prefix + '/manifest.json', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    if a.phone_admission:
        admit_phone_candidate(manifest, descriptor, a.phone_admission)
    manifest['distribution'] = {'purpose': 'research-and-evaluation', 'notices': a.base + '/notices/index.html'}
    if 'codec' in manifest:
        for key, filename in [('module', 'ffmpeg-core.js'), ('wasm', 'ffmpeg-core.wasm')]:
            manifest['codec'][key]['url'] = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/' + filename
    def reject_local(value):
        if isinstance(value, dict):
            for item in value.values(): reject_local(item)
        elif isinstance(value, list):
            for item in value: reject_local(item)
        elif isinstance(value, str) and ('localhost' in value or '127.0.0.1' in value or value.startswith(old + '/')):
            raise ValueError('Publication retains local dependency')
    reject_local(manifest)
    if (stream_source / 'descriptor.json').exists(): reject_local(config)
    if (photo_source / 'manifest.json').exists(): reject_local(photo)
    full = encode(manifest)
    if len(manifest['canaries']) == 31:
        manifest['canaries'] = [manifest['canaries'][i] for i in (0, 25, 26, 27, 28, 29, 30)]
    small = encode(manifest)
    for filename, data in [('qualification-manifest.json', full), ('manifest.json', small)]:
        (out / filename).write_bytes(data)
        freeze(out / 'manifests' / (hashlib.sha256(data).hexdigest() + '.json'), data)
    (out / 'publication-receipt.json').write_bytes(encode({'assets': published, 'manifestSha256': hashlib.sha256(small).hexdigest(), 'qualificationSha256': hashlib.sha256(full).hexdigest()}))
    print(json.dumps({'manifestSha256': hashlib.sha256(small).hexdigest(), 'qualificationSha256': hashlib.sha256(full).hexdigest(), 'assets': len(published)}))

if __name__ == '__main__':
    main()
