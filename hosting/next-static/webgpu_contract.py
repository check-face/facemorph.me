#!/usr/bin/env python3
"""Structural gate: the served WebGPU bundle must be the one the shipped engine can run.

The engine and the runtime bundle are staged from different inputs and promoted as separate
verified artifacts, so nothing stopped them drifting apart — and they did. Between 18 and 20
September `src/Next/browser/webgpu-engine.mjs` moved to the mobile-fusion split (a phase tensor
delivered as two 64-channel tiles) and the bounded kernel's `createBoundaryPipeline`, while every
staged manifest kept the mod-fusion split (one 128-channel phase tensor) and the pre-promotion
kernel's `fusedResample`. The result shipped: on every device that offered WebGPU the route
downloaded ~183 MB, built both GPU sessions, then died on `createBoundaryPipeline is not a
function` and fell back to the CPU path. `manifest['kernel']` — the only kernel field promotion
checked — named the *new* kernel the whole time, because it is provenance the runtime never loads.

This checks the fields the runtime actually loads, against what the engine actually does with
them. Every assertion below maps to a specific line of webgpu-engine.mjs; see `REQUIREMENTS`.
"""
import hashlib
import json
from pathlib import Path

# Largest single storage binding the engine's bind groups need, and the limit it refuses adapters
# below (webgpu-engine.mjs `required`). The bounded mobile route's ceiling is the
# [1,32,1024,1024] f32 resample output; the retired unsplit graph's 128-channel phase tensor was
# 134742528 and cannot be bound by Android adapters, which report exactly this cap.
REQUIRED_BINDING = 134217728

REQUIREMENTS = """\
webgpu-engine.mjs:45  imports `createBoundaryPipeline` from config.kernel
webgpu-engine.mjs:46  binds outputs[meta.phase+'__tile0'] and [...]+'__tile1'
webgpu-engine.mjs:46  reads outputs[meta.demod] (optional chaining, so absence is allowed)
webgpu-engine.mjs:41  allocates one buffer per split.prefixOutputs entry
webgpu-engine.mjs:42  allocates external [1,32,1024,1024] and out [1,3,1024,1024]
webgpu-engine.mjs:44  resolves every split.suffixInputs name from prefixOutputs, noise, or external
webgpu-engine.mjs:10  refuses any device under REQUIRED_BINDING bytes\
"""


def _nbytes(dims):
    total = 4
    for dim in dims:
        total *= dim
    return total


def read_asset(runtime, descriptor):
    """The bytes a browser would assemble for this descriptor, verified against its sha256.

    Assets over the static-host file limit are served as 16 MiB chunks and the descriptor `url`
    itself is never published, so reading one means concatenating its chunks exactly as
    model-cache.mjs does.
    """
    def local(url):
        if '/runtime/' not in url:
            raise ValueError(f'Asset is not served from this runtime: {url}')
        path = (runtime / url.split('/runtime/', 1)[1]).resolve()
        if runtime.resolve() not in path.parents:
            raise ValueError(f'Asset escapes the runtime directory: {url}')
        return path

    if descriptor.get('chunks'):
        data = b''.join(local(part['url']).read_bytes() for part in descriptor['chunks'])
    else:
        data = local(descriptor['url']).read_bytes()
    if len(data) != descriptor['size'] or hashlib.sha256(data).hexdigest() != descriptor['sha256']:
        raise ValueError(f"Asset does not match its descriptor: {descriptor['url']}")
    return data


def check(runtime, manifest):
    """Every way the served bundle can fail the engine, as a list of sentences. Empty means good."""
    runtime = Path(runtime)
    gpu = manifest.get('webgpu')
    if not gpu:
        return []  # A bundle with no WebGPU route cannot contradict the engine.
    problems = []

    # The provenance block promotion reads and the asset the engine imports must be one kernel.
    # These disagreed in the shipped bundle, which is exactly how the old kernel survived a gate
    # that was reporting the new one.
    provenance = manifest.get('kernel') or {}
    if provenance.get('sha256') and provenance['sha256'] != gpu['kernel']['sha256']:
        problems.append(
            f"manifest['kernel'] names {provenance['sha256'][:12]}… but the engine loads "
            f"webgpu.kernel {gpu['kernel']['sha256'][:12]}…; promotion would report a kernel "
            'this bundle never runs')

    try:
        kernel = read_asset(runtime, gpu['kernel']).decode()
    except (ValueError, OSError, UnicodeDecodeError) as error:
        problems.append(f'webgpu.kernel is unreadable: {error}')
        kernel = ''
    if 'createBoundaryPipeline' not in kernel:
        problems.append(
            'webgpu.kernel does not export createBoundaryPipeline, which the engine imports; '
            'this is the pre-promotion fusedResample kernel')

    try:
        split = json.loads(read_asset(runtime, gpu['split']))
        meta = json.loads(read_asset(runtime, gpu['metadata']))
    except (ValueError, OSError) as error:
        problems.append(f'webgpu split/metadata are unreadable: {error}')
        return problems

    outputs = split.get('prefixOutputs') or {}
    phase = meta.get('phase', '')
    for tile in ('__tile0', '__tile1'):
        if phase + tile not in outputs:
            problems.append(
                f'split.prefixOutputs has no {phase + tile!r}; the engine binds the phase tensor '
                'as two 64-channel tiles, so this is the retired unsplit graph')

    # Every buffer the engine allocates, so a bundle can never ask a qualified device for a
    # binding larger than the limit admission promised it would need.
    allocations = {name: _nbytes(dims) for name, dims in outputs.items()}
    allocations['external'] = _nbytes([1, 32, 1024, 1024])
    allocations['image'] = _nbytes([1, 3, 1024, 1024])
    for name, size in sorted(allocations.items(), key=lambda item: -item[1]):
        if size > REQUIRED_BINDING:
            problems.append(
                f'{name} needs {size} bytes, above the {REQUIRED_BINDING}-byte binding the engine '
                'admits devices against; every device passing admission would fail allocating it')

    known = set(outputs) | {split.get('external')} | {item['name'] for item in manifest.get('noise', [])} | {'w'}
    for name in split.get('suffixInputs', []):
        if name not in known:
            problems.append(f'split.suffixInputs names {name!r}, which the engine cannot feed')
    return problems


def require(runtime, manifest):
    problems = check(runtime, manifest)
    if problems:
        raise ValueError(
            'The served WebGPU bundle cannot run in the shipped engine:\n  - '
            + '\n  - '.join(problems) + '\n\nEngine requirements:\n' + REQUIREMENTS)


if __name__ == '__main__':
    import argparse
    import sys
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--runtime', type=Path, required=True, help='A staged runtime directory')
    a = p.parse_args()
    found = check(a.runtime, json.loads((a.runtime / 'manifest.json').read_text()))
    if found:
        print('\n'.join('FAIL: ' + item for item in found), file=sys.stderr)
        raise SystemExit(1)
    print(json.dumps({'webgpuBundleMatchesEngine': True, 'runtime': str(a.runtime)}))
