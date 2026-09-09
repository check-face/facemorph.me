import hashlib
import numpy as np
import pytest
from contracts import input_identity, latent, request_spec, cache_key, frame_latents

@pytest.mark.parametrize('text',['','hello','world','你好','é','e\u0301','🙂'])
def test_text_matches_legacy_numpy_seed(text):
    digest=hashlib.sha256(text.encode('utf-8')).digest()
    expected=np.random.RandomState(np.frombuffer(digest,dtype='<u4')).randn(512)
    np.testing.assert_array_equal(latent(input_identity(text,'Words')),expected)

def test_unicode_is_not_silently_normalized():
    assert input_identity('é','Words') != input_identity('e\u0301','Words')

@pytest.mark.parametrize('value',['-1','1.5','4294967296','１２','nan','../file',''])
def test_reject_invalid_seeds(value):
    with pytest.raises(ValueError):input_identity(value,'Seeds')

def test_seed_boundaries():
    for seed in (0,2**32-1):
        np.testing.assert_array_equal(latent(input_identity(str(seed),'Seeds')),np.random.RandomState(seed).randn(512))

def test_morph_preserves_classic_endpoints_and_loop():
    spec=request_spec('0','1','Seeds','morph');frames=frame_latents(spec)
    np.testing.assert_array_equal(frames[0],latent({'seed':0}).astype('float32'))
    np.testing.assert_array_equal(frames[6],latent({'seed':1}).astype('float32'))
    np.testing.assert_allclose(frames[1],frames[-1],atol=1e-6)
    assert frames.shape==(12,512)

def test_renderer_format_and_request_are_part_of_key():
    spec=request_spec('hello','world','Words','faces')
    assert cache_key(spec)!=cache_key({**spec,'renderer':'future'})
    assert cache_key(spec)!=cache_key({**spec,'dimension':1024})
    assert cache_key(spec)!=cache_key(request_spec('hello','world','Words','morph'))
    assert 'hello' not in str(spec)
