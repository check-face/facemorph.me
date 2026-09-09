from types import SimpleNamespace
from PIL import Image
import app
import storage


def request(mode):
    return SimpleNamespace(request=SimpleNamespace(cookies={'facemorph_review': mode}))


def setup(monkeypatch, tmp_path):
    monkeypatch.setattr(app, 'LOCAL_REVIEW', True)
    monkeypatch.setattr(app, 'LOCAL_DEMO', True)
    monkeypatch.setattr(app, 'HOSTED', False)
    monkeypatch.setattr(storage, 'RESULTS', tmp_path)
    monkeypatch.setattr(storage, 'BUCKET', '')


def test_signed_out_and_exhausted_deny_before_compute(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path)
    monkeypatch.setattr(app, 'renderer', SimpleNamespace(render=lambda _: (_ for _ in ()).throw(AssertionError('must not render'))))
    for mode in ['signed-out', 'exhausted', 'invalid']:
        assert not app.generate_morph('seed=91', 'seed=93', None, request(mode))['ok']
    assert not list(tmp_path.iterdir())


def test_own_allowance_demo_then_anonymous_cache_hit(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path)
    calls = []
    def render(spec):
        calls.append(spec)
        return [Image.new('RGB', (8, 8), (i*20, 0, 0)) for i in range(12)]
    monkeypatch.setattr(app, 'renderer', SimpleNamespace(render=render))
    assert app.generate_morph('seed=91', 'seed=93', None, request('free'))['ok']
    assert app.generate_morph('seed=91', 'seed=93', None, request('exhausted'))['cached']
    assert app.generate_morph('seed=91', 'seed=93', None, request('signed-out'))['cached']
    assert len(calls) == 1
    assert app.generate_morph('seed=92', 'seed=93', None, request('paid'))['ok']
    assert len(calls) == 2


def test_hosted_path_ignores_demo_cookie(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path)
    monkeypatch.setattr(app, 'LOCAL_REVIEW', False)
    monkeypatch.setattr(app, 'LOCAL_DEMO', False)
    monkeypatch.setattr(app, 'HOSTED', True)
    result = app.generate_morph('seed=91', 'seed=93', None, request('paid'))
    assert not result['ok']
    assert 'Sign in' in result['message']
