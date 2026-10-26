import unittest

from model_conv import manifest as mf
from model_conv.models import FFHQ_CONFIG_F, declaration


def built(decl=FFHQ_CONFIG_F, synth=b'\x01' * 40, chunk_bytes=16):
    noise = [{'name': f'noise_{i}', **mf.asset(f'noise_{i}.f32', bytes(4 * s[0] * s[1]), s)} for i, s in enumerate(decl.noise_shapes())]
    plan = mf.chunks(synth, chunk_bytes)
    return mf.build(decl, mapping=mf.asset('mapping.onnx', b'map'), synthesis=mf.asset('synthesis.onnx', synth), synthesis_chunks=plan,
                    average=mf.asset('average.f32', bytes(4 * decl.w_dim)), noise=noise, provenance={'image': 'x'})


class Declarations(unittest.TestCase):
    def test_ffhq_shapes(self):
        d = FFHQ_CONFIG_F
        self.assertEqual(d.num_ws, 18)
        shapes = d.noise_shapes()
        self.assertEqual(len(shapes), 17)
        self.assertEqual(shapes[0], [4, 4])
        self.assertEqual(shapes[1:3], [[8, 8], [8, 8]])
        self.assertEqual(shapes[-2:], [[1024, 1024], [1024, 1024]])
        io = d.io_shapes()
        self.assertEqual(io['mapping'], {'inputs': {'z': [1, 512]}, 'outputs': {'w': [1, 18, 512]}})
        self.assertEqual(io['synthesis']['outputs'], {'image': [1, 3, 1024, 1024]})
        self.assertEqual(list(io['synthesis']['inputs'])[:2], ['w', 'noise_0'])

    def test_other_resolutions_follow_the_architecture(self):
        from dataclasses import replace
        small = replace(FFHQ_CONFIG_F, key='x', resolution=256)
        self.assertEqual(small.num_ws, 14)
        self.assertEqual(len(small.noise_shapes()), 13)

    def test_afhq_cat_declaration_matches_the_checkpoint(self):
        # Values read from the real checkpoint in the container (lease run 20261024T115539Z-f8afd10a).
        from model_conv.models import AFHQ_CAT
        self.assertEqual((AFHQ_CAT.resolution, AFHQ_CAT.num_ws, AFHQ_CAT.z_dim, AFHQ_CAT.w_dim), (512, 16, 512, 512))
        self.assertEqual(len(AFHQ_CAT.noise_shapes()), 15)
        self.assertEqual(AFHQ_CAT.noise_shapes()[-1], [512, 512])
        self.assertEqual(AFHQ_CAT.io_shapes()['synthesis']['outputs'], {'image': [1, 3, 512, 512]})
        self.assertEqual((AFHQ_CAT.tolerance.raw_float, AFHQ_CAT.tolerance.rgb), (1e-3, 1))
        self.assertIs(declaration('stylegan2-ada-afhqcat'), AFHQ_CAT)
        m = built(AFHQ_CAT, chunk_bytes=AFHQ_CAT.chunk_bytes)
        self.assertEqual(mf.problems(m, AFHQ_CAT), [])

    def test_undeclared_models_are_refused(self):
        self.assertIs(declaration('stylegan2-ffhq-config-f'), FFHQ_CONFIG_F)
        with self.assertRaises(KeyError):
            declaration('stylegan3-afhq')

    def test_frozen_tolerances(self):
        self.assertEqual((FFHQ_CONFIG_F.tolerance.raw_float, FFHQ_CONFIG_F.tolerance.rgb), (0.002, 1))


class Manifest(unittest.TestCase):
    def test_chunk_plan(self):
        self.assertEqual(mf.chunk_plan(40, 16), [(0, 16), (16, 16), (32, 8)])
        self.assertEqual(mf.chunk_plan(32, 16), [(0, 16), (16, 16)])
        with self.assertRaises(ValueError):
            mf.chunk_plan(0, 16)

    def test_shipped_synthesis_chunking(self):
        # The candidate's synthesis-spatial.onnx: 123,805,596 bytes in 8 chunks, the last 6,365,084.
        plan = mf.chunk_plan(123805596, FFHQ_CONFIG_F.chunk_bytes)
        self.assertEqual(len(plan), 8)
        self.assertEqual(plan[-1][1], 6365084)

    def test_chunks_are_content_addressed(self):
        data = bytes(range(40))
        c = mf.chunks(data, 16)
        self.assertEqual([x['size'] for x in c], [16, 16, 8])
        self.assertEqual(c[0]['file'], f"chunks/{mf.sha256(data[:16])}.bin")

    def test_noise_identity_matches_the_candidate_rule(self):
        noise = [{'sha256': 'a' * 64}, {'sha256': 'b' * 64}]
        self.assertEqual(mf.noise_sha256(noise), mf.sha256(('a' * 64 + 'b' * 64).encode()))

    def test_built_manifest_is_consistent(self):
        m = built(chunk_bytes=FFHQ_CONFIG_F.chunk_bytes)
        self.assertEqual(mf.problems(m, FFHQ_CONFIG_F), [])
        self.assertEqual(m['model']['numWs'], 18)
        self.assertEqual(m['tolerance'], {'rawFloat': 0.002, 'rgb': 1})

    def test_manifest_carries_the_model_manifest_identity(self):
        # The fields browser-model-manager's producer-facing schema requires of every producer.
        m = built(chunk_bytes=FFHQ_CONFIG_F.chunk_bytes)
        self.assertEqual((m['schemaVersion'], m['modelSourceSha256']), (1, FFHQ_CONFIG_F.source_sha256))
        self.assertEqual(m['bundleVersion'], 'model-conv-stylegan2-ffhq-config-f')
        m['schemaVersion'] = 2
        self.assertTrue(any('model manifest identity' in p for p in mf.problems(m, FFHQ_CONFIG_F)))

    def test_problems_name_each_inconsistency(self):
        m = built(chunk_bytes=FFHQ_CONFIG_F.chunk_bytes)
        m['noise'] = m['noise'][:-1]
        m['synthesis']['outputs'] = {'image': [1, 3, 512, 512]}
        m['average']['size'] = 4
        found = mf.problems(m, FFHQ_CONFIG_F)
        self.assertTrue(any('noise shapes' in p for p in found))
        self.assertTrue(any('synthesis outputs' in p for p in found))
        self.assertTrue(any('average' in p for p in found))
        self.assertTrue(any('noiseSha256' in p for p in found))

    def test_chunks_must_add_up_and_follow_the_declared_size(self):
        m = built(chunk_bytes=16)  # declared size is 16 MiB, so 16-byte chunks are wrong
        self.assertTrue(any('chunk size' in p for p in mf.problems(m, FFHQ_CONFIG_F)))
        m = built(chunk_bytes=FFHQ_CONFIG_F.chunk_bytes)
        m['synthesis']['size'] += 1
        self.assertTrue(any('add up' in p for p in mf.problems(m, FFHQ_CONFIG_F)))


if __name__ == '__main__':
    unittest.main()
