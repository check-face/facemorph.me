"""The independent reference for the descriptor-driven engine check (fm-qjcs): AFHQ cat 512 through the pinned
upstream implementation (NVlabs/stylegan2-ada-pytorch, the model-conv container's own tree), never through a
converted file. For each seed it writes z (NumPy legacy RandomState(seed).randn, float32), the truncated W+
(upstream mapping, psi 0.7, cutoff 8) and the raw synthesis output (noise_mode='const', force_fp32) as
little-endian float32 under OUT, plus reference.json with every digest and the provenance. The engine test
checks those digests against the committed copy of reference.json before comparing anything.

  cd packages/model-conv
  IMAGE="facemorph/model-conv@$(docker image inspect --format '{{.Id}}' facemorph/model-conv)"
  docker run --rm --user "$(id -u):$(id -g)" -e MODEL_CONV_IMAGE="$IMAGE" --entrypoint python \
    -v ~/.cache/facemorph-model-conv/checkpoints:/checkpoints:ro -v "$PWD/out":/out \
    -v "$PWD/../stylegan-js/test/vectors/afhq-cat-512":/script:ro \
    facemorph/model-conv /script/make-reference.py /checkpoints/afhqcat.pkl /out/afhqcat/reference
"""
import hashlib
import json
import os
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, '/opt/model-conv')
from model_conv.models import declaration  # noqa: E402
from model_conv.upstream import UPSTREAM_REVISION, file_sha256, load_generator  # noqa: E402
from model_conv.convert import versions  # noqa: E402

SEEDS = (0, 1)


def main(checkpoint: str, out: str) -> None:
    decl = declaration('stylegan2-ada-afhqcat')
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    g = load_generator(Path(checkpoint), decl.source_sha256)
    cases = []
    for seed in SEEDS:
        z = np.random.RandomState(seed).randn(1, decl.z_dim).astype(np.float32)
        with torch.inference_mode():
            w = g.mapping(torch.from_numpy(z), None, truncation_psi=decl.truncation_psi,
                          truncation_cutoff=decl.truncation_cutoff)
            raw = g.synthesis(w, noise_mode='const', force_fp32=True, fused_modconv=False)
        row = {'seed': seed}
        for name, value in (('z', z), ('w', w.numpy()), ('raw', raw.numpy())):
            data = np.ascontiguousarray(value, dtype='<f4').tobytes()
            file = f'seed-{seed}.{name}.f32'
            (out_dir / file).write_bytes(data)
            row[name] = {'file': file, 'shape': list(value.shape), 'size': len(data),
                         'sha256': hashlib.sha256(data).hexdigest()}
        cases.append(row)
    report = {
        'schema': 'facemorph-afhq-cat-512-reference-v1',
        'model': 'stylegan2-ada-afhqcat',
        'checkpointSha256': file_sha256(Path(checkpoint)),
        'implementation': f'NVlabs/stylegan2-ada-pytorch@{UPSTREAM_REVISION}',
        'truncation': {'psi': decl.truncation_psi, 'cutoff': decl.truncation_cutoff},
        'synthesis': {'noiseMode': 'const', 'forceFp32': True, 'fusedModconv': False},
        'tolerance': {'rawFloat': decl.tolerance.raw_float, 'rgb': decl.tolerance.rgb},
        'container': os.environ.get('MODEL_CONV_IMAGE', 'unrecorded'),
        'versions': versions(),
        'cases': cases,
    }
    (out_dir / 'reference.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
