"""Exact config-F checkpoint, converted with NVIDIA legacy.py; reference torch ops."""
import os
import hashlib
import json
from pathlib import Path
import pickle
import sys
import torch
from PIL import Image
from contracts import frame_latents

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "vendor/stylegan2-ada-pytorch"))

# Avoid first-request JIT CUDA compilation in the leased ZeroGPU process.
from torch_utils.ops import bias_act, upfirdn2d, conv2d_gradfix
_original_bias = bias_act.bias_act
_original_upfirdn = upfirdn2d.upfirdn2d

def _reference_bias(*args, **kwargs):
    kwargs["impl"] = "ref"
    return _original_bias(*args, **kwargs)

def _reference_upfirdn(*args, **kwargs):
    kwargs["impl"] = "ref"
    return _original_upfirdn(*args, **kwargs)

bias_act.bias_act = _reference_bias
upfirdn2d.upfirdn2d = _reference_upfirdn
conv2d_gradfix.enabled = False

class Renderer:
    def __init__(self, device="cpu"):
        self.device = device
        torch.set_num_threads(min(4, os.cpu_count() or 2))
        # Trusted, pinned operator-owned model only. No user-supplied model paths.
        model_path = ROOT / "models/generator.pkl"
        expected = json.loads((ROOT / "models/provenance.json").read_text())["generator_sha256"]
        if hashlib.sha256(model_path.read_bytes()).hexdigest() != expected:
            raise RuntimeError("Generator checksum does not match recorded provenance")
        with model_path.open("rb") as f:
            self.model = pickle.load(f)
        self.model.eval().requires_grad_(False).to(device)
        if device == "cuda":
            torch.backends.cuda.matmul.allow_tf32 = False
            torch.backends.cudnn.allow_tf32 = False

    @torch.inference_mode()
    def render(self, spec):
        z = torch.from_numpy(frame_latents(spec)).to(self.device)
        frames = []
        # Batch one to bound peak memory; reference operations are deliberately conservative.
        for item in z.split(1):
            w = self.model.mapping(item, None, truncation_psi=0.7, truncation_cutoff=8)
            out = self.model.synthesis(w, noise_mode="const", force_fp32=True, fused_modconv=False)
            pixels = (out.permute(0, 2, 3, 1) * 127.5 + 128).clamp(0, 255).to(torch.uint8)[0].cpu().numpy()
            frames.append(Image.fromarray(pixels).resize((512, 512), Image.Resampling.LANCZOS))
        return frames
