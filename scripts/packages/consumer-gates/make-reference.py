"""Full FFHQ arrays from the original checkpoint, inside the pinned converter image.

No converted graph is read. This uses the same upstream reference and seed/truncation
contract as model_conv.verify; the packed browser consumer compares every output value.
"""
import hashlib
import json
import os
import sys
from pathlib import Path

import numpy as np
import torch

from model_conv.convert import versions
from model_conv.models import declaration
from model_conv.upstream import UPSTREAM_REVISION, file_sha256, load_generator


def main(checkpoint: Path, out: Path):
    decl = declaration('stylegan2-ffhq-config-f')
    out.mkdir(parents=True, exist_ok=True)
    generator = load_generator(checkpoint, decl.source_sha256)
    cases = []
    for seed in (0, 1, 42):
        z = np.random.RandomState(seed).randn(1, decl.z_dim).astype(np.float32)
        with torch.inference_mode():
            w = generator.mapping(torch.from_numpy(z), None,
                                  truncation_psi=decl.truncation_psi,
                                  truncation_cutoff=decl.truncation_cutoff)
            raw = generator.synthesis(w, noise_mode='const', force_fp32=True,
                                      fused_modconv=False).numpy()
        row = {'seed': seed}
        for name, value in (('z', z), ('w', w.numpy()), ('raw', raw)):
            data = np.ascontiguousarray(value, dtype='<f4').tobytes()
            file = f'seed-{seed}.{name}.f32'
            (out / file).write_bytes(data)
            row[name] = {'file': file, 'shape': list(value.shape), 'size': len(data),
                         'sha256': hashlib.sha256(data).hexdigest()}
        cases.append(row)
    report = {
        'schema': 'facemorph-packed-ffhq-reference-v1',
        'model': decl.key,
        'checkpointSha256': file_sha256(checkpoint),
        'implementation': f'NVlabs/stylegan2-ada-pytorch@{UPSTREAM_REVISION}',
        'truncation': {'psi': decl.truncation_psi, 'cutoff': decl.truncation_cutoff},
        'synthesis': {'noiseMode': 'const', 'forceFp32': True, 'fusedModconv': False},
        'tolerance': {'rawFloat': decl.tolerance.raw_float, 'rgb': decl.tolerance.rgb},
        'container': os.environ['MODEL_CONV_IMAGE'],
        'versions': versions(),
        'cases': cases,
    }
    (out / 'reference.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]))
