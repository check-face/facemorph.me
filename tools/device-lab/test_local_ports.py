"""Real simultaneous qualification servers and task-owned phone reverse cleanup (fm-qrfz)."""
import hashlib
import json
import os
from pathlib import Path
import socket
import ssl
import tempfile
import unittest
from unittest.mock import patch
import urllib.request

import lab


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def fetch(port, path='/'):
    with urllib.request.urlopen(f'https://127.0.0.1:{port}{path}', context=ssl._create_unverified_context(), timeout=5) as response:
        return response.read(), response.headers.get('X-Next-Artifact-Source')


class LocalPorts(unittest.TestCase):
    def test_two_real_servers_serve_distinct_documents_runtime_pins_and_source_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cases = []
            for label in ('alpha', 'beta'):
                artifact = root / label
                (artifact / 'deploy-next').mkdir(parents=True)
                (artifact / 'deploy-next/index.html').write_text('<!doctype html>' + label)
                (artifact / 'next-site-source.txt').write_text(label)
                runtime = artifact / '.runtime-public'
                runtime.mkdir()
                manifest = json.dumps({'qualification-port-fixture': label}).encode()
                (runtime / 'manifest.json').write_bytes(manifest)
                out = root / (label + '-out')
                out.mkdir()
                cases.append((artifact, out, manifest, free_port(), label))
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop('RUNTIME_FILES', None)
                a, b = cases
                with lab.LocalServer(a[0], hashlib.sha256(a[2]).hexdigest(), a[1], port=a[3]), lab.LocalServer(b[0], hashlib.sha256(b[2]).hexdigest(), b[1], port=b[3]):
                    for artifact, out, manifest, port, label in cases:
                        self.assertEqual(fetch(port), (b'<!doctype html>' + label.encode(), label))
                        self.assertEqual(fetch(port, '/runtime/manifest.json'), (manifest, label))
                    with self.assertRaisesRegex(OSError, 'already served'):
                        with lab.LocalServer(b[0], hashlib.sha256(b[2]).hexdigest(), b[1], port=a[3]):
                            self.fail('an occupied port was accepted')
                    self.assertEqual(fetch(a[3])[0], b'<!doctype html>alpha')
            for _, out, _, port, _ in cases:
                self.assertFalse(lab.port_listening(port))
                self.assertFalse((out / 'next.key').exists())
                self.assertFalse((out / 'next.crt').exists())

    def test_invalid_port_refused_before_a_server_or_phone_mutation(self):
        for port in (0, 65536, True, '8443'):
            with self.subTest(port=port), patch.object(lab, 'sh') as sh, patch.object(lab, 'adb') as adb:
                with self.assertRaises(ValueError):
                    lab.LocalServer('.', '0' * 64, '.', port=port)
                with self.assertRaises(ValueError):
                    lab.phone_chrome_flags(False, True, port=port)
                sh.assert_not_called()
                adb.assert_not_called()


class PhonePorts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = patch.object(lab, 'STATE', Path(self.tmp.name) / 'session.json')
        self.state.start()
        self.saved = patch.object(lab, 'SAVED', {})
        self.saved.start()
        self.sh = patch.object(lab, 'sh', return_value='')
        self.sh.start()

    def tearDown(self):
        self.sh.stop()
        self.saved.stop()
        self.state.stop()
        self.tmp.cleanup()

    def test_default_8443_flags_and_reverse_are_preserved(self):
        with patch.object(lab, 'adb') as adb:
            lab.phone_chrome_flags(False, True)
            self.assertIn('127.0.0.1:8443', lab.SAVED['chromeFlags'][0])
            adb.assert_called_once_with('reverse', 'tcp:8443', 'tcp:8443')
            lab.phone_chrome_reset()
            adb.assert_called_with('reverse', '--remove', 'tcp:8443', check=False)

    def test_live_phone_default_still_removes_the_legacy_default_mapping(self):
        with patch.object(lab, 'adb') as adb:
            lab.phone_chrome_flags(False, False)
            adb.assert_not_called()
            lab.phone_chrome_reset()
            adb.assert_called_once_with('reverse', '--remove', 'tcp:8443', check=False)

    def test_custom_port_flags_mapping_and_stale_recovery_remove_only_owned_port(self):
        with patch.object(lab, 'adb') as adb:
            lab.phone_chrome_flags(False, True, port=8491)
            self.assertIn('127.0.0.1:8491', lab.SAVED['chromeFlags'][0])
            adb.assert_called_once_with('reverse', '--no-rebind', 'tcp:8491', 'tcp:8491')
            lab.SAVED.clear()  # a later process reads the persisted recovery record
            lab.recover()
            self.assertIn(unittest.mock.call('reverse', '--remove', 'tcp:8491', check=False), adb.call_args_list)
            self.assertFalse(any('tcp:8443' in call.args for call in adb.call_args_list))
            self.assertFalse(lab.STATE.exists())

    def test_refused_custom_mapping_is_never_removed_by_cleanup(self):
        with patch.object(lab, 'adb', side_effect=RuntimeError('cannot rebind existing mapping')) as adb:
            with self.assertRaisesRegex(RuntimeError, 'cannot rebind'):
                lab.phone_chrome_flags(False, True, port=8491)
            lab.phone_chrome_reset()
            adb.assert_called_once_with('reverse', '--no-rebind', 'tcp:8491', 'tcp:8491')


if __name__ == '__main__':
    unittest.main()
