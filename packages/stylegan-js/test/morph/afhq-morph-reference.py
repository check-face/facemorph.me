"""The independent reference for an AFHQ cat 512 morph (fm-suaa): each path latent the package geometry wrote
(afhq-morph.ts latents) through the pinned upstream implementation (NVlabs/stylegan2-ada-pytorch, the model-conv
container's own tree) on the original checkpoint, noise_mode='const', force_fp32, never through a converted file.
Writes frame-<i>.raw.f32 (little-endian float32 [1,3,512,512]) and reference.json with every digest beside the
latents.

  cd packages/model-conv
  node ../stylegan-js/test/morph/afhq-morph.ts latents out/afhqcat/morph-reference
  IMAGE="facemorph/model-conv@$(docker image inspect --format '{{.Id}}' facemorph/model-conv)"
  docker run --rm --user "$(id -u):$(id -g)" -e MODEL_CONV_IMAGE="$IMAGE" --entrypoint python \
    -v ~/.cache/facemorph-model-conv/checkpoints:/checkpoints:ro -v "$PWD/out":/out \
    -v "$PWD/../stylegan-js/test/morph":/script:ro \
    facemorph/model-conv /script/afhq-morph-reference.py /checkpoints/afhqcat.pkl /out/afhqcat/morph-reference
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


def main(checkpoint: str, out: str) -> None:
    decl = declaration('stylegan2-ada-afhqcat')
    out_dir = Path(out)
    latents_bytes = (out_dir / 'latents.f32').read_bytes()
    spec = json.loads((out_dir / 'latents.json').read_text())
    if hashlib.sha256(latents_bytes).hexdigest() != spec['sha256']:
        raise SystemExit('latents.f32 does not match latents.json')
    latents = np.frombuffer(latents_bytes, dtype='<f4').reshape(spec['shape'])
    g = load_generator(Path(checkpoint), decl.source_sha256)
    frames = []
    for i, w in enumerate(latents):
        with torch.inference_mode():
            raw = g.synthesis(torch.from_numpy(w[None].copy()), noise_mode='const', force_fp32=True,
                              fused_modconv=False)
        data = np.ascontiguousarray(raw.numpy(), dtype='<f4').tobytes()
        file = f'frame-{i}.raw.f32'
        (out_dir / file).write_bytes(data)
        frames.append({'index': i, 'file': file, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    report = {
        'schema': 'facemorph-afhq-cat-512-morph-reference-v1',
        'model': 'stylegan2-ada-afhqcat',
        'checkpointSha256': file_sha256(Path(checkpoint)),
        'implementation': f'NVlabs/stylegan2-ada-pytorch@{UPSTREAM_REVISION}',
        'synthesis': {'noiseMode': 'const', 'forceFp32': True, 'fusedModconv': False},
        'tolerance': {'rawFloat': decl.tolerance.raw_float, 'rgb': decl.tolerance.rgb},
        'latents': spec,
        'container': os.environ.get('MODEL_CONV_IMAGE', 'unrecorded'),
        'versions': versions(),
        'frames': frames,
    }
    (out_dir / 'reference.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'frames': len(frames), 'latents': spec['sha256']}))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
