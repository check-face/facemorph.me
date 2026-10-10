"""Adapter integration, using real torch tensors but no model assets.

Run in the self-host image; real-model/HTTP qualification remains smoke_legacy.py.
"""
import tempfile
import unittest
import numpy as np
import torch
from original_cache import OriginalCache
from torch_adapter import TorchGenerator


class FixtureModel:
    _checkface_source_sha256 = 'fixture-checkpoint'
    def __init__(self):
        self.calls = 0
    def synthesis(self, ws, **options):
        self.calls += 1
        return torch.zeros((1, 3, 1024, 1024)) + ws[0, 0, 0]


class DeviceFixture(torch.nn.Module):
    _checkface_source_sha256 = 'fixture-checkpoint'

    def __init__(self, device):
        super().__init__()
        self.marker = torch.nn.Parameter(torch.zeros(1, device=device), requires_grad=False)
        self.calls = 0

    def mapping(self, z, _labels, **_options):
        assert z.device == self.marker.device
        return z[:, None, :].repeat(1, 18, 1)

    def synthesis(self, ws, **_options):
        assert ws.device == self.marker.device
        self.calls += 1
        return torch.zeros((1, 3, 1024, 1024), device=ws.device) + ws[0, 0, 0]


class AdapterCacheTests(unittest.TestCase):
    @unittest.skipUnless(torch.cuda.is_available(), 'Requires real NVIDIA GPU')
    def test_cuda_mapping_synthesis_and_provider_cache_separation(self):
        with tempfile.TemporaryDirectory() as root:
            cache = OriginalCache(root)
            z = np.zeros((1, 512), dtype=np.float32)
            cpu = DeviceFixture('cpu')
            cuda = DeviceFixture('cuda')
            first = TorchGenerator(cpu, cache).synthesis(TorchGenerator(cpu).mapping(z))
            second = TorchGenerator(cuda, cache).synthesis(TorchGenerator(cuda).mapping(z))
            np.testing.assert_array_equal(first, second)
            self.assertEqual((cpu.calls, cuda.calls), (1, 1))
            TorchGenerator(cuda, cache).synthesis(np.zeros((1, 18, 512), dtype=np.float32))
            self.assertEqual(cuda.calls, 1)

    def test_repeated_and_restarted_synthesis_reuses_exact_original(self):
        with tempfile.TemporaryDirectory() as root:
            model = FixtureModel()
            latent = np.zeros((1, 18, 512), dtype=np.float32)
            adapter = TorchGenerator(model, OriginalCache(root))
            first = adapter.synthesis(latent)
            second = adapter.synthesis(latent)
            restarted = TorchGenerator(model, OriginalCache(root)).synthesis(latent)
            self.assertEqual(model.calls, 1)
            np.testing.assert_array_equal(first, second)
            np.testing.assert_array_equal(first, restarted)
            self.assertEqual(first.shape, (1, 1024, 1024, 3))
            self.assertTrue(np.all(first == 128))
            latent[0, 0, 0] = 0.25
            changed = adapter.synthesis(latent)
            self.assertEqual(model.calls, 2)
            self.assertTrue(np.all(changed == 159))
            model._checkface_source_sha256 = 'different-checkpoint'
            adapter.synthesis(latent)
            self.assertEqual(model.calls, 3)

    def test_invalid_latent_is_rejected_before_cache_or_inference(self):
        model = FixtureModel()
        with tempfile.TemporaryDirectory() as root:
            adapter = TorchGenerator(model, OriginalCache(root))
            for latent in [np.zeros((1, 512)), np.full((1, 18, 512), np.nan)]:
                with self.assertRaises(ValueError):
                    adapter.synthesis(latent)
            self.assertEqual(model.calls, 0)


if __name__ == '__main__':
    unittest.main()
