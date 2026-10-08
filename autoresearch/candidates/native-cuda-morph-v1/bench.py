"""Native PyTorch CUDA synthesis of a morph on the same GPU as the browser lane (eris iteration 3b).

Same workload shape as morph-frame-pipeline-v1: 26 W+ frames after 3 warm-up frames, full 1024px,
timed until uint8 RGB is on the host (what the browser's per-frame figure also ends with, before PNG).
Model: the pinned official config-F checkpoint converted with NVlabs legacy.py, as self-host/api.py does.

    bench.py <models-dir> <out.json>
"""
import io, json, math, sys, time, pathlib, statistics
import numpy as np, torch
VENDOR = pathlib.Path(__file__).resolve().parents[3] / 'experiment/hf/vendor/stylegan2-ada-pytorch'
sys.path.insert(0, str(VENDOR))
import legacy
from torch_utils import custom_ops
from torch_utils.ops import bias_act, upfirdn2d, conv2d_gradfix
import torch.utils.cpp_extension as cpp
_loaded = {}
def _get_plugin(module_name, sources, **build_kwargs):
    # The vendored loader imports the built module by name, which newer torch no longer puts on
    # sys.path; cpp_extension.load returns the module itself. Build inputs are unchanged.
    if module_name not in _loaded:
        _loaded[module_name] = cpp.load(name=module_name, sources=sources, verbose=False, **build_kwargs)
    return _loaded[module_name]
custom_ops.get_plugin = _get_plugin

torch.backends.cuda.matmul.allow_tf32 = False   # same exact-fp32 stance as experiment/hf/engine.py
torch.backends.cudnn.allow_tf32 = False
torch.backends.cudnn.benchmark = True
models = pathlib.Path(sys.argv[1]); out_path = sys.argv[2]
cache = models / 'G_ema.pt'
if cache.exists(): G = torch.load(cache, weights_only=False)
else:
    with open(models / 'stylegan2-ffhq-config-f.pkl', 'rb') as f: G = legacy.load_network_pkl(f)['G_ema']
    torch.save(G, cache)
G = G.eval().requires_grad_(False).cuda()

@torch.inference_mode()
def frames(n, warm):
    # two seeds -> mapping -> truncation, then the browser's linear W+ path
    z = torch.from_numpy(np.stack([np.random.RandomState(s).randn(512) for s in (1, 2)])).float().cuda()
    w = G.mapping(z, None, truncation_psi=0.7, truncation_cutoff=8)
    t = torch.linspace(0, 1, n + warm, device='cuda')[:, None, None]
    return (w[0] * (1 - t) + w[1] * t).contiguous()

@torch.inference_mode()
def run(ws, batch, impl, fused):
    bias_act._init(); upfirdn2d._init()
    orig_b, orig_u = bias_act.bias_act, upfirdn2d.upfirdn2d
    if impl == 'ref':   # self-host / experiment/hf behaviour
        bias_act.bias_act = lambda *a, **k: orig_b(*a, **{**k, 'impl': 'ref'})
        upfirdn2d.upfirdn2d = lambda *a, **k: orig_u(*a, **{**k, 'impl': 'ref'})
    try:
        outs = []
        for i in range(0, len(ws), batch):
            img = G.synthesis(ws[i:i + batch], noise_mode='const', force_fp32=True, fused_modconv=fused)
            outs.append((img.permute(0, 2, 3, 1) * 127.5 + 128).clamp(0, 255).to(torch.uint8).cpu())
        return torch.cat(outs)
    finally:
        bias_act.bias_act, upfirdn2d.upfirdn2d = orig_b, orig_u

N, WARM = 26, 3
ws = frames(N, WARM)
configs = [('selfhost-ref-unfused', 'ref', False, 1), ('cuda-unfused', 'cuda', False, 1),
           ('cuda-fused-b1', 'cuda', True, 1), ('cuda-fused-b4', 'cuda', True, 4), ('cuda-fused-b10', 'cuda', True, 10),
           ('cuda-unfused-b4', 'cuda', False, 4)]
results, reference = {}, None
import os
if os.environ.get('REVERSE'): configs = configs[::-1]
for name, impl, fused, batch in configs:
    torch.cuda.empty_cache(); torch.cuda.reset_peak_memory_stats()
    try: run(ws, batch, impl, fused); torch.cuda.synchronize()   # warm-up: plugin build and cuDNN tuning for every shape timed
    except torch.OutOfMemoryError:
        results[name] = {'error': 'CUDA OOM beside the desktop apps on this 8 GB card', 'batch': batch}; print(name, 'OOM', flush=True)
        torch.cuda.empty_cache(); continue
    reps = []
    for _ in range(3):
        torch.cuda.synchronize(); t = time.perf_counter()
        imgs = run(ws[WARM:], batch, impl, fused)
        reps.append((time.perf_counter() - t) * 1000 / N)
    if reference is None: reference = imgs   # the first config run; RGB diffs are against it
    diff = (imgs.int() - reference.int()).abs()
    results[name] = {'msPerFrame': [round(r, 2) for r in reps], 'median': round(statistics.median(reps), 2),
                     'batch': batch, 'impl': impl, 'fusedModconv': fused,
                     'maxRgbVsFirst': int(diff.max()), 'fracPixelsDiffer': float((diff > 0).float().mean()), 'peakMiB': round(torch.cuda.max_memory_allocated() / 2**20)}
    print(name, results[name], flush=True)
results['_env'] = {'plugins': {'bias_act': bias_act._plugin is not None, 'upfirdn2d': upfirdn2d._plugin is not None}, 'torch': torch.__version__, 'cuda': torch.version.cuda, 'gpu': torch.cuda.get_device_name(0),
                   'tf32': False}
json.dump(results, open(out_path, 'w'), indent=1); print(results['_env'])
