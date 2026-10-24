"""The pinned upstream implementation: NVlabs stylegan2-ada-pytorch, loaded from its own source tree.

Both `convert` (to export) and `verify` (as the independent reference) load the original checkpoint through
upstream `legacy.load_network_pkl`; verify never reads a converted file to build its reference.
Reference (non-CUDA) ops are forced as in classic experiment/hf/engine.py, so CPU output is deterministic.
"""
import hashlib
import os
import sys
from pathlib import Path

UPSTREAM = Path(os.environ.get('MODEL_CONV_UPSTREAM', '/opt/upstream/stylegan2-ada-pytorch'))
UPSTREAM_REVISION = 'd72cc7d041b42ec8e806021a205ed9349f87c6a4'


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def _import_upstream():
    if not (UPSTREAM / 'legacy.py').exists():
        raise RuntimeError(f'upstream stylegan2-ada-pytorch not found at {UPSTREAM}')
    if str(UPSTREAM) not in sys.path:
        sys.path.insert(0, str(UPSTREAM))
    import legacy
    from torch_utils.ops import bias_act, conv2d_gradfix, upfirdn2d
    if not getattr(bias_act, '_model_conv_ref', False):
        original_bias, original_upfirdn = bias_act.bias_act, upfirdn2d.upfirdn2d
        bias_act.bias_act = lambda *a, **k: original_bias(*a, **{**k, 'impl': 'ref'})
        upfirdn2d.upfirdn2d = lambda *a, **k: original_upfirdn(*a, **{**k, 'impl': 'ref'})
        conv2d_gradfix.enabled = False
        bias_act._model_conv_ref = True
    return legacy


def load_generator(checkpoint: Path, expected_sha256: str):
    """G_ema from a trusted checkpoint. Pickle loading runs code: only ever pass a checkpoint you trust."""
    actual = file_sha256(checkpoint)
    if actual != expected_sha256:
        raise RuntimeError(f'checkpoint SHA-256 {actual} is not the declared {expected_sha256}')
    legacy = _import_upstream()
    import torch
    torch.set_num_threads(min(4, os.cpu_count() or 2))
    with checkpoint.open('rb') as f:
        g = legacy.load_network_pkl(f)['G_ema']
    return g.eval().requires_grad_(False).to('cpu')
