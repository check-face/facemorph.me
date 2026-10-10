"""Verify the Docker GPU request, real CUDA model and uncached HTTP synthesis."""
import io
import json
import os
import secrets
from urllib.request import urlopen

from PIL import Image
import torch

from runtime_device import configure_device


def main():
    assert configure_device(torch).type == 'cuda', 'Run with compose.gpu.yml'
    # Exercise CUDA in this container independently of the HTTP server.
    value = torch.ones(2, device='cuda')
    assert (value + value).cpu().tolist() == [2, 2]
    base = os.getenv('CHECKFACE_TEST_URL', 'http://127.0.0.1:8080')
    def get(path):
        with urlopen(base + path, timeout=600) as response:
            return response.read()
    before = json.loads(get('/healthz'))
    assert before['ready'] and before['provider'] == 'cuda', before
    seed = secrets.randbelow(2**32)
    data = get(f'/api/face/?seed={seed}&dim=512')
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        assert image.format == 'JPEG' and image.size == (512, 512)
        assert any(lo != hi for lo, hi in image.getextrema()), 'Blank image'
    after = json.loads(get('/healthz'))
    assert after['original_cache']['generated'] == before['original_cache']['generated'] + 1
    assert after['original_cache']['write_failures'] == before['original_cache']['write_failures']
    print(json.dumps({'health': after, 'seed': seed, 'jpeg_bytes': len(data), 'cuda_tensor': True}))


if __name__ == '__main__':
    main()
