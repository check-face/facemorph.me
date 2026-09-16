"""Pin existing local research assets; never download or redistribute models."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DEST = Path(__file__).resolve().parents[1] / 'local-native'
ART = ROOT / 'review-artifacts'
def asset(path):
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
def main():
    original = json.loads((ART / 'browser-onnx-phase1/manifest.json').read_text())
    suite = json.loads((ART / 'browser-onnx-qualification/manifest.json').read_text())
    q = ART / 'browser-onnx-qualification'
    noise = [dict(asset(ART / 'browser-onnx-phase1' / n['file']), name=n['name'], shape=n['shape']) for n in original['noise']]
    manifest = {
        'schemaVersion': 1, 'version': 'native-ort-cpu-dev-1', 'developmentOnly': True,
        'runtime': {'onnxruntime': original['versions']['onnxruntime'], 'provider': 'CPUExecutionProvider', 'threads': 4},
        'model': asset(ART / 'browser-onnx-energy/synthesis-spatial.onnx'),
        'noise': noise,
        'noiseSha256': hashlib.sha256(''.join(n['sha256'] for n in noise).encode()).hexdigest(),
        'indices': asset(q / suite['sampleIndices']),
        'cases': [dict(name=c['name'], noise=c['noise'], **{k: asset(q/c[k]) for k in ['w', 'reference', 'samples']}) for c in suite['cases']],
    }
    DEST.mkdir(exist_ok=True)
    data = (json.dumps(manifest, indent=2) + '\n').encode()
    (DEST / 'bundle.json').write_bytes(data)
    (DEST / 'bundle.sha256').write_text(hashlib.sha256(data).hexdigest() + '\n')
    print(DEST / 'bundle.json')
if __name__ == '__main__': main()
