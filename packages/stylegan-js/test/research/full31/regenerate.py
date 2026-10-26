"""Regenerate the classic full31 research suite fixtures from the original checkpoint, not from TrueNAS.

Port of classic experiment/onnx/video_export.py (latents only) and experiment/onnx/qualification_fixtures.py
(facemorph.me-classic 027ab14+). The fixtures were review-artifacts/browser-onnx-qualification/: 31 cases,
an independent ORT 1.24.3 CPU FP32 spatial-synthesis reference (all RGB pixels plus 4091 regularly spaced
raw-float samples), compared at the frozen research gate of RGB <= 1 and sampled float <= 0.002.

Inputs, each checked by digest:
  - the FFHQ config-F checkpoint (upstream legacy loader, reference ops), for the 26 video-frame W+ latents:
    z = RandomState(20260913).randn(28, 512), mapping(z, psi 0.7, cutoff 8), frames 0..25;
  - the shipped runtime (.cache/runtime): synthesis-spatial.onnx, noise planes, average W, and the
    encoded-synthetic-photo W+ (classic browser-onnx-e4e/browser-w.f32, shipped as that product canary).
The seven product canaries are a subset of full31; the run reports whether the regenerated latents and
references reproduce the shipped canary bytes, which ties this regeneration to the classic fixtures.

  docker run --rm --user $(id -u):$(id -g) -v $CKPT:/checkpoints:ro -v $RUNTIME:/runtime:ro -v $OUT:/out \
    -v $PWD/packages/stylegan-js/test/research/full31:/full31:ro --entrypoint python facemorph/model-conv \
    /full31/regenerate.py --checkpoint /checkpoints/stylegan2-ffhq-config-f.pkl --runtime /runtime --out /out
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, '/opt/model-conv')
from model_conv.canaries import decode_png, product_rgb, runtime_bytes  # noqa: E402
from model_conv.upstream import load_generator  # noqa: E402

CHECKPOINT_SHA256 = 'adf127ea7bb8a7788c8bdeda3c9937f7310b669b09ecf799ca53a631ff46948d'
SEED, PREPARED, FRAMES, PSI, CUTOFF = 20260913, 28, 26, 0.7, 8


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def png(rgb: np.ndarray) -> bytes:
    """8-bit RGB PNG, filter 0 (the container has no Pillow); pixels are what matter, not the encoding."""
    import struct
    import zlib
    h, w, _ = rgb.shape
    raw = b''.join(b'\x00' + rgb[y].tobytes() for y in range(h))
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + \
        chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--checkpoint', type=Path, required=True)
    ap.add_argument('--runtime', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    import onnxruntime as ort
    import torch

    product = json.loads((args.runtime / 'manifest.json').read_text())
    g = load_generator(args.checkpoint, CHECKPOINT_SHA256)
    z = np.random.RandomState(SEED).randn(PREPARED, 512).astype('<f4')
    with torch.inference_mode():
        w = g.mapping(torch.from_numpy(z), None, truncation_psi=PSI, truncation_cutoff=CUTOFF).numpy().astype('<f4')
    noise = {n['name']: np.frombuffer(runtime_bytes(args.runtime, n), dtype='<f4').reshape(n['shape']) for n in product['noise']}
    avg = np.frombuffer(runtime_bytes(args.runtime, product['average']), dtype='<f4')
    canary = {c['name']: c for c in product['canaries']}
    photo_w = np.frombuffer(runtime_bytes(args.runtime, canary['encoded-synthetic-photo']['w']), dtype='<f4').reshape(1, 18, 512)

    cases = [(f'frame-{i:02}', w[i:i + 1].copy(), 'original') for i in range(FRAMES)]
    cases.append(('encoded-synthetic-photo', photo_w.copy(), 'original'))
    cases += [('zero-noise', w[:1].copy(), 'zero'), ('alternate-noise', w[:1].copy(), 'alternate')]
    for psi in [0., 1.]:  # the existing truncation rule on this W+ fixture, as in classic
        v = w[:1].copy()
        v[:, :8] = avg + (v[:, :8] - avg) * np.float32(psi)
        cases.append((f'trunc-psi-{psi:g}', v, 'original'))

    synthesis = runtime_bytes(args.runtime, product['synthesis']) if 'chunks' not in product['synthesis'] else \
        b''.join(runtime_bytes(args.runtime, c) for c in product['synthesis']['chunks'])
    if sha(synthesis) != product['synthesis']['sha256']:
        raise ValueError('synthesis bytes do not match the runtime digest')
    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    session = ort.InferenceSession(synthesis, so, providers=['CPUExecutionProvider'])
    indices = np.arange(0, 3 * 1024 * 1024, 769, dtype='<i4')
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'sample-indices.i32').write_bytes(indices.tobytes())
    shipped_indices = runtime_bytes(args.runtime, product['sampleIndices'])
    rows, files = [], {'sample-indices.i32': sha(indices.tobytes())}
    for name, v, mode in cases:
        feed = dict(noise)
        if mode == 'zero':
            feed = {k: np.zeros_like(a) for k, a in noise.items()}
        if mode == 'alternate':
            feed = {k: -a for k, a in noise.items()}
        raw = session.run(None, dict(feed, w=v))[0]
        flat = raw.reshape(-1)
        rgb = product_rgb(raw)
        out = {f'{name}.w.f32': v.astype('<f4').tobytes(), f'{name}.samples.f32': flat[indices].astype('<f4').tobytes(),
               f'{name}.png': png(rgb)}
        for file, data in out.items():
            (args.out / file).write_bytes(data)
            files[file] = sha(data)
        row = {'name': name, 'noise': mode, 'w': f'{name}.w.f32', 'reference': f'{name}.png', 'samples': f'{name}.samples.f32'}
        if name in canary:
            c = canary[name]
            ref_rgb = decode_png(runtime_bytes(args.runtime, c['reference']))[..., :3]
            ref_samples = np.frombuffer(runtime_bytes(args.runtime, c['samples']), dtype='<f4')
            row['shippedCanary'] = {
                'wIdentical': sha(out[f'{name}.w.f32']) == c['w']['sha256'],
                'samplesIdentical': sha(out[f'{name}.samples.f32']) == c['samples']['sha256'],
                'maxRgbVsShipped': int(np.abs(rgb.astype(np.int16) - ref_rgb.astype(np.int16)).max()),
                'maxFloatVsShipped': float(np.abs(flat[indices] - ref_samples).max()),
            }
        rows.append(row)
        print(json.dumps(row), flush=True)
    manifest = {'reference': 'ORT %s CPU spatial FP32; all RGB pixels and 4091 regularly spaced float samples; '
                'synthetic photo only; regenerated from the checkpoint and shipped runtime (no TrueNAS copy)' % ort.__version__,
                'cases': rows, 'sampleIndices': 'sample-indices.i32',
                'sampleIndicesIdenticalToShipped': sha(shipped_indices) == files['sample-indices.i32'],
                'inputs': {'checkpointSha256': CHECKPOINT_SHA256, 'runtimeManifestSha256': sha((args.runtime / 'manifest.json').read_bytes()),
                           'synthesisSha256': product['synthesis']['sha256'], 'noiseSha256': product.get('noiseSha256'),
                           'latents': {'seed': SEED, 'prepared': PREPARED, 'psi': PSI, 'cutoff': CUTOFF,
                                       'wSha256': sha(w.tobytes()), 'zSha256': sha(z.tobytes())}},
                'versions': {'torch': torch.__version__, 'onnxruntime': ort.__version__, 'numpy': np.__version__},
                'files': files}
    (args.out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'cases': len(rows), 'sampleIndicesIdenticalToShipped': manifest['sampleIndicesIdenticalToShipped']}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
