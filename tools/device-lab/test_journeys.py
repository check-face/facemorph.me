"""Registry decisions use plain values; invalid CLI input fails before device access."""
import subprocess
import sys
import unittest
from pathlib import Path

import lab


class Journeys(unittest.TestCase):
    def test_known_names_preserve_order(self):
        self.assertEqual(lab.validate_journeys('morph,cold-face,warm-face,operated'),
                         ['morph', 'cold-face', 'warm-face', 'operated'])

    def test_unknown_and_empty_names_refused(self):
        for value in ('', 'cold-face,', 'typo', 'cold-face,typo'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'unknown journey'):
                lab.validate_journeys(value)

    def test_cli_unknown_journey_fails_without_success_report(self):
        result = subprocess.run([sys.executable, str(Path(lab.__file__)), 'run',
                                 '--cell', 'phone-cpu', '--journey', 'typo'],
                                capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('unknown journey', result.stderr)
        self.assertNotIn('journey_done', result.stdout)

    def test_zero_iterations_cannot_report_success(self):
        result = subprocess.run([sys.executable, str(Path(lab.__file__)), 'run',
                                 '--repeat', '0'], capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('repeat must be at least 1', result.stderr)
        self.assertNotIn('cell_start', result.stdout)


if __name__ == '__main__':
    unittest.main()
