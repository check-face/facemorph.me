"""Owned-process cleanup with real sessions; no browser/process doubles."""
import signal
import subprocess
import sys
import time
import unittest

from compiled_ui import stop_process


class ProcessCleanup(unittest.TestCase):
    def process(self, ignore_term=False):
        code = "import signal; "
        if ignore_term:
            code += "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
        code += "print('ready', flush=True); signal.pause()"
        process = subprocess.Popen([sys.executable, '-u', '-c', code], stdout=subprocess.PIPE,
                                   text=True, start_new_session=True)
        self.addCleanup(process.stdout.close)
        self.addCleanup(stop_process, process, .2)
        self.assertEqual(process.stdout.readline().strip(), 'ready')
        return process

    def test_graceful_exit_is_reaped(self):
        process = self.process()
        stop_process(process, .2)
        self.assertEqual(process.returncode, -signal.SIGTERM)

    def test_term_refusal_escalates_only_the_owned_session(self):
        owned = self.process(ignore_term=True)
        unrelated = self.process(ignore_term=True)
        began = time.monotonic()
        stop_process(owned, .2)
        self.assertLess(time.monotonic() - began, 5)
        self.assertEqual(owned.returncode, -signal.SIGKILL)
        self.assertIsNone(unrelated.poll())


if __name__ == '__main__':
    unittest.main()
