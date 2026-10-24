"""Product synthesis canaries: a converted synthesis against the candidate runtime's own canary references.

The candidate (classic a42829b src/Next/browser/canary-qualification.mjs) qualifies a route by running each
canary W+ through synthesis and comparing it with the canary's reference: every RGB channel after the
product output pipeline (identity.mjs rgba1024: trunc(clamp(fround(fround(v * 127.5) + 128), 0, 255)), alpha
excluded) within 1 of the reference PNG, and the raw float at the manifest's sample indices within 0.002 of
the recorded samples. Noise is the canary's mode as ort-worker.mjs run() applies it: original, zero, or
alternate (negated). This runs that comparison, unchanged, on a model-conv output under ONNX Runtime CPU.

  python3 -m model_conv.canaries --out /out/ffhq --runtime /runtime   (runtime: manifest.json + assets/ ...)
"""
import argparse
import hashlib
import json
import struct
import sys
import zlib
from pathlib import Path

import numpy as np

MAX_RGB, MAX_FLOAT = 1, 0.002  # frozen product canary gates (never widened)
NOISE_MODES = {'original', 'zero', 'alternate'}


def decode_png(data: bytes) -> np.ndarray:
    """8-bit RGB or RGBA, non-interlaced PNG -> H x W x C uint8 (all five filter types)."""
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG')
    at, idat, header = 8, [], None
    while at < len(data):
        size, = struct.unpack('>I', data[at:at + 4])
        kind, body = data[at + 4:at + 8], data[at + 8:at + 8 + size]
        at += 12 + size
        if kind == b'IHDR':
            header = struct.unpack('>IIBBBBB', body)
        elif kind == b'IDAT':
            idat.append(body)
        elif kind == b'IEND':
            break
    width, height, depth, colour, _, _, interlace = header
    if depth != 8 or colour not in (2, 6) or interlace:
        raise ValueError('only 8-bit RGB/RGBA non-interlaced PNGs are decoded here')
    bpp = 3 if colour == 2 else 4
    stride = width * bpp
    raw = zlib.decompress(b''.join(idat))
    out = bytearray(height * stride)
    prior = bytearray(stride)
    for y in range(height):
        kind = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if kind == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif kind == 2:
            line = bytearray((a + b) & 255 for a, b in zip(line, prior))
        elif kind == 3:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prior[i]) >> 1)) & 255
        elif kind == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prior[i]
                c = prior[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        elif kind != 0:
            raise ValueError(f'unknown PNG filter {kind}')
        out[y * stride:(y + 1) * stride] = line
        prior = line
    return np.frombuffer(bytes(out), dtype=np.uint8).reshape(height, width, bpp)


def product_rgb(raw: np.ndarray) -> np.ndarray:
    """The candidate's output pipeline on NCHW raw output -> H x W x 3 uint8."""
    v = (raw[0].astype(np.float32) * np.float32(127.5)).astype(np.float32) + np.float32(128)
    return np.trunc(np.clip(v, 0, 255)).astype(np.uint8).transpose(1, 2, 0)


def runtime_bytes(runtime: Path, asset: dict) -> bytes:
    """A runtime asset by the path its URL names under /runtime/, checked against its digest."""
    data = (runtime / asset['url'].split('/runtime/', 1)[1]).read_bytes()
    if hashlib.sha256(data).hexdigest() != asset['sha256'] or len(data) != asset['size']:
        raise ValueError(f"runtime asset {asset['url']} does not match its digest")
    return data


def check_canaries(out: Path, runtime: Path, log=print) -> dict:
    import onnxruntime as ort
    manifest = json.loads((out / 'manifest.json').read_text())
    product = json.loads((runtime / 'manifest.json').read_text())
    synthesis_bytes = b''.join((out / c['file']).read_bytes() for c in manifest['synthesis']['chunks'])
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(synthesis_bytes, options, providers=['CPUExecutionProvider'])
    noise = {n['name']: np.frombuffer((out / n['file']).read_bytes(), dtype='<f4').reshape(n['shape']) for n in manifest['noise']}
    shipped = {n['name']: n['sha256'] for n in product['noise']}
    indices = np.frombuffer(runtime_bytes(runtime, product['sampleIndices']), dtype='<i4')
    num_ws, w_dim = manifest['model']['numWs'], manifest['model']['wDim']
    report = {'runtimeManifestSha256': hashlib.sha256((runtime / 'manifest.json').read_bytes()).hexdigest(),
              'synthesisSha256': manifest['synthesis']['sha256'], 'shippedSynthesisSha256': product['synthesis']['sha256'],
              'noiseIdenticalToShipped': all(shipped.get(n['name']) == n['sha256'] for n in manifest['noise']),
              'gates': {'maxRgb': MAX_RGB, 'maxSampledFloat': MAX_FLOAT}, 'canaries': []}
    for c in product['canaries']:
        if c['noise'] not in NOISE_MODES:
            raise ValueError(f"unknown canary noise mode {c['noise']}")
        w = np.frombuffer(runtime_bytes(runtime, c['w']), dtype='<f4').reshape(1, num_ws, w_dim)
        feeds = {'w': w, **{k: v if c['noise'] == 'original' else np.zeros_like(v) if c['noise'] == 'zero' else -v for k, v in noise.items()}}
        raw = session.run(None, feeds)[0]
        expected = decode_png(runtime_bytes(runtime, c['reference']))[..., :3]
        samples = np.frombuffer(runtime_bytes(runtime, c['samples']), dtype='<f4')
        max_rgb = int(np.abs(product_rgb(raw).astype(np.int16) - expected.astype(np.int16)).max())
        max_float = float(np.abs(raw.reshape(-1)[indices] - samples).max())
        row = {'name': c['name'], 'noise': c['noise'], 'maxRgb': max_rgb, 'maxSampledFloat': max_float,
               'passed': bool(np.isfinite(max_float) and max_rgb <= MAX_RGB and max_float <= MAX_FLOAT)}
        log(json.dumps(row))
        report['canaries'].append(row)
    report['passed'] = all(r['passed'] for r in report['canaries'])
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog='python3 -m model_conv.canaries', description=__doc__.split('\n\n')[0])
    ap.add_argument('--out', type=Path, required=True, help='a model-conv output (manifest.json and its files)')
    ap.add_argument('--runtime', type=Path, required=True, help='the candidate runtime: manifest.json and the assets its URLs name')
    args = ap.parse_args(argv)
    report = check_canaries(args.out, args.runtime, log=lambda s: print(s, file=sys.stderr))
    (args.out / 'canaries.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ['passed', 'noiseIdenticalToShipped']} | {'canaries': len(report['canaries'])}))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
