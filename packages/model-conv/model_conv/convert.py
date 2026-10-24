"""convert: checkpoint -> mapping.onnx, chunked synthesis, average W, noise planes, report and manifest.

The export follows classic experiment/onnx/phase1_export.py (mapping without truncation, synthesis taking W
and the 17 noise planes as inputs, batch one with static conv kernel shapes), then the three graph
transforms in transforms.py. Output is complete only when manifest.json exists: everything is built in a
staging directory beside the output and moved in at the end, with manifest.json written last, so a killed
or failed run leaves no output that claims to be complete.
"""
import json
import os
import platform
import shutil
import time
from pathlib import Path

from . import manifest as mf
from . import transforms
from .models import ModelDeclaration
from .upstream import UPSTREAM_REVISION, load_generator

STAGING_PREFIX = '.partial-'


def versions() -> dict:
    import numpy, onnx, onnxruntime, torch
    return {'python': platform.python_version(), 'torch': torch.__version__, 'onnx': onnx.__version__, 'onnxruntime': onnxruntime.__version__,
            'numpy': numpy.__version__, 'os': platform.platform(), 'upstream': f'NVlabs/stylegan2-ada-pytorch@{UPSTREAM_REVISION}'}


def clear_stale_staging(out: Path) -> list[str]:
    """Staging left by a killed run is never complete; remove it so it cannot be mistaken for output."""
    removed = []
    for p in out.parent.glob(f'{STAGING_PREFIX}{out.name}-*'):
        shutil.rmtree(p, ignore_errors=True)
        removed.append(p.name)
    return removed


def export(g, decl: ModelDeclaration, work: Path) -> dict:
    import numpy as np
    import torch
    from torch_utils.ops import conv2d_gradfix

    class Mapping(torch.nn.Module):
        def __init__(self, g):
            super().__init__()
            self.g = g

        def forward(self, z):
            return self.g.mapping(z, None, truncation_psi=1)

    class Synthesis(torch.nn.Module):
        def __init__(self, g):
            super().__init__()
            self.g = g
            self.layers = [m for m in g.synthesis.modules() if hasattr(m, 'noise_const')]

        def forward(self, w, *noise):
            for m, n in zip(self.layers, noise):
                m.noise_const = n
            return self.g.synthesis(w, noise_mode='const', force_fp32=True, fused_modconv=False)

    mapping, synthesis = Mapping(g), Synthesis(g)
    # Batch-one export: anchor convolution kernel dimensions after traced resampling.
    conv, transpose = torch.nn.functional.conv2d, torch.nn.functional.conv_transpose2d

    def static_conv(input, weight, *args, **kwargs):
        return conv(input, weight.reshape(tuple(int(d) for d in weight.shape)), *args, **kwargs)

    def static_transpose(input, weight, *args, **kwargs):
        return transpose(input, weight.reshape(tuple(int(d) for d in weight.shape)), *args, **kwargs)

    conv2d_gradfix.conv2d, conv2d_gradfix.conv_transpose2d = static_conv, static_transpose
    z = np.random.RandomState(0).randn(1, decl.z_dim).astype('<f4')
    noise = [m.noise_const.clone() for m in synthesis.layers]
    if [list(n.shape) for n in noise] != decl.noise_shapes():
        raise RuntimeError('checkpoint noise planes differ from the declaration')
    average = g.mapping.w_avg.numpy().astype('<f4')
    names = [f'noise_{i}' for i in range(len(noise))]
    with torch.inference_mode():
        w = mapping(torch.from_numpy(z))
        wt = w.clone()
        wt[:, :decl.truncation_cutoff] = g.mapping.w_avg + (wt[:, :decl.truncation_cutoff] - g.mapping.w_avg) * decl.truncation_psi
        torch.onnx.export(mapping, (torch.from_numpy(z),), str(work / 'mapping.onnx'), input_names=['z'], output_names=['w'], opset_version=decl.opset, dynamo=False)
        torch.onnx.export(synthesis, (wt, *noise), str(work / 'synthesis-export.onnx'), input_names=['w'] + names, output_names=['image'], opset_version=decl.opset, dynamo=False)
    (work / 'average.f32').write_bytes(average.tobytes())
    for name, n in zip(names, noise):
        (work / f'{name}.f32').write_bytes(n.numpy().astype('<f4').tobytes())
    return {'noise': names}


