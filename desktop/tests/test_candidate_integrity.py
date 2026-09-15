import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

D = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(D / 'native'))
from bundle_paths import resolve_assets
spec = importlib.util.spec_from_file_location('artifacts', D / 'scripts/candidate-artifacts.py')
artifacts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifacts)


class CandidateIntegrity(unittest.TestCase):
    def test_modified_missing_and_extra_packages_fail(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            bundle = root / 'bundle'
            bundle.mkdir()
            package = bundle / 'preview.deb'
            package.write_bytes(b'candidate bytes')
            output = root / 'output'
            artifacts.collect(bundle, output, 'linux', 'test')
            artifacts.verify(output)
            (output / 'extra.deb').write_bytes(b'extra')
            with self.assertRaises(ValueError): artifacts.verify(output)
            (output / 'extra.deb').unlink()
            target = output / 'preview.deb'
            target.write_bytes(b'candidate bytex')
            with self.assertRaises(ValueError): artifacts.verify(output)
            target.unlink()
            with self.assertRaises(ValueError): artifacts.verify(output)

    def test_portable_paths_reject_escape_and_accept_spaces(self):
        with tempfile.TemporaryDirectory(prefix='bundle space ') as folder:
            item = {'path': 'assets/model.onnx', 'sha256': 'a' * 64}
            resolved = resolve_assets(item, folder, portable=True)
            self.assertTrue(Path(resolved['path']).is_relative_to(Path(folder).resolve()))
            for path in ['../private', '/etc/passwd', 'C:/private', 'assets\\escape']:
                with self.assertRaises(ValueError):
                    resolve_assets({**item, 'path': path}, folder, portable=True)

    def test_bundle_failure_without_model_dependencies(self):
        import subprocess
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            request = {'schemaVersion': 1, 'jobId': 'missing', 'attemptId': 'test', 'type': 'qualify'}
            result = subprocess.run([sys.executable, '-S', str(D / 'native/worker.py'),
                '--bundle', str(root / 'missing.json'), '--output', str(root)],
                input=json.dumps(request), capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)['type'], 'failed')
            self.assertNotIn(str(root), result.stdout)
            self.assertFalse((root / 'COMPLETE').exists())

if __name__ == '__main__': unittest.main()
