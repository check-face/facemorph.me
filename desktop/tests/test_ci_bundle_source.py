"""No-network, no-model checks for the CI builder's trusted source boundary."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'scripts/prepare-ci-bundle.py'
spec = importlib.util.spec_from_file_location('prepare_ci_bundle', SOURCE)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class SourceBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.payload = b'synthetic checkpoint bytes; never deserialized'
        self.target = self.directory / 'stylegan2-ffhq-config-f.pkl'
        self.staging = self.directory / 'stylegan2-ffhq-config-f.download'
        for name, value in [('SOURCE_BYTES', len(self.payload)), ('SOURCE_SHA256', hashlib.sha256(self.payload).hexdigest())]:
            context = patch.object(builder, name, value)
            context.start()
            self.addCleanup(context.stop)

    def test_verified_source_download_commits_and_next_run_reuses_without_network(self):
        with patch.object(builder.urllib.request, 'urlopen', return_value=io.BytesIO(self.payload)) as fetch:
            self.assertEqual(builder.verified_source(self.directory), self.target)
            fetch.assert_called_once_with(builder.SOURCE_URL, timeout=120)
        with patch.object(builder.urllib.request, 'urlopen', side_effect=AssertionError('Unexpected download')):
            self.assertEqual(builder.verified_source(self.directory), self.target)
        self.assertEqual(self.target.read_bytes(), self.payload)
        self.assertFalse(self.staging.exists())

    def test_short_oversized_and_wrong_hash_downloads_never_commit(self):
        for wrong in [self.payload[:-1], self.payload + b'x', b'x' * len(self.payload)]:
            with self.subTest(length=len(wrong)):
                with patch.object(builder.urllib.request, 'urlopen', return_value=io.BytesIO(wrong)):
                    with self.assertRaises(ValueError):
                        builder.verified_source(self.directory)
                self.assertFalse(self.target.exists())
                self.assertFalse(self.staging.exists())

    def test_existing_corruption_is_preserved_for_inspection_and_never_downloaded_over(self):
        self.target.write_bytes(b'corrupt retained checkpoint')
        with patch.object(builder.urllib.request, 'urlopen', side_effect=AssertionError('Unexpected download')):
            with self.assertRaisesRegex(ValueError, 'not loaded or replaced'):
                builder.verified_source(self.directory)
        self.assertEqual(self.target.read_bytes(), b'corrupt retained checkpoint')

    def test_preexisting_partial_is_not_overwritten_or_removed(self):
        self.staging.write_bytes(b'other acquisition')
        with self.assertRaisesRegex(ValueError, 'Incomplete source acquisition'):
            builder.verified_source(self.directory)
        self.assertEqual(self.staging.read_bytes(), b'other acquisition')

    def test_converter_requires_pinned_clean_checkout_and_expected_module(self):
        (self.directory / 'legacy.py').write_text('# synthetic test file\n')
        for revision, dirty in [(builder.STYLEGAN_REV, ' M legacy.py'), ('wrong-revision', '')]:
            with patch.object(builder.subprocess, 'check_output', side_effect=[revision, dirty]):
                with self.assertRaisesRegex(ValueError, 'clean checkout'):
                    builder.verify_converter(self.directory)
        with patch.object(builder.subprocess, 'check_output', side_effect=[builder.STYLEGAN_REV, '']):
            builder.verify_converter(self.directory)


if __name__ == '__main__':
    unittest.main()
