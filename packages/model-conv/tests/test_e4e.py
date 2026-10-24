import hashlib
import json
import unittest
from pathlib import Path

from model_conv import e4e
from model_conv.e4e import E4E_FFHQ_ENCODE, consumers_of, group_boundary, liveness, plan_groups, stream_problems

QUAL = Path(__file__).resolve().parent / 'e4e-qualification'
MIB = 1024 * 1024


class Declaration(unittest.TestCase):
    def test_frozen_values(self):
        d = E4E_FFHQ_ENCODE
        self.assertEqual(d.key, 'e4e-ffhq-encode')
        self.assertEqual((d.source_sha256, d.source_bytes), ('2ace1d9a8c05c10a399bcd500b8dda118f759ff1aac89dbdab7435f2136a0999', 1201649680))
        self.assertEqual((d.w_plus_tolerance, d.stream_max_initializer_mib, d.opset), (0.0001, 16, 17))
        self.assertIn('CC BY-NC-SA 4.0', d.source_terms)
        self.assertIs(e4e.encoder_declaration('e4e-ffhq-encode'), d)
        with self.assertRaises(KeyError):
            e4e.encoder_declaration('stylegan2-ffhq-config-f')

    def test_declaration_cannot_be_widened_in_place(self):
        with self.assertRaises(Exception):
            E4E_FFHQ_ENCODE.w_plus_tolerance = 1.0

    def test_hosted_identities_recorded(self):
        self.assertEqual(e4e.HOSTED_ENCODER_SHA256, 'd525a985a43e4d49ef4590a8b8cc6f487992065bee00014fe8c6f8ab4ac291b1')
        self.assertEqual(e4e.HOSTED_ENCODER_BYTES, 1068862265)


class Partitioning(unittest.TestCase):
    # n0 reads weight a (10 MiB), n1 reads a and b (10 MiB), n2 reads c (10 MiB), n3 reads nothing heavy, n4 reads a again.
    sizes = {'a': 10 * MIB, 'b': 10 * MIB, 'c': 10 * MIB}
    inputs = [['x', 'a'], ['t0', 'a', 'b'], ['t1', 'c'], ['t2'], ['t3', 'a']]
    outputs = [['t0'], ['t1'], ['t2'], ['t3'], ['y']]

    def test_cap_opens_the_next_group_and_owns_what_that_node_reads(self):
        self.assertEqual(plan_groups(self.inputs, self.sizes, 16 * MIB), [[0], [1], [2, 3], [4]])

    def test_a_shared_weight_is_counted_once_per_group(self):
        self.assertEqual(plan_groups(self.inputs, self.sizes, 20 * MIB), [[0, 1], [2, 3, 4]])

    def test_a_node_over_the_cap_still_gets_its_own_group(self):
        self.assertEqual(plan_groups([['a', 'b']], self.sizes, 1), [[0]])

    def test_every_node_is_in_exactly_one_consecutive_group(self):
        for cap in (1, MIB, 16 * MIB, 40 * MIB, 10**12):
            flat = [i for g in plan_groups(self.inputs, self.sizes, cap) for i in g]
            self.assertEqual(flat, list(range(len(self.inputs))))

    def test_boundaries_are_explicit(self):
        consumers = consumers_of(self.inputs, {'y'})
        self.assertEqual(group_boundary([0], self.inputs, self.outputs, self.sizes, consumers), (['x'], ['t0'], ['a']))
        self.assertEqual(group_boundary([2, 3], self.inputs, self.outputs, self.sizes, consumers), (['t1'], ['t3'], ['c']))
        self.assertEqual(group_boundary([4], self.inputs, self.outputs, self.sizes, consumers), (['t3'], ['y'], ['a']))

    def test_liveness_releases_after_last_use(self):
        spec = lambda n, k: {'name': n, 'dtype': 'FLOAT', 'shape': [k]}  # noqa: E731
        steps = [{'id': 0, 'outputs': [spec('t', 2)]}, {'id': 1, 'outputs': [spec('y', 3)]}]
        last_use = {'x': 0, 't': 1, 'y': 2}
        peak = liveness(steps, [spec('x', 4)], {'y'}, last_use)
        self.assertEqual(steps[0]['releaseAfter'], ['x'])
        self.assertEqual(steps[1]['releaseAfter'], ['t'])
        self.assertEqual((steps[0]['liveBoundaryBytesBeforeRelease'], steps[0]['liveBoundaryBytesAfterRelease']), (24, 8))
        self.assertEqual(steps[1]["liveBoundaryBytesBeforeRelease"], 20)
        self.assertEqual(peak, 24)

    def test_unaccounted_dtype_is_refused(self):
        with self.assertRaises(ValueError):
            e4e.tensor_bytes({'dtype': 'STRING', 'shape': [1]})


