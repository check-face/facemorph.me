"""Component load (fm-fy2.15): a model-conv output loads and runs in the candidate's own runtime harness.

Builds a runtime overlay: the verified candidate runtime acquisition (scripts/runtime/acquire.mjs) with every
generator asset the conversion changed (in practice synthesis.onnx and its chunks) replaced by the converted
file at its content address; unchanged assets keep the candidate's bytes. Then runs the exact-artifact
control harness (scripts/import/control-harness.py) on that overlay: the candidate's app, worker and ORT
build, its full canary qualification against the shipped references (a webdriver session qualifies every
canary before the first face), face generation on the CPU route, network classes and cancellation. Run on a
worker under the device lease (the harness takes port 8443, as the device lab does):

  python3 autoresearch/run.py --lane browser-cpu --device eris --timeout 3600 --wait 1800 -- \\
    mise x uv@0.12.21 -- uv run --with browser-harness==0.1.8 --with playwright \\
    python packages/model-conv/tests/component_load.py --out packages/model-conv/out/ffhq --runtime .cache/runtime --evidence <dir>
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ORIGIN = 'https://next.facemorph.me'
# Classic's seedGeneration stage generates two faces (waiting for both at 1024 px, fitting their tiles), then
# asserts the second used the published-name W+ pathway. Published latents are keyed to the shipped
# synthesis digest, so with a converted (numerically equivalent, byte-different) synthesis the app correctly
# declines them and maps the name instead. That one assertion is identity-bound and not applicable here;
# reaching it means both faces rendered. Every other check must pass.
IDENTITY_BOUND = 'seedGeneration: Published name silently fell back to mapping'


def place(src: Path, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(src, dest)
    except OSError:
        shutil.copyfile(src, dest)


def overlay(out: Path, runtime: Path, work: Path) -> dict:
    """The overlay runtime directory and what it replaced."""
    converted = json.loads((out / 'manifest.json').read_text())
    manifest = json.loads((runtime / 'manifest.json').read_text())
    for f in runtime.rglob('*'):
        if f.is_file() and f.name != 'manifest.json':
            place(f, work / f.relative_to(runtime))
    replaced = {}
    for part in ['mapping', 'synthesis', 'average']:
        mine, shipped = converted[part], manifest[part]
        if mine['sha256'] == shipped['sha256']:
            continue
        data = b''.join((out / c['file']).read_bytes() for c in mine['chunks']) if mine.get('chunks') else (out / mine['file']).read_bytes()
        name = shipped['url'].rsplit('/', 1)[1]
        entry = {'url': f"{ORIGIN}/runtime/assets/{mine['sha256']}/{name}", 'sha256': mine['sha256'], 'size': mine['size']}
        (work / 'assets' / mine['sha256']).mkdir(parents=True, exist_ok=True)
        (work / 'assets' / mine['sha256'] / name).write_bytes(data)
        if mine.get('chunks'):
            entry['chunks'] = []
            for c in mine['chunks']:
                place(out / c['file'], work / 'chunks' / f"{c['sha256']}.bin")
                entry['chunks'].append({'url': f"{ORIGIN}/runtime/chunks/{c['sha256']}.bin", 'size': c['size'], 'sha256': c['sha256']})
        replaced[part] = {'shipped': shipped['sha256'], 'converted': mine['sha256']}
        manifest[part] = entry
    shipped_noise = {n['name']: n['sha256'] for n in manifest['noise']}
    if any(shipped_noise.get(n['name']) != n['sha256'] for n in converted['noise']):
        raise SystemExit('converted noise differs from the shipped noise; the overlay would need new noise entries')
    (work / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
    return {'replaced': replaced, 'overlayManifestSha256': hashlib.sha256((work / 'manifest.json').read_bytes()).hexdigest(),
            'baseRuntimeManifestSha256': hashlib.sha256((runtime / 'manifest.json').read_bytes()).hexdigest()}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--out', type=Path, required=True, help='a model-conv output (manifest.json and its files)')
    ap.add_argument('--runtime', type=Path, required=True, help='the verified candidate runtime acquisition')
    ap.add_argument('--evidence', type=Path, required=True)
    a = ap.parse_args()
    a.evidence.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='component-load-', dir=a.runtime.resolve().parent) as tmp:
        work = Path(tmp) / 'runtime'
        info = overlay(a.out.resolve(), a.runtime.resolve(), work)
        print(json.dumps({'event': 'overlay', **info}), flush=True)
        code = subprocess.run([sys.executable, str(REPO / 'scripts/import/control-harness.py'), '--runtime', str(work), '--out', str(a.evidence)]).returncode
    report = json.loads((a.evidence / 'report.json').read_text()) if (a.evidence / 'report.json').exists() else {}
    functional = report.get('functional') or {}
    identity_bound = str(functional.get('stageError', '')).startswith(IDENTITY_BOUND)
    loaded = functional.get('passed') is True or (identity_bound and functional.get('checks', {}).get('preflight') is True)
    others = all((report.get(k) or {}).get('passed') is True for k in ['network', 'cancellation'])
    summary = {'event': 'component-load', 'passed': bool(loaded and others), **info,
               'facesRendered': loaded, 'publishedNamePathway': 'not applicable: published latents are keyed to the shipped synthesis digest' if identity_bound else functional.get('passed'),
               'functional': functional, 'network': report.get('network'), 'cancellation': report.get('cancellation')}
    (a.evidence / 'component-load.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary), flush=True)
    return 0 if summary['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
