"""verify: every output file against the manifest, then the converted graphs against the upstream reference.

The reference is upstream stylegan2-ada-pytorch running the original checkpoint (its own mapping with the
declared truncation, its own constant noise); it never reads a converted file. The converted side runs
under ONNX Runtime CPU the way the product does: mapping, truncation against average.f32, then synthesis
with the noise files. Judged against the declaration's tolerance, fixed before the run.
"""
import json
import os
from pathlib import Path

import numpy as np

from . import manifest as mf
from .models import ModelDeclaration, declaration
from .upstream import UPSTREAM, UPSTREAM_REVISION, file_sha256, load_generator


def to_uint8(raw):
    """Legacy TF convert_images_to_uint8: scale, +0.5, saturating cast (classic phase1_export)."""
    return np.clip(raw * 127.5 + 128, 0, 255).astype(np.uint8)


def check_files(out: Path, manifest: dict, decl: ModelDeclaration) -> tuple[list[str], bytes]:
    """Problems with the files on disk, and the reassembled synthesis bytes."""
    problems = mf.problems(manifest, decl)
    for part in ['mapping', 'average']:
        rec = manifest[part]
        p = out / rec['file']
        if not p.exists() or mf.sha256(p.read_bytes()) != rec['sha256']:
            problems.append(f"{rec['file']}: missing or digest mismatch")
    for n in manifest['noise']:
        p = out / n['file']
        if not p.exists() or mf.sha256(p.read_bytes()) != n['sha256']:
            problems.append(f"{n['file']}: missing or digest mismatch")
    joined = b''
    for c in manifest['synthesis']['chunks']:
        p = out / c['file']
        data = p.read_bytes() if p.exists() else b''
        if mf.sha256(data) != c['sha256'] or len(data) != c['size']:
            problems.append(f"{c['file']}: missing or digest mismatch")
        joined += data
    if mf.sha256(joined) != manifest['synthesis']['sha256']:
        problems.append('reassembled synthesis does not match its digest')
    return problems, joined


def verify(checkpoint: Path, out: Path, seeds=(0, 1, 42), log=print) -> dict:
    import onnxruntime as ort
    import torch
    manifest = json.loads((out / 'manifest.json').read_text())
    decl = declaration(manifest['model']['key'])
    problems, synthesis_bytes = check_files(out, manifest, decl)
    from .convert import versions
    report = {'model': decl.key, 'descriptor': manifest['model'], 'manifestSha256': mf.sha256((out / 'manifest.json').read_bytes()),
              'tolerance': manifest['tolerance'], 'files': problems or 'all digests match', 'samples': [],
              'container': {'image': os.environ.get('MODEL_CONV_IMAGE', 'unrecorded (not run from the container)'),
                            'baseImage': os.environ.get('MODEL_CONV_BASE_IMAGE', 'unrecorded')},
              'versions': versions(), 'conversionFlags': manifest.get('provenance', {}).get('flags'),
              'reference': {'implementation': f'NVlabs/stylegan2-ada-pytorch@{UPSTREAM_REVISION}', 'module': str(UPSTREAM / 'legacy.py'),
                            'checkpoint': checkpoint.name, 'checkpointSha256': file_sha256(checkpoint)}}
    if problems:
        report['passed'] = False
        return report
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    mapping = ort.InferenceSession(str(out / 'mapping.onnx'), options, providers=['CPUExecutionProvider'])
    synthesis = ort.InferenceSession(synthesis_bytes, options, providers=['CPUExecutionProvider'])
    average = np.frombuffer((out / 'average.f32').read_bytes(), dtype='<f4')
    noise = {n['name']: np.frombuffer((out / n['file']).read_bytes(), dtype='<f4').reshape(n['shape']) for n in manifest['noise']}
    log('loading the upstream reference from the original checkpoint')
    g = load_generator(checkpoint, decl.source_sha256)
    worst_raw, worst_rgb = 0.0, 0
    for seed in seeds:
        z = np.random.RandomState(seed).randn(1, decl.z_dim).astype(np.float32)
        with torch.inference_mode():
            ref_w = g.mapping(torch.from_numpy(z), None, truncation_psi=decl.truncation_psi, truncation_cutoff=decl.truncation_cutoff)
            ref = g.synthesis(ref_w, noise_mode='const', force_fp32=True, fused_modconv=False).numpy()
        w = mapping.run(None, {'z': z})[0]
        w[:, :decl.truncation_cutoff] = average + (w[:, :decl.truncation_cutoff] - average) * np.float32(decl.truncation_psi)
        got = synthesis.run(None, {'w': w, **noise})[0]
        raw = float(np.abs(ref - got).max())
        rgb = int(np.abs(to_uint8(ref).astype(np.int16) - to_uint8(got).astype(np.int16)).max())
        row = {'seed': seed, 'maxWAbsError': float(np.abs(ref_w.numpy() - w).max()), 'maxRawAbsError': raw, 'maxRgbDifference': rgb}
        log(json.dumps(row))
        report['samples'].append(row)
        worst_raw, worst_rgb = max(worst_raw, raw), max(worst_rgb, rgb)
    report['maxRawAbsError'], report['maxRgbDifference'] = worst_raw, worst_rgb
    report['passed'] = worst_raw <= decl.tolerance.raw_float and worst_rgb <= decl.tolerance.rgb
    return report
