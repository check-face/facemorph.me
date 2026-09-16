import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('publisher',Path(__file__).with_name('prepare-runtime.py'))
publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
OLD='https://localhost:8443/runtime';NEW='https://next.facemorph.me/runtime'
class FrozenPublication(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.source=self.base/'source';self.out=self.base/'public';self.source.mkdir()
        self.inventory=[]
        self.mapping=self.asset('assets/mapping.bin',b'mapping')
        self.big=self.asset('assets/model.bin',bytes(range(80)))
        self.config={'mapping':self.mapping,'synthesis':self.big,'canaries':[{'name':str(i)}for i in range(31)]}
    def tearDown(self):self.tmp.cleanup()
    def asset(self,path,data):
        f=self.source/path;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(data);sha=hashlib.sha256(data).hexdigest();self.inventory.append({'path':path,'sha256':sha,'size':len(data)});return {'url':OLD+'/'+path,'sha256':sha,'size':len(data)}
    def stage(self):
        (self.source/'manifest.json').write_text(json.dumps(self.config));(self.source/'sources.private.json').write_text(json.dumps(self.inventory))
        with patch.object(sys,'argv',['prepare-runtime.py','--source',str(self.source),'--output',str(self.out),'--base',NEW]),patch.object(publisher,'LIMIT',64),patch.object(publisher,'CHUNK',32),contextlib.redirect_stdout(io.StringIO()):publisher.main()
    def stream(self):
        folder=self.source/'encoder-stream';folder.mkdir();data=b'export const executor = 1;';(folder/'execute.mjs').write_bytes(data)
        cfg={'executor':{'url':OLD+'/encoder-stream/execute.mjs','size':len(data),'sha256':hashlib.sha256(data).hexdigest()},'steps':[]}
        raw=json.dumps(cfg).encode();(folder/'manifest.json').write_bytes(raw)
        (folder/'descriptor.json').write_text(json.dumps({'url':OLD+'/encoder-stream/manifest.json','size':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}))
        for name in ['ORT-LICENSE','ORT-ThirdPartyNotices.txt','memory-cap-receipt.json']:(folder/name).write_text('{}')
        return folder
    def test_phone_candidate_requires_exact_evidence_and_encoder_identity(self):
        receipt=Path(__file__).with_name('phone-candidate-admission.json')
        evidence=json.loads(receipt.read_text());report=json.loads((receipt.parent/evidence['report']).read_text())
        descriptor={'preprocessingSha256':report['preprocessingSha256'],'sha256':report['encoderManifestSha256'],'sourceEncoderSha256':report['product']['encoderStats']['sourceEncoderSha256']}
        manifest={'alignmentSha256':report['preprocessingSha256'],'encoderStream':{}}
        publisher.admit_phone_candidate(manifest,descriptor,receipt)
        self.assertTrue(manifest['encoderStream']['phoneAdmitted']);self.assertFalse(manifest['encoderStream']['releaseQualified'])
        descriptor['sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'gates failed'):publisher.admit_phone_candidate(manifest,descriptor,receipt)
    def test_chunks_and_nested_manifest_are_verified_remapped_and_rehashed(self):
        self.stream();self.stage();m=json.loads((self.out/'manifest.json').read_text());self.assertEqual(len(m['canaries']),7)
        desc=m['synthesis'];self.assertFalse((self.out/'assets/model.bin').exists());joined=b''.join((self.out/c['url'].removeprefix(NEW+'/')).read_bytes()for c in desc['chunks']);self.assertEqual(hashlib.sha256(joined).hexdigest(),desc['sha256'])
        stream=m['encoderStream'];raw=(self.out/stream['url'].removeprefix(NEW+'/')).read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),stream['sha256']);self.assertEqual(len(raw),stream['size']);self.assertNotIn(OLD,raw.decode())
        dep=json.loads(raw)['executor'];self.assertEqual(hashlib.sha256((self.out/dep['url'].removeprefix(NEW+'/')).read_bytes()).hexdigest(),dep['sha256']);self.stage()
    def test_changed_source_and_immutable_destination_are_rejected(self):
        self.stage();(self.source/'assets/mapping.bin').write_bytes(b'changed');self.assertRaises(ValueError,self.stage)
        (self.source/'assets/mapping.bin').write_bytes(b'mapping');(self.out/'assets/mapping.bin').write_bytes(b'changed');self.assertRaises(ValueError,self.stage)
    def test_stream_symlink_escape_rejected_even_with_matching_hash(self):
        folder=self.stream();data=(folder/'execute.mjs').read_bytes();(folder/'execute.mjs').unlink();outside=self.base/'private-executor';outside.write_bytes(data);(folder/'execute.mjs').symlink_to(outside)
        self.assertRaises(ValueError,self.stage)
if __name__=='__main__':unittest.main()
