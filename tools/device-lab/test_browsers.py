"""Opt-in Firefox adapter tests use real input, storage and temporary profiles.

LAB_REAL_BROWSERS=1 uv run --with playwright python -m unittest test_browsers
"""
import copy
import http.server
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path

import lab


@unittest.skipUnless(os.environ.get('LAB_REAL_BROWSERS') == '1', 'opt-in real browser/device-independent checks')
class RealBrowsers(unittest.TestCase):
    def test_chrome_launch_provenance(self):
        if not os.environ.get('LAB_CHROME'):
            self.skipTest('select an actual Chrome executable with LAB_CHROME')
        from playwright.sync_api import sync_playwright
        with tempfile.TemporaryDirectory() as tmp, lab.lab_lock(['eris-cpu']), sync_playwright() as pw:
            dev = lab.Desktop(pw, False, False, Path(tmp) / 'chrome', 'chrome')
            try:
                self.assertTrue(dev.identity['launches'], 'actual Chrome process command line must be captured')
                self.assertIn('--disable-features=WebGPU', dev.identity['launches'][0]['commandLine'])
                print(json.dumps({'browser': dev.identity}))
            finally:
                dev.close()

    def test_operated_and_cold_warm_storage(self):
        from playwright.sync_api import sync_playwright
        with tempfile.TemporaryDirectory() as tmp, lab.lab_lock(['eris-firefox-cpu']), sync_playwright() as pw:
            dev = lab.Desktop(pw, False, False, Path(tmp) / 'firefox', 'firefox')
            try:
                operated = lab.journey_operated(dev, 'eris-firefox-cpu')
                self.assertEqual(len(operated['steps']), 7)
                self.assertTrue(all(s['ok'] for s in operated['steps']))
                print(json.dumps({'browser': dev.identity, 'operated': operated, 'capabilities': dev.capabilities}))
                root = Path(tmp) / 'site'
                root.mkdir()
                (root / 'index.html').write_text('<!doctype html><title>storage input</title>')
                import functools
                server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(
                    http.server.SimpleHTTPRequestHandler, directory=str(root)))
                threading.Thread(target=server.serve_forever, daemon=True).start()
                url = f'http://localhost:{server.server_port}/'
                try:
                    dev.page.goto(url)
                    dev.js("""async () => {
                      localStorage.setItem('session','present');
                      await new Promise((done,fail)=>{const q=indexedDB.open('lab-session',1);
                        q.onsuccess=()=>{q.result.close();done()};q.onerror=()=>fail(q.error)});
                      await caches.open('lab-model');
                      const root=await navigator.storage.getDirectory();
                      await root.getFileHandle('lab-model',{create:true});
                    }""")
                    dev.page.goto('about:blank')
                    origin = url.rstrip('/')
                    dev.cdp.send('Storage.clearDataForOrigin', {'origin': origin, 'storageTypes': 'indexeddb,local_storage'})
                    dev.page.goto(url)
                    snapshot = """async () => ({session:localStorage.getItem('session'),
                      databases:(await indexedDB.databases()).map(x=>x.name), caches:await caches.keys(),
                      files:await Array.fromAsync((await navigator.storage.getDirectory()).keys())})"""
                    self.assertEqual(dev.js(snapshot), {'session': None, 'databases': [],
                                     'caches': ['lab-model'], 'files': ['lab-model']})
                    profiles = copy.copy(dev.profiles)
                    dev.clear_origin(url)
                    dev.page.goto(url)
                    self.assertEqual(dev.js(snapshot), {'session': None, 'databases': [], 'caches': [], 'files': []})
                    self.assertNotEqual(profiles, dev.profiles)
                    blocker = dev.ctx.new_page()
                    try:
                        blocker.goto(url)
                        blocker.evaluate("""() => new Promise((done,fail)=>{
                          const q=indexedDB.open('lab-blocked',1);
                          q.onsuccess=()=>{window.heldDatabase=q.result;done()};
                          q.onerror=()=>fail(q.error);
                        })""")
                        dev.page.goto('about:blank')
                        with self.assertRaisesRegex(Exception, 'warm reset blocked'):
                            dev.cdp.send('Storage.clearDataForOrigin', {'origin': origin, 'storageTypes': 'indexeddb,local_storage'})
                    finally:
                        blocker.close()
                finally:
                    server.shutdown()
                    server.server_close()
            finally:
                profiles = copy.copy(dev.profiles)
                dev.close()
            self.assertTrue(all(not p.exists() for p in profiles))


if __name__ == '__main__':
    unittest.main()
