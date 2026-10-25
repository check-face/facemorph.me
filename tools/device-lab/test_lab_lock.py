"""Per-device lab locks (operator, 25 October 2026): the phone serializes only against other phone
runs, eris cells only against eris runs; a blocked run exits 75 busy after LAB_LOCK_WAIT instead of
queueing behind an unrelated device. python3 -m unittest test_lab_lock, from this folder; touches
only lock files, never a device.
"""
import os, socket, unittest
import lab

DESKTOP = socket.gethostname().split('.')[0]


def acquire(cells):
    return lab.lab_lock(cells)


class LabLock(unittest.TestCase):
    def setUp(self):
        os.environ['LAB_LOCK_WAIT'] = '0'

    def tearDown(self):
        os.environ.pop('LAB_LOCK_WAIT', None)

    def test_unknown_cell_refused(self):
        with self.assertRaises(SystemExit) as cm:
            with acquire(['eris-neon']):
                pass
        self.assertNotEqual(cm.exception.code, 75)
        self.assertIn('unknown cell', str(cm.exception))

    def test_phone_serializes_phone_only(self):
        with acquire(['phone-cpu']):
            with acquire(['eris-webgpu']) as devices:  # unrelated device: no wait, no block
                self.assertEqual(devices, [DESKTOP])
            with self.assertRaises(SystemExit) as cm:
                with acquire(['phone-webgpu']):
                    pass
            self.assertEqual(cm.exception.code, 75)

    def test_desktop_serializes_desktop_only(self):
        with acquire(['eris-webgpu']):
            with self.assertRaises(SystemExit) as cm:
                with acquire(['eris-cpu']):
                    pass
            self.assertEqual(cm.exception.code, 75)
            with acquire(['phone-cpu']) as devices:  # phone free while eris held
                self.assertEqual(devices, ['p30pro'])

    def test_mixed_run_takes_both_sorted(self):
        with acquire(['phone-cpu', 'eris-webgpu']) as devices:
            self.assertEqual(devices, sorted([DESKTOP, 'p30pro']))
            with self.assertRaises(SystemExit) as cm:
                with acquire(['eris-cpu']):
                    pass
            self.assertEqual(cm.exception.code, 75)
            with self.assertRaises(SystemExit) as cm:
                with acquire(['phone-webgpu']):
                    pass
            self.assertEqual(cm.exception.code, 75)


if __name__ == '__main__':
    unittest.main()
