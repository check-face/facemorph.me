"""Build a portable native CPU CI bundle from the verified official checkpoint.

Research/evaluation only. Downloads stay in the runner's private working directory;
neither original nor converted weights may be included in uploaded CI artifacts.
CI31 tests packaging/transport/inference. It is NOT the frozen research31 suite:
there is no photo encoder or historical e4e fixture in this independently built set.
"""
import argparse
import gc
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
import urllib.request

SOURCE_URL = 'https://nvlabs-fi-cdn.nvidia.com/stylegan2/networks/stylegan2-ffhq-config-f.pkl'
SOURCE_SHA256 = 'adf127ea7bb8a7788c8bdeda3c9937f7310b669b09ecf799ca53a631ff46948d'
SOURCE_BYTES = 381673535
STYLEGAN_REV = 'd72cc7d041b42ec8e806021a205ed9349f87c6a4'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verified_source(directory):
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / 'stylegan2-ffhq-config-f.pkl'
    if target.exists():
        if target.stat().st_size != SOURCE_BYTES or digest(target) != SOURCE_SHA256:
            raise ValueError('Existing checkpoint differs from pinned official bytes; it was not loaded or replaced')
        return target
    temporary = directory / 'stylegan2-ffhq-config-f.download'
    # Per-runner directory; do not point simultaneous builders at the same staging file.
    if temporary.exists():
        raise ValueError('Incomplete source acquisition exists; inspect/remove that staging file before retrying')
    try:
        sha, size = hashlib.sha256(), 0
        with urllib.request.urlopen(SOURCE_URL, timeout=120) as source, temporary.open('xb') as output:
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                if size > SOURCE_BYTES:
                    raise ValueError('Official checkpoint exceeds pinned size')
                sha.update(chunk)
                output.write(chunk)
        if size != SOURCE_BYTES or sha.hexdigest() != SOURCE_SHA256:
            raise ValueError('Official checkpoint failed checksum/size validation')
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


def verify_converter(directory):
    revision = subprocess.check_output(['git', '-C', str(directory), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(directory), 'status', '--porcelain', '--untracked-files=no'], text=True).strip()
    if revision != STYLEGAN_REV or dirty:
        raise ValueError('Converter must be a clean checkout at the pinned NVIDIA revision')
    if not (directory / 'legacy.py').is_file():
        raise ValueError('Converter checkout is incomplete')


