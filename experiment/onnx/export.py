"""Export the trusted deployed config-F generator; verify against PyTorch on CPU."""
from pathlib import Path
import hashlib
import json
import sys
import time

ROOT = Path(__file__).resolve().parent
HF = ROOT.parent / 'hf'
sys.path.insert(0, str(HF))
from engine import Renderer
import numpy as np
import torch
import onnx
import onnxruntime as ort
from PIL import Image

class Generator(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, z):
        w = self.model.mapping(z, None, truncation_psi=0.7, truncation_cutoff=8)
        return self.model.synthesis(w, noise_mode='const', force_fp32=True, fused_modconv=False)


def main():
    output = ROOT / 'web/models'
    output.mkdir(exist_ok=True, parents=True)
    model = Generator(Renderer().model).eval()
    z = np.random.RandomState(0).randn(1, 512).astype(np.float32)
    path = output / 'config-f.onnx'
    print('Exporting full 1024px config-F generator...', flush=True)
    with torch.inference_mode():
        torch.onnx.export(model, (torch.from_numpy(z),), str(path),
                          input_names=['z'], output_names=['image'],
                          opset_version=17, dynamo=False, do_constant_folding=True)
    onnx.checker.check_model(str(path))
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(path), options, providers=['CPUExecutionProvider'])
    report = {'provider': 'CPUExecutionProvider', 'samples': []}
    for seed in [0, 1, 42]:
        z = np.random.RandomState(seed).randn(1, 512).astype(np.float32)
        with torch.inference_mode():
            reference = model(torch.from_numpy(z)).numpy()
        start = time.perf_counter()
        result = session.run(None, {'z': z})[0]
        error = np.abs(reference - result)
        row = {'seed': seed, 'max_absolute_error': float(error.max()),
               'mean_absolute_error': float(error.mean()), 'seconds': time.perf_counter()-start}
        report['samples'].append(row)
        print(row, flush=True)
        if not np.allclose(reference, result, atol=0.002, rtol=0.002):
            raise RuntimeError(f'ONNX comparison failed for seed {seed}: {row}')
        pixels = np.clip(result[0].transpose(1, 2, 0)*127.5+128, 0, 255).astype(np.uint8)
        Image.fromarray(pixels).save(output / f'reference-{seed}.png')
        if seed == 0:
            # Raw output allows browser WebGPU comparison without image codec differences.
            result.astype('<f4').tofile(output / 'reference-0.f32')
    provenance = json.loads((HF / 'models/provenance.json').read_text())
    manifest = {'model': 'config-f.onnx', 'bytes': path.stat().st_size,
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'source': provenance, 'input': {'name': 'z', 'shape': [1, 512]},
                'output': {'name': 'image', 'shape': [1, 3, 1024, 1024]},
                'truncation_psi': 0.7, 'truncation_cutoff': 8, 'noise': 'const',
                'opset': 17, 'cpu_validation': report,
                'versions': {'torch': torch.__version__, 'onnx': onnx.__version__, 'onnxruntime': ort.__version__}}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    review = ROOT.parents[1] / 'docs/review/onnx-web'
    review.mkdir(exist_ok=True, parents=True)
    (review / 'export.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(f'Ready: {path}', flush=True)

if __name__ == '__main__':
    main()