def convert(decl: ModelDeclaration, checkpoint: Path, out: Path, *, force: bool = False, log=print) -> dict:
    out = out.resolve()
    if (out / 'manifest.json').exists() and not force:
        raise FileExistsError(f'{out} already holds a complete conversion; pass --force to rebuild it')
    out.parent.mkdir(parents=True, exist_ok=True)
    for name in clear_stale_staging(out):
        log(f'removed incomplete staging {name}')
    started = time.time()
    staging = out.parent / f'{STAGING_PREFIX}{out.name}-{os.getpid()}'
    work = staging / 'work'
    work.mkdir(parents=True)
    try:
        log('loading the checkpoint through upstream legacy.load_network_pkl (trusted pickles only)')
        g = load_generator(checkpoint, decl.source_sha256)
        log('exporting mapping and synthesis')
        exported = export(g, decl, work)
        steps = []
        for fn, src, dst in [(transforms.simplify, 'synthesis-export.onnx', 'synthesis-simplified.onnx'),
                             (transforms.remove_dead_spatial, 'synthesis-simplified.onnx', 'synthesis-spatial-raw.onnx'),
                             (transforms.precompute_energy, 'synthesis-spatial-raw.onnx', 'synthesis.onnx')]:
            log(f'transform {fn.__name__}')
            steps.append(fn(work / src, work / dst))
        result = staging / 'result'
        (result / 'chunks').mkdir(parents=True)
        synthesis = (work / 'synthesis.onnx').read_bytes()
        plan = mf.chunks(synthesis, decl.chunk_bytes)
        for c, (at, n) in zip(plan, mf.chunk_plan(len(synthesis), decl.chunk_bytes)):
            (result / c['file']).write_bytes(synthesis[at:at + n])
        mapping = (work / 'mapping.onnx').read_bytes()
        (result / 'mapping.onnx').write_bytes(mapping)
        average = (work / 'average.f32').read_bytes()
        (result / 'average.f32').write_bytes(average)
        noise = []
        for name, shape in zip(exported['noise'], decl.noise_shapes()):
            data = (work / f'{name}.f32').read_bytes()
            (result / f'{name}.f32').write_bytes(data)
            noise.append({'name': name, **mf.asset(f'{name}.f32', data, shape)})
        provenance = {
            'checkpoint': {'path': checkpoint.name, 'sha256': decl.source_sha256, 'url': decl.source_url, 'format': decl.source_format},
            'image': os.environ.get('MODEL_CONV_IMAGE', 'unrecorded (not run from the container)'),
            'versions': versions(), 'steps': steps,
            'flags': {'opset': decl.opset, 'mappingTruncationPsi': 1, 'noiseMode': 'const', 'forceFp32': True, 'fusedModconv': False, 'exportSeed': 0},
            'seconds': round(time.time() - started, 1),
        }
        manifest = mf.build(decl, mapping=mf.asset('mapping.onnx', mapping), synthesis=mf.asset('synthesis.onnx', synthesis), synthesis_chunks=plan,
                            average=mf.asset('average.f32', average), noise=noise, provenance=provenance)
        found = mf.problems(manifest, decl)
        if found:
            raise RuntimeError('manifest inconsistent: ' + '; '.join(found))
        # Swap in, then mark complete: manifest.json is the last file written.
        if out.exists():
            shutil.rmtree(out)
        result.rename(out)
        (out / 'manifest.json.tmp').write_text(json.dumps(manifest, indent=2) + '\n')
        (out / 'manifest.json.tmp').rename(out / 'manifest.json')
        return manifest
    finally:
        shutil.rmtree(staging, ignore_errors=True)

