import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

NATIVE=Path(__file__).resolve().parents[1]/'native'
spec=importlib.util.spec_from_file_location('asset_store',NATIVE/'asset_store.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Response(io.BytesIO):
    url='https://assets.example/model';status=200;headers={}
class AssetTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.body=b'known-model-data';self.asset={'sha256':hashlib.sha256(self.body).hexdigest(),'size':len(self.body),'url':Response.url}
    def tearDown(self):self.temp.cleanup()
    def test_download_verify_reuse_without_network(self):
        with patch.object(module.urllib.request,'urlopen',return_value=Response(self.body)) as fetch:
            result=module.acquire(self.asset,self.root);self.assertEqual(result.read_bytes(),self.body)
            self.assertEqual(module.acquire(self.asset,self.root),result);self.assertEqual(fetch.call_count,1)
    def test_partial_download_resumes_exact_range(self):
        (self.root/(self.asset['sha256']+'.partial')).write_bytes(self.body[:5])
        response=Response(self.body[5:]);response.status=206;response.headers={'Content-Range':f'bytes 5-{len(self.body)-1}/{len(self.body)}'}
        with patch.object(module.urllib.request,'urlopen',return_value=response) as fetch:
            self.assertEqual(module.acquire(self.asset,self.root).read_bytes(),self.body)
            self.assertEqual(fetch.call_args.args[0].headers['Range'],'bytes=5-')
    def test_server_ignores_range_restarts_not_appends(self):
        (self.root/(self.asset['sha256']+'.partial')).write_bytes(self.body[:5])
        with patch.object(module.urllib.request,'urlopen',return_value=Response(self.body)):
            self.assertEqual(module.acquire(self.asset,self.root).read_bytes(),self.body)
    def test_bad_bytes_and_wrong_range_never_promote(self):
        with patch.object(module.urllib.request,'urlopen',return_value=Response(b'x'*len(self.body))):
            with self.assertRaisesRegex(ValueError,'integrity'):module.acquire(self.asset,self.root)
        self.assertFalse((self.root/self.asset['sha256']).exists())
        (self.root/(self.asset['sha256']+'.partial')).write_bytes(self.body[:5])
        response=Response(self.body[5:]);response.status=206;response.headers={'Content-Range':'bytes 1-2/3'}
        with patch.object(module.urllib.request,'urlopen',return_value=response):
            with self.assertRaisesRegex(ValueError,'range'):module.acquire(self.asset,self.root)
    def test_reject_insecure_manifest_or_redirect(self):
        with self.assertRaisesRegex(ValueError,'HTTPS'):module.acquire({**self.asset,'url':'http://bad/model'},self.root)
        response=Response(self.body);response.url='http://bad/model'
        with patch.object(module.urllib.request,'urlopen',return_value=response):
            with self.assertRaisesRegex(ValueError,'redirect'):module.acquire(self.asset,self.root)
if __name__=='__main__':unittest.main()
