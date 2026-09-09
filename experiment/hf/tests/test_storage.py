import json
from PIL import Image
import pytest
import storage
from contracts import request_spec,cache_key

@pytest.fixture
def local_store(tmp_path,monkeypatch):
    monkeypatch.setattr(storage,'RESULTS',tmp_path)
    monkeypatch.setattr(storage,'BUCKET','')
    return tmp_path

def test_result_survives_new_load_and_detects_corruption(local_store):
    s=request_spec('0','1','Seeds','faces');k=cache_key(s)
    storage.save(k,s,[Image.new('RGB',(8,8),'red'),Image.new('RGB',(8,8),'blue')])
    assert storage.load(k)['spec']==s
    (local_store/k/'first.png').write_bytes(b'corrupted')
    with pytest.raises(ValueError):storage.load(k)

@pytest.mark.parametrize('key',['../secret','/etc/passwd','ABC','a'*65])
def test_result_id_cannot_escape(key,local_store):
    with pytest.raises(ValueError):storage.load(key)

def test_failed_remote_upload_never_publishes_manifest(local_store,monkeypatch):
    monkeypatch.setattr(storage,'BUCKET','owner/trial')
    monkeypatch.setattr(storage,'TOKEN','test-only')
    def fail(*a,**kw):raise RuntimeError('simulated network failure')
    monkeypatch.setattr(storage,'batch_bucket_files',fail)
    s=request_spec('0','1','Seeds','faces');k=cache_key(s)
    with pytest.raises(RuntimeError):storage.save(k,s,[Image.new('RGB',(8,8))]*2)
    assert not (local_store/k/'result.json').exists()

def test_capacity_limit(local_store,monkeypatch):
    monkeypatch.setattr(storage,'MAX_RESULTS',1)
    d=local_store/('a'*64);d.mkdir();(d/'result.json').write_text('{}')
    with pytest.raises(ValueError,match='limit'):storage.ensure_capacity()
