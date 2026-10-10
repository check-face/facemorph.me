"""Regression: explicit GPU requests cannot silently become CPU inference."""
import os
import unittest
from unittest.mock import patch
import torch

from runtime_device import configure_device


class DeviceTests(unittest.TestCase):
    def test_default_cpu(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(configure_device(torch).type, 'cpu')

    def test_cuda_missing_fails(self):
        with patch.dict(os.environ, {'CHECKFACE_DEVICE': 'cuda'}), patch.object(torch.cuda, 'is_available', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'NVIDIA Container Toolkit'):
                configure_device(torch)

    def test_invalid_device_fails(self):
        with patch.dict(os.environ, {'CHECKFACE_DEVICE': 'typo'}):
            with self.assertRaises(ValueError):
                configure_device(torch)


if __name__ == '__main__':
    unittest.main()
