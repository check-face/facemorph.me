"""Per-device lab locks (operator, 25 October 2026): the phone serializes only against other phone
runs, eris cells only against eris runs; a blocked run exits 75 busy after LAB_LOCK_WAIT instead of
queueing behind an unrelated device. python3 -m unittest test_lab_lock, from this folder; touches
only lock files, never a device.
"""
import os, socket, subprocess, sys, tempfile, unittest
import lab

DESKTOP = socket.gethostname().split('.')[0]


class LabLock(unittest.TestCase):
    def setUp(self):
        self.previous_wait = os.environ.get('LAB_LOCK_WAIT')
        self.lock_dir = tempfile.TemporaryDirectory()
        os.environ['LAB_LOCK_WAIT'] = '0'

    def tearDown(self):
        self.lock_dir.cleanup()
        if self.previous_wait is None:
            os.environ.pop('LAB_LOCK_WAIT', None)
        else:
            os.environ['LAB_LOCK_WAIT'] = self.previous_wait

    def acquire(self, cells):
        return lab.lab_lock(cells, state_dir=self.lock_dir.name)

    def test_unknown_cell_refused(self):
        with self.assertRaises(SystemExit) as cm:
            with self.acquire(['eris-neon']):
                pass
        self.assertNotEqual(cm.exception.code, 75)
        self.assertIn('unknown cell', str(cm.exception))

    def test_phone_serializes_phone_only(self):
        with self.acquire(['phone-cpu']):
            with self.acquire(['eris-webgpu']) as devices:  # unrelated device: no wait, no block
                self.assertEqual(devices, [DESKTOP])
            with self.assertRaises(SystemExit) as cm:
                with self.acquire(['phone-webgpu']):
                    pass
            self.assertEqual(cm.exception.code, 75)

    def test_desktop_serializes_desktop_only(self):
        with self.acquire(['eris-webgpu']):
            with self.assertRaises(SystemExit) as cm:
                with self.acquire(['eris-cpu']):
                    pass
            self.assertEqual(cm.exception.code, 75)
            with self.acquire(['phone-cpu']) as devices:  # phone free while eris held
                self.assertEqual(devices, ['p30pro'])

    def test_mixed_run_takes_both_sorted(self):
        with self.acquire(['phone-cpu', 'eris-webgpu']) as devices:
            self.assertEqual(devices, sorted([DESKTOP, 'p30pro']))
            with self.assertRaises(SystemExit) as cm:
                with self.acquire(['eris-cpu']):
                    pass
            self.assertEqual(cm.exception.code, 75)
            with self.assertRaises(SystemExit) as cm:
                with self.acquire(['phone-webgpu']):
                    pass
            self.assertEqual(cm.exception.code, 75)

    def test_other_process_cannot_take_held_device(self):
        code = "import sys,lab; lab.lab_lock(['eris-cpu'], state_dir=sys.argv[1]).__enter__()"
        with self.acquire(['eris-webgpu']):
            result = subprocess.run([sys.executable, '-c', code, self.lock_dir.name],
                                    cwd=os.path.dirname(lab.__file__), capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertIn('device lab busy', result.stderr)


if __name__ == '__main__':
    unittest.main()