def build(args):
    # Validate trusted source identity before deserializing executable pickle content.
    source_dir = args.stylegan_directory.resolve()
    verify_converter(source_dir)
    source = verified_source(args.cache_directory.resolve())
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError('Bundle output must be absent or empty; never overwrite a previous bundle')
    output.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(source_dir))
    import legacy
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    from PIL import Image
    from torch_utils.ops import conv2d_gradfix

    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    torch.manual_seed(0)
    # Pin the exporter/runtime environment so CI changes are intentional.
    if torch.__version__.split('+')[0] != '2.9.1' or ort.__version__ != '1.24.3' or onnx.__version__ != '1.20.1':
        raise ValueError('Install the pinned CI exporter and native runtime requirements')
    print('Converting verified NVIDIA checkpoint on CPU', flush=True)
    with source.open('rb') as stream:
        networks = legacy.load_network_pkl(stream)
    generator = networks['G_ema'].eval().requires_grad_(False).cpu()
    del networks
    gc.collect()
    if generator.img_resolution != 1024 or generator.num_ws != 18 or generator.w_dim != 512:
        raise ValueError('Unexpected generator shape')

    class Synthesis(torch.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model
            self.layers = [layer for layer in model.synthesis.modules() if hasattr(layer, 'noise_const')]

        def forward(self, w, *noise):
            for layer, value in zip(self.layers, noise):
                layer.noise_const = value
            return self.model.synthesis(w, noise_mode='const', force_fp32=True, fused_modconv=False)

    synthesis = Synthesis(generator).eval()
    noise = [layer.noise_const.clone() for layer in synthesis.layers]
    noise_names = [f'noise_{i}' for i in range(len(noise))]
    if len(noise) != 17:
        raise ValueError('Unexpected config-F noise inventory')

    def descriptor(path):
        return {'path': path.relative_to(output).as_posix(), 'sha256': digest(path)}

    def floats(name, array):
        path = output / name
        np.asarray(array, dtype='<f4').tofile(path)
        return descriptor(path)

    with torch.inference_mode():
        average = generator.mapping.w_avg.detach().cpu().numpy().copy()

        def mapped(seed, psi=.7):
            z = torch.from_numpy(np.random.RandomState(seed).randn(1, 512).astype('<f4'))
            w = generator.mapping(z, None, truncation_psi=1).cpu().numpy().copy()
            w[:, :8] = average + (w[:, :8] - average) * np.float32(psi)
            return w

        first, last = mapped(0), mapped(1)
        cases = []
        for index in range(26):
            u = np.float32(index / 25)
            cases.append((f'ci-linear-{index:02}', first * (np.float32(1)-u) + last * u, 'original'))
        cases += [('ci-zero-noise', first.copy(), 'zero'), ('ci-inverted-noise', first.copy(), 'alternate'),
                  ('ci-trunc-psi-0', mapped(0, 0), 'original'), ('ci-trunc-psi-1', mapped(0, 1), 'original'),
                  ('ci-seed-42', mapped(42), 'original')]
        model_path = output / 'synthesis.onnx'
        # Batch-one export needs static convolution kernel dimensions after resampling.
        # Restore original functions before the independent eager Torch references.
        saved_conv, saved_transpose = conv2d_gradfix.conv2d, conv2d_gradfix.conv_transpose2d
        def static_conv(input, weight, *positional, **named):
            return torch.nn.functional.conv2d(input, weight.reshape(tuple(int(d) for d in weight.shape)), *positional, **named)
        def static_transpose(input, weight, *positional, **named):
            return torch.nn.functional.conv_transpose2d(input, weight.reshape(tuple(int(d) for d in weight.shape)), *positional, **named)
        try:
            conv2d_gradfix.conv2d, conv2d_gradfix.conv_transpose2d = static_conv, static_transpose
            print('Exporting real FP32 full-1024 synthesis ONNX', flush=True)
            torch.onnx.export(synthesis, (torch.from_numpy(first), *noise), str(model_path),
                              input_names=['w', *noise_names], output_names=['image'],
                              opset_version=17, dynamo=False, external_data=False)
        finally:
            conv2d_gradfix.conv2d, conv2d_gradfix.conv_transpose2d = saved_conv, saved_transpose
        onnx.checker.check_model(str(model_path))
        graph = onnx.load(str(model_path), load_external_data=False)
        if any(tensor.data_location == onnx.TensorProto.EXTERNAL for tensor in graph.graph.initializer):
            raise ValueError('Worker requires a self-contained ONNX model')
        if [item.name for item in graph.graph.input] != ['w', *noise_names]:
            raise ValueError('Unexpected ONNX input inventory')
        del graph
        noise_entries = [dict(floats(f'{name}.f32', value.cpu().numpy()), name=name, shape=list(value.shape))
                         for name, value in zip(noise_names, noise)]
        indices = np.arange(0, 3*1024*1024, 769, dtype='<i4')
        indices_path = output / 'sample-indices.i32'
        indices.tofile(indices_path)
        rows = []
        for name, w, mode in cases:
            selected_noise = noise if mode == 'original' else [torch.zeros_like(value) if mode == 'zero' else -value for value in noise]
            raw = synthesis(torch.from_numpy(w), *selected_noise).cpu().numpy()
            if raw.shape != (1, 3, 1024, 1024) or not np.isfinite(raw).all():
                raise ValueError('Invalid eager Torch reference')
            pixels = np.clip(raw[0].transpose(1, 2, 0)*np.float32(127.5)+np.float32(128), 0, 255).astype(np.uint8)
            image_path = output / f'{name}.png'
            Image.fromarray(pixels).save(image_path)
            rows.append({'name': name, 'noise': mode, 'w': floats(f'{name}.w.f32', w),
                         'reference': descriptor(image_path), 'samples': floats(f'{name}.samples.f32', raw.reshape(-1)[indices])})
            print(f'Eager Torch reference {len(rows)}/31: {name}', flush=True)

    manifest = {
        'schemaVersion': 1, 'version': 'native-ci-official-config-f-cpu-v1', 'developmentOnly': True,
        'runtime': {'onnxruntime': ort.__version__, 'provider': 'CPUExecutionProvider', 'threads': args.threads},
        'model': descriptor(model_path), 'noise': noise_entries,
        'noiseSha256': hashlib.sha256(''.join(item['sha256'] for item in noise_entries).encode()).hexdigest(),
        'indices': descriptor(indices_path), 'cases': rows,
        'evidenceScope': 'Independent deterministic CI31 eager-Torch references; not frozen research31, e4e, GPU or release qualification',
        'provenance': {'sourceUrl': SOURCE_URL, 'sourceSha256': SOURCE_SHA256, 'sourceBytes': SOURCE_BYTES,
                       'converterRevision': STYLEGAN_REV, 'exporterSha256': digest(Path(__file__)),
                       'referenceEngine': 'eager PyTorch CPU, full FP32, unfused modulation, raw RGB conversion',
                       'torch': str(torch.__version__), 'onnx': onnx.__version__, 'numpy': np.__version__,
                       'python': platform.python_version(), 'platform': platform.system(), 'architecture': platform.machine(),
                       'terms': 'https://github.com/NVlabs/stylegan2/blob/master/LICENSE.txt'}
    }
    data = (json.dumps(manifest, indent=2, allow_nan=False) + '\n').encode()
    # Manifest is the completion marker; incomplete output cannot look like a valid bundle.
    (output / 'bundle.sha256').write_text(hashlib.sha256(data).hexdigest() + '\n')
    (output / 'bundle.json').write_bytes(data)
    print('Complete portable CI31 bundle. Run native_integration.py; do not publish this directory.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache-directory', type=Path, required=True)
    parser.add_argument('--stylegan-directory', type=Path, required=True)
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--accept-research-license', action='store_true')
    args = parser.parse_args()
    if not args.accept_research_license:
        parser.error('Review NVIDIA research/evaluation terms; permitted CI evaluation requires --accept-research-license')
    if not 1 <= args.threads <= 16:
        parser.error('--threads must be between 1 and 16')
    build(args)


if __name__ == '__main__':
    main()
