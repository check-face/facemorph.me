#!/usr/bin/env python3
"""Rebuild parts of a staged runtime from their sources, without a full re-stage.

The rest of the bundle — CPU synthesis, WebGL, mapping, noise, canaries, landmarks, the photo
runtime and the 108-shard encoder stream — is already staged, verified and unchanged by this
script. Only the three assets that moved when the engine adopted the mobile-fusion split are
republished: the tiled prefix segment, its split description, and the bounded kernel. Everything
is content-addressed and chunked by exactly the rules in hosting/next/prepare-runtime.py, so the
output is indistinguishable from a full re-stage of this section.

Sources are the ones src/Next/browser/stage-assets.py already names for `--webgpu`; this script
exists because that script cannot be re-run without every other input it needs, and the section
it produces is the only part of the published bundle that is wrong.
"""
import argparse
import hashlib
import json
from pathlib import Path

import webgpu_contract

CHUNK = 16 * 1024 * 1024
LIMIT = 25 * 1024 * 1024
REPO = Path(__file__).resolve().parents[2]
RESEARCH = REPO.parent / 'review-artifacts'


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--runtime', type=Path, required=True, help='Staged runtime directory to update')
    p.add_argument('--base', default='https://next.facemorph.me/runtime')
    p.add_argument('--overlay', type=Path, help='Also write manifest.json and new assets here')
    p.add_argument('--webgpu', action='store_true', help='Rebuild the WebGPU section')
    p.add_argument('--codec', action='store_true', help='Self-host the ffmpeg video codec')
    a = p.parse_args()
    runtime = a.runtime.resolve()
    base = a.base.rstrip('/')
    added = []

    def freeze(path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            if path.read_bytes() != data:
                raise ValueError(f'Immutable destination changed: {path}')
            return False
        path.write_bytes(data)
        return True

    def publish(source):
        """One verified, content-addressed asset, chunked when it exceeds the static-host limit."""
        source = Path(source)
        digest = sha(source)
        size = source.stat().st_size
        relative = f'assets/{digest}/{source.name}'
        descriptor = {'url': f'{base}/{relative}', 'sha256': digest, 'size': size}
        if size > LIMIT:
            chunks = []
            with source.open('rb') as stream:
                while data := stream.read(CHUNK):
                    part = hashlib.sha256(data).hexdigest()
                    name = f'chunks/{part}.bin'
                    if freeze(runtime / name, data):
                        added.append(name)
                    chunks.append({'url': f'{base}/{name}', 'size': len(data), 'sha256': part})
            descriptor['chunks'] = chunks
        else:
            if freeze(runtime / relative, source.read_bytes()):
                added.append(relative)
        return descriptor

    # The same inputs src/Next/browser/stage-assets.py names under `--webgpu`. The prefix, split
    # and suffix come from browser-onnx-mobile-fusion (keep row mobile-boundary-bounded-phone);
    # the fused metadata, filter and bias are shared with the earlier fusion and unchanged.
    mobile = RESEARCH / 'browser-onnx-mobile-fusion'
    fusion = RESEARCH / 'browser-onnx-fusion'
    gpu_runtime = REPO / 'experiment/onnx/runtime-122/node_modules/onnxruntime-web/dist'
    kernel_file = REPO / 'src/Next/browser/fused-resample-v1.mjs'
    lab_kernel = REPO / 'experiment/device-lab/fused-resample-boundary-v2.js'
    if lab_kernel.exists() and sha(lab_kernel) != sha(kernel_file):
        raise ValueError('Shipped kernel is not byte-identical to the device-lab candidate')

    manifest_path = runtime / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    if not (a.webgpu or a.codec):
        raise SystemExit('Name at least one section to rebuild: --webgpu, --codec')
    before = dict(manifest.get('webgpu') or {})

    webgpu = {
        'runtime': {
            'version': '1.22.0',
            'module': publish(gpu_runtime / 'ort.webgpu.min.mjs'),
            'factory': publish(gpu_runtime / 'ort-wasm-simd-threaded.jsep.mjs'),
            'wasm': publish(gpu_runtime / 'ort-wasm-simd-threaded.jsep.wasm'),
        },
        'prefix': publish(mobile / 'prefix-segment.onnx'),
        'suffix': publish(mobile / 'suffix-segment.onnx'),
        'split': publish(mobile / 'split-segment.json'),
        'metadata': publish(fusion / 'manifest.json'),
        'filter': publish(fusion / 'filter.f32'),
        'bias': publish(fusion / 'bias.f32'),
        'kernel': publish(kernel_file),
    }
    # Provenance and the loaded asset are written from one value, so they cannot disagree again.
    kernel_sha = webgpu['kernel']['sha256']
    provenance = {
        'file': 'src/Next/browser/fused-resample-v1.mjs',
        'sha256': kernel_sha,
        'candidateId': 'mobile-boundary-bounded-phone',
        'sourceHash': '82bc9dd8a3128bd25c422eb36447787d4c041c4da79e7cad94aedeea1989dbd1',
        'url': webgpu['kernel']['url'],
    }

    changed = {key: (before.get(key, {}).get('sha256'), value.get('sha256'))
               for key, value in webgpu.items() if key != 'runtime'
               and before.get(key, {}).get('sha256') != value.get('sha256')} if a.webgpu else {}

    # The video codec used to be the one runtime dependency fetched from someone else's CDN
    # (cdn.jsdelivr.net), which breaks the binding no-third-party-CDN rule and quietly contradicts
    # the offline-capable-after-first-load claim: a device with every model cached still could not
    # export a video without reaching out. ffmpeg-core.wasm is ~31 MiB, so it chunks like any other
    # large asset. hosting/next/prepare-runtime.py now publishes it the same way for full re-stages.
    codec = None
    if a.codec:
        source = REPO / 'experiment/device-lab/node_modules/@ffmpeg/core/dist/esm'
        codec = {'version': '0.12.10',
                 'module': publish(source / 'ffmpeg-core.js'),
                 'wasm': publish(source / 'ffmpeg-core.wasm')}
        changed['codec'] = (manifest.get('codec', {}).get('module', {}).get('url', ''), codec['module']['url'])

    written = []
    for name in ('manifest.json', 'qualification-manifest.json'):
        path = runtime / name
        if not path.exists():
            continue
        document = json.loads(path.read_text())
        if a.webgpu:
            document['webgpu'] = webgpu
            document['kernel'] = provenance
        if codec:
            document['codec'] = codec
        data = json.dumps(document, separators=(',', ':')).encode()
        path.write_bytes(data)
        # prepare-runtime.py also serves every manifest by its own digest, immutably.
        freeze(runtime / 'manifests' / (hashlib.sha256(data).hexdigest() + '.json'), data)
        written.append({'file': name, 'sha256': hashlib.sha256(data).hexdigest()})

    webgpu_contract.require(runtime, json.loads(manifest_path.read_text()))

    if a.overlay:
        overlay = a.overlay.resolve()
        overlay.mkdir(parents=True, exist_ok=True)
        (overlay / 'manifest.json').write_bytes(manifest_path.read_bytes())
        # The overlay records the small, reviewable assets this section pins. Model segments stay
        # out of git; they are reproduced from review-artifacts by re-running this script.
        for relative in added:
            if (runtime / relative).stat().st_size <= 64 * 1024:
                freeze(overlay / relative, (runtime / relative).read_bytes())

    print(json.dumps({'changed': changed, 'added': len(added), 'manifests': written,
                      'webgpuBundleMatchesEngine': True}, indent=2))


if __name__ == '__main__':
    main()
