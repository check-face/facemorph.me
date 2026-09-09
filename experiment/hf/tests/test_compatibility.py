import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
import storage
from compatibility import pair_spec, install_routes
from contracts import cache_key


def test_mixed_modes_preserve_words_vs_seed():
    spec = pair_spec('seed=42', 'value=42')
    assert spec['inputs'][0] == {'seed': 42}
    assert 'sha256' in spec['inputs'][1]
    assert pair_spec('value=%F0%9F%98%80', 'seed=0')['inputs'][1] == {'seed': 0}


@pytest.mark.parametrize('value', ['guid=123', 'value=a&seed=1', 'seed=-1', 'seed=4294967296', 'value=a&value=b'])
def test_reject_unsupported_or_ambiguous_inputs(value):
    with pytest.raises(ValueError):
        pair_spec(value, 'seed=1')


def test_saved_media_and_restore_never_need_renderer(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, 'RESULTS', tmp_path)
    monkeypatch.setattr(storage, 'BUCKET', '')
    app = FastAPI()
    install_routes(app)
    client = TestClient(app)
    query = 'from_seed=17&to_value=hello'
    assert client.get('/trial/api/mp4/?'+query).headers['content-type'] == 'image/svg+xml'
    assert not list(tmp_path.iterdir())
    spec = pair_spec('seed=17', 'value=hello')
    frames = [Image.new('RGB', (8, 8), (i*20, 0, 0)) for i in range(12)]
    storage.save(cache_key(spec), spec, frames)
    assert client.get('/trial/result', params={'first': 'seed=17', 'second': 'value=hello'}).json() == {'found': True}
    assert client.get('/trial/api/mp4/?'+query).headers['content-type'] == 'image/gif'
    assert client.get('/trial/api/morphframe/?'+query+'&frame_num=6').headers['content-type'] == 'image/png'
    assert client.get('/trial/api/morphframe/?'+query+'&frame_num=7').status_code == 400
    assert client.get('/trial/api/face/?seed=17').headers['content-type'] == 'image/png'
