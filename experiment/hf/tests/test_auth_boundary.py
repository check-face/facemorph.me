"""New compute cannot bypass HF login or use local CPU on a hosted Space."""
import os
os.environ['FACEMORPH_LOCAL_DEMO'] = '1'
import app
import storage


def test_anonymous_uncached_denied_before_render(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, 'RESULTS', tmp_path)
    monkeypatch.setattr(storage, 'BUCKET', '')
    monkeypatch.setattr(app, 'LOCAL_DEMO', False)
    monkeypatch.setattr(app, 'HOSTED', True)
    monkeypatch.setenv('SPACES_ZERO_GPU', '1')
    monkeypatch.setattr(app, 'gpu_render', lambda _: (_ for _ in ()).throw(AssertionError('must not render')))
    result = app.generate_morph('seed=918', 'value=test', None)
    assert result['ok'] is False
    assert 'Sign in' in result['message']
    assert not list(tmp_path.iterdir())


def test_hosted_cpu_fails_closed(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, 'RESULTS', tmp_path)
    monkeypatch.setattr(storage, 'BUCKET', '')
    monkeypatch.setattr(app, 'LOCAL_DEMO', False)
    monkeypatch.setattr(app, 'HOSTED', True)
    monkeypatch.delenv('SPACES_ZERO_GPU', raising=False)
    assert app.generate_morph('seed=918', 'value=test', object())['ok'] is False
