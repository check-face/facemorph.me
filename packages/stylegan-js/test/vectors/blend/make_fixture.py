"""Blend fixture (fm-mtax): classic LatentByMultiLerp's arithmetic (checkface/src/server/checkface.py, the
dlatent branch: np.sum([amount * np.array(latent) ...], 0) with amount = max(-2.0, min(2.0, float(amountstr))))
run with numpy on float32 W+ latents from a formula the TS test regenerates. No GPU, no model.
    uv run --with numpy python make_fixture.py"""
import hashlib, json, math
import numpy as np

def latent(k, layers, width):
    i = np.arange(layers * width, dtype=np.float64)
    return (np.sin(k * 1.618 + i * 0.0137) * (1 + (k % 5) * 0.3)).astype(np.float32).reshape(layers, width)

def classic(amounts, latents):
    # The API's request parsing, then LatentByMultiLerp.getLatent for dlatents.
    amounts = [max(-2.0, min(2.0, float(a))) for a in amounts]
    weighted = [amount * np.array(l) for amount, l in zip(amounts, latents)]
    return np.sum(weighted, 0), amounts

cases = [
    {'name': 'one-slot', 'layers': 18, 'width': 512, 'weights': [0.7]},
    {'name': 'sixteen-slots', 'layers': 18, 'width': 512, 'weights': [-2.5, 3, 1, 1, -0.5, 0.25, 2, -2, 0, 0.125, 1.5, -1.25, 0.3, 0.6, 0.9, -0.1]},
    {'name': 'five-hundred-slots', 'layers': 18, 'width': 512, 'weights': [round(((k * 7) % 13 - 6) * 0.4, 4) for k in range(500)]},
    {'name': 'afhq-cat-sixteen-layers', 'layers': 16, 'width': 512, 'weights': [1, 1, -0.5]},
]
out = []
for c in cases:
    lats = [latent(k, c['layers'], c['width']) for k in range(len(c['weights']))]
    s, clamped = classic(c['weights'], lats)
    s = s.astype(np.float32)
    name = c['name'] + '.f32'
    s.tofile(name)
    out.append({**c, 'clampedWeights': clamped, 'weightSum': math.fsum(clamped), 'expected': name, 'expectedSha256': hashlib.sha256(s.tobytes()).hexdigest()})
json.dump({'note': 'Expected blends from classic LatentByMultiLerp arithmetic (numpy %s); latents: float32(sin(k*1.618 + i*0.0137) * (1 + (k %% 5) * 0.3)), k = slot, i = flat index.' % np.__version__, 'cases': out}, open('cases.json', 'w'), indent=1)
print(json.dumps([(c['name'], c['expectedSha256'][:12]) for c in out]))
