import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import uuid

spec=importlib.util.spec_from_file_location('preview',Path(__file__).with_name('server.py'))
server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)

class PreviewBoundary(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();base=Path(self.tmp.name).resolve()
        server.ROOT=base/'assets';server.ROOT.mkdir();server.REPORTS=base/'reports'
        (server.ROOT/'index.html').write_text('preview')
        (server.ROOT/'sources.private.json').write_text('private')
        self.http=server.http.server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.http.shutdown();self.http.server_close();self.tmp.cleanup()
    def request(self,path='/',data=None,origin='https://next.facemorph.me'):
        c=http.client.HTTPConnection('127.0.0.1',self.http.server_port)
        c.request('POST' if data is not None else 'GET',path,body=json.dumps(data) if data is not None else None,headers={'Origin':origin,'Content-Type':'application/json'})
        r=c.getresponse();out=(r.status,r.read(),dict(r.getheaders()));c.close();return out
    def event(self):
        return {'schemaVersion':1,'session':str(uuid.uuid4()),'run':str(uuid.uuid4()),'event':'start','platform':'ios','browser':'safari'}
    def test_static_private_boundary(self):
        self.assertEqual(self.request()[0],200)
        for path in ['/sources.private.json','/%73ources.private.json','/.env','/diagnostics/events','/../reports/']:
            self.assertEqual(self.request(path)[0],404,path)
    def test_consent_submission_contract_and_no_public_read(self):
        self.assertEqual(self.request('/diagnostics/events',self.event())[0],204)
        saved=list(server.REPORTS.glob('*.jsonl'));self.assertEqual(len(saved),1)
        data=json.loads(saved[0].read_text());self.assertNotIn('ip',data);self.assertNotIn('userAgent',data)
        for event in [{**self.event(),'photo':'secret'},{**self.event(),'elapsedMs':-1},{**self.event(),'platform':'my private input'}]:
            self.assertEqual(self.request('/diagnostics/events',event)[0],400)
        self.assertEqual(self.request('/diagnostics/events',self.event(),origin='https://evil.example')[0],403)
    def test_range_and_cors_for_installed_apps(self):
        folder=server.ROOT/'runtime';folder.mkdir();(folder/'model.bin').write_bytes(b'0123456789')
        c=http.client.HTTPConnection('127.0.0.1',self.http.server_port)
        c.request('GET','/runtime/model.bin',headers={'Range':'bytes=3-6'})
        r=c.getresponse();self.assertEqual(r.status,206);self.assertEqual(r.read(),b'3456');self.assertEqual(r.headers['Content-Range'],'bytes 3-6/10');self.assertEqual(r.headers['Access-Control-Allow-Origin'],'*');c.close()

    def test_retention_and_capacity(self):
        server.purge();old=server.REPORTS/'old.jsonl';old.write_text('{}')
        import os
        os.utime(old,(time.time()-31*86400,)*2);server.purge();self.assertFalse(old.exists())
        limit=server.LIMIT;server.LIMIT=1
        try:
            self.assertEqual(self.request('/diagnostics/events',self.event())[0],429)
            self.assertEqual(self.request('/diagnostics/events',self.event())[0],429)
        finally:server.LIMIT=limit

if __name__=='__main__':unittest.main()
