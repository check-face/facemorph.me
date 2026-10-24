#!/usr/bin/env python3
"""The gate must fail the bundle that actually shipped, and pass the one the engine can run.

Each case below is a real shape: `shipped_bundle` reproduces what next.facemorph.me served on
20 September, which downloaded ~183 MB on every WebGPU device and then fell back to CPU.
"""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import webgpu_contract

BOUNDED_KERNEL = b'export async function createBoundaryPipeline(device,m,tail,workgroup,variant){}'
RETIRED_KERNEL = b'export async function fusedResample(device,buffers,m,tail,workgroup){}'
PHASE = '/synthesis/b1024/conv0/ConvTranspose__polyphase_conv'
DEMOD = '/synthesis/b1024/conv0/Reshape_9_output_0'
EXTERNAL = '/synthesis/b1024/conv0/Mul_6_output_0'

TILED_SPLIT = {'prefixOutputs': {PHASE + '__tile0': [1, 64, 513, 513], PHASE + '__tile1': [1, 64, 513, 513],
                                 DEMOD: [1, 32, 1, 1]},
               'suffixInputs': [EXTERNAL, DEMOD], 'external': EXTERNAL}
UNSPLIT = {'prefixOutputs': {PHASE: [1, 128, 513, 513], DEMOD: [1, 32, 1, 1]},
           'suffixInputs': [EXTERNAL, DEMOD], 'external': EXTERNAL}


class Bundle:
    """A runtime directory holding exactly the assets the gate reads."""

    def __init__(self, root, split, kernel, provenance_kernel=None):
        self.root = Path(root)
        self.manifest = {'noise': [{'name': 'noise_15', 'sha256': 'n' * 64, 'size': 4, 'url': 'https://h/runtime/n'}],
                         'webgpu': {'split': self._put('split-segment.json', json.dumps(split).encode()),
                                    'metadata': self._put('manifest.json', json.dumps({'phase': PHASE, 'demod': DEMOD}).encode()),
                                    'kernel': self._put('fused-resample-v1.mjs', kernel)}}
        if provenance_kernel is not None:
            self.manifest['kernel'] = {'sha256': hashlib.sha256(provenance_kernel).hexdigest()}

    def _put(self, name, data):
        digest = hashlib.sha256(data).hexdigest()
        path = self.root / 'assets' / digest / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return {'url': f'https://h/runtime/assets/{digest}/{name}', 'sha256': digest, 'size': len(data)}

    def check(self):
        return webgpu_contract.check(self.root, self.manifest)


class WebGpuContract(unittest.TestCase):
    def build(self, **kwargs):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        return Bundle(self.directory.name, **kwargs)

    def test_matching_bundle_passes(self):
        self.assertEqual(self.build(split=TILED_SPLIT, kernel=BOUNDED_KERNEL,
                                    provenance_kernel=BOUNDED_KERNEL).check(), [])

    def test_shipped_bundle_is_rejected_for_every_reason_it_failed(self):
        # The manifest served on 20 September: new kernel in provenance, retired kernel and
        # unsplit graph in the section the engine loads.
        problems = ' | '.join(self.build(split=UNSPLIT, kernel=RETIRED_KERNEL,
                                         provenance_kernel=BOUNDED_KERNEL).check())
        self.assertIn('createBoundaryPipeline', problems)
        self.assertIn('__tile0', problems)
        self.assertIn('__tile1', problems)
        self.assertIn('promotion would report a kernel this bundle never runs', problems)
        # 128 * 513 * 513 * 4 exceeds the binding admission promises the device it will need.
        self.assertIn('134742528', problems)

    def test_provenance_agreeing_with_a_retired_kernel_is_still_rejected(self):
        problems = ' | '.join(self.build(split=TILED_SPLIT, kernel=RETIRED_KERNEL,
                                         provenance_kernel=RETIRED_KERNEL).check())
        self.assertIn('createBoundaryPipeline', problems)
        self.assertNotIn('promotion would report', problems)

    def test_an_unfeedable_suffix_input_is_named(self):
        split = {**TILED_SPLIT, 'suffixInputs': [EXTERNAL, '/synthesis/b1024/absent']}
        self.assertIn('absent', ' | '.join(self.build(split=split, kernel=BOUNDED_KERNEL).check()))

    def test_a_tampered_asset_fails_its_descriptor(self):
        bundle = self.build(split=TILED_SPLIT, kernel=BOUNDED_KERNEL)
        target = next(self.directory.name / Path('assets') / d / 'fused-resample-v1.mjs'
                      for d in [Path(bundle.manifest['webgpu']['kernel']['url']).parent.name])
        Path(target).write_bytes(BOUNDED_KERNEL + b'// changed after staging')
        self.assertIn('does not match its descriptor', ' | '.join(bundle.check()))

    def test_a_bundle_without_a_webgpu_route_has_nothing_to_contradict(self):
        bundle = self.build(split=TILED_SPLIT, kernel=BOUNDED_KERNEL)
        del bundle.manifest['webgpu']
        self.assertEqual(bundle.check(), [])


if __name__ == '__main__':
    unittest.main()