class StreamFiles(unittest.TestCase):
    def test_stream_problems_name_missing_and_wrong_files(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            (d / 'part-000.onnx').write_bytes(b'abc')
            good = {'kind': e4e.STREAM_KIND, 'sourceNodeCount': 2, 'steps': [{'id': 0, 'file': 'part-000.onnx', 'size': 3, 'sha256': hashlib.sha256(b'abc').hexdigest(), 'sourceNodeCount': 2}]}
            self.assertEqual(stream_problems(good, d), [])
            bad = json.loads(json.dumps(good))
            bad['steps'][0]['sha256'] = '0' * 64
            self.assertEqual(len(stream_problems(bad, d)), 1)
            self.assertTrue(stream_problems({**good, 'steps': []}, d))


class QualificationInputs(unittest.TestCase):
    def test_digests_and_shapes(self):
        report = json.loads((QUAL / 'report.json').read_text())
        self.assertEqual(report['threshold'], 0.0001)
        self.assertEqual([c['id'] for c in report['cases']], ['seed-0-aligned', 'seed-0-unaligned', 'seed-1-aligned', 'seed-1-unaligned', 'no-face-aligned'])
        for c in report['cases']:
            inp, ref = (QUAL / c['inputFile']).read_bytes(), (QUAL / c['referenceFile']).read_bytes()
            self.assertEqual(len(inp), 4 * 3 * 256 * 256)
            self.assertEqual(len(ref), 4 * 18 * 512)
            self.assertEqual(hashlib.sha256(inp).hexdigest(), c['inputSha256'])
            self.assertEqual(hashlib.sha256(ref).hexdigest(), c['referenceSha256'])


@unittest.skipUnless(__import__('importlib').util.find_spec('onnx'), 'untested here: onnx is not importable outside the container')
class TinyGraph(unittest.TestCase):
    def test_partitioning_a_real_onnx_graph(self):
        import numpy as np
        import onnx
        from onnx import TensorProto, helper, numpy_helper
        w = [numpy_helper.from_array(np.ones((1, 1024, 1024), dtype=np.float32) * k, f'w{k}') for k in (1, 2, 3)]  # 4 MiB each
        nodes = [helper.make_node('Mul', ['x', 'w1'], ['a']), helper.make_node('Mul', ['a', 'w2'], ['b']), helper.make_node('Mul', ['b', 'w3'], ['y'])]
        sizes = {t.name: t.ByteSize() for t in w}
        groups = plan_groups([list(n.input) for n in nodes], sizes, 5 * MIB)
        self.assertEqual(groups, [[0], [1], [2]])
        graph = helper.make_graph(nodes, 'g', [helper.make_tensor_value_info('x', TensorProto.FLOAT, [1, 1024, 1024])], [helper.make_tensor_value_info('y', TensorProto.FLOAT, [1, 1024, 1024])], w)
        onnx.checker.check_model(helper.make_model(graph))


if __name__ == '__main__':
    unittest.main()
