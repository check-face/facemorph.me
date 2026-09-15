"""Development native CPU synthesis worker. One bounded NDJSON request per process.

Does not admit production routes, map seeds/photos, render custom geometry or encode
video. Renderer callers cannot choose filesystem paths or executable commands.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import uuid

MAX_REQUEST = 2 * 1024 * 1024
def sha(data): return hashlib.sha256(data).hexdigest()
def read_asset(item):
    data = Path(item['path']).read_bytes()
    if sha(data) != item['sha256']: raise ValueError('Pinned asset integrity check failed')
    return data
def emit(job, kind, **fields):
    print(json.dumps(dict(schemaVersion=1, jobId=job, type=kind, **fields), allow_nan=False), flush=True)

def run(request, bundle_path, output):
    if request['type'] == 'generate':
        controls = request['project']['morph']['controls']
        if not controls or any(c['latent'].get('space') != 'w-plus' for c in controls):
            raise ValueError('Native synthesis requires explicit W+ controls')
    import numpy as np
    import onnxruntime as ort
    from PIL import Image
    job = request['jobId']
    data = bundle_path.read_bytes()
    digest = sha(data)
    if digest != bundle_path.with_suffix('.sha256').read_text().strip(): raise ValueError('Bundle integrity check failed')
    bundle = json.loads(data)
    if bundle['schemaVersion'] != 1 or bundle['developmentOnly'] is not True: raise ValueError('Unsupported bundle')
    if ort.__version__ != bundle['runtime']['onnxruntime']: raise ValueError('Pinned runtime version mismatch')
    route = request['route']
    expected_bundle = {'version': bundle['version'], 'manifestSha256': digest}
    if route['provider'] != 'native-cpu' or route['bundle'] != expected_bundle: raise ValueError('Native CPU route mismatch')
    key = sha((digest + ort.__version__ + 'CPUExecutionProvider').encode())
    if route['admissionKey'] != key: raise ValueError('Admission identity mismatch')
    model_data = read_asset(bundle['model'])
    noise = {n['name']: np.frombuffer(read_asset(n), dtype='<f4').reshape(n['shape']) for n in bundle['noise']}
    options = ort.SessionOptions()
    options.intra_op_num_threads = bundle['runtime']['threads']
    # Loading bytes prevents external ONNX files from bypassing the asset inventory.
    session = ort.InferenceSession(model_data, options, providers=['CPUExecutionProvider'])
    del model_data
    if session.get_providers() != ['CPUExecutionProvider']: raise ValueError('Unexpected execution provider')
    indices = np.frombuffer(read_asset(bundle['indices']), dtype='<i4')
    def infer(w, mode='original'):
        feed = {name: n if mode == 'original' else np.zeros_like(n) if mode == 'zero' else -n for name, n in noise.items()}
        result = session.run(None, dict(feed, w=w))[0]
        if result.shape != (1, 3, 1024, 1024) or not np.isfinite(result).all(): raise ValueError('Invalid native output')
        return result
    def rgb(raw): return np.clip(raw.reshape(3,1024,1024)*np.float32(127.5)+np.float32(128),0,255).astype(np.uint8).transpose(1,2,0)
    checks = bundle['cases'] if request['type'] == 'qualify' else [bundle['cases'][0], bundle['cases'][-1]]
    if len(bundle['cases']) != 31: raise ValueError('Incomplete qualification bundle')
    evidence = []
    for i, case in enumerate(checks):
        w = np.frombuffer(read_asset(case['w']), dtype='<f4').reshape(1,18,512)
        raw = infer(w, case['noise'])
        import io
        reference = np.asarray(Image.open(io.BytesIO(read_asset(case['reference']))).convert('RGB'))
        samples = np.frombuffer(read_asset(case['samples']), dtype='<f4')
        max_rgb = int(np.abs(rgb(raw).astype(np.int16)-reference.astype(np.int16)).max())
        max_float = float(np.max(np.abs(raw.reshape(-1)[indices]-samples)))
        if max_rgb > 1 or max_float > .002:
            raise ValueError('Native reference canary failed')
        evidence.append({'name':case['name'],'finite':True,'maxRgb':max_rgb,'maxFloat':max_float})
        emit(job, 'progress', fraction=(i+1)/len(checks) * (1 if request['type']=='qualify' else .25))
    if request['type'] == 'qualify':
        # Deliberately not a Runtime.Qualified event: still lacks release reliability
        # evidence. Tests/UI can report diagnostic success without enabling production.
        emit(job, 'qualified', attemptId=request['attemptId'], developmentOnly=True, checksPassed=31, checks=evidence,
             admission={'route':route, 'modelSha256':bundle['model']['sha256'], 'noiseSha256':bundle['noiseSha256'],
                        'latentSpace':'w-plus', 'latentShape':[1,18,512], 'algorithms':[{'kind':'linear','version':'1'}], 'videoExport':False})
        return
    project = request['project']
    morph = project['morph']
    if type(project['schemaVersion']) is not int or project['schemaVersion'] != 1 or project['bundle'] != expected_bundle or project['modelSha256'] != bundle['model']['sha256'] or project['noiseSha256'] != bundle['noiseSha256']:
        raise ValueError('Project asset identity mismatch')
    if request.get('video') or morph['kind'] != 'linear' or morph['algorithmVersion'] != '1': raise ValueError('Only native linear PNG sequences are implemented')
    # W+ controls already contain truncation; do not truncate them a second time.
    if type(project['truncationPsi']) not in (int,float) or not math.isfinite(project['truncationPsi']) or project['truncationPsi'] < 0 or type(project['truncationCutoff']) is not int or project['truncationCutoff'] < 0: raise ValueError('Invalid truncation metadata')
    frames = morph['framesPerSegment']
    controls = morph['controls']
    if type(morph['width']) not in (int,float) or not math.isfinite(morph['width']) or morph['width'] < 0 or type(morph['pinchCenter']) is not bool or type(morph['framesPerSecond']) is not int or not 1 <= morph['framesPerSecond'] <= 240: raise ValueError('Invalid morph metadata')
    if type(morph['closed']) is not bool or type(frames) is not int or frames < 2 or frames % 2 or len(controls) < 2: raise ValueError('Invalid morph schedule')
    segments = len(controls) if morph['closed'] else len(controls)-1
    count = segments * frames + (not morph['closed'])
    if count > 120: raise ValueError('Development sequence limit is 120 frames')
    if len({c['visitId'] for c in controls}) != len(controls): raise ValueError('Duplicate visit identifiers')
    latents = []
    for c in controls:
        if not isinstance(c['visitId'], str) or not c['visitId'] or c['latent'].get('space') != 'w-plus' or c['latent']['shape'] != [1,18,512] or len(c['latent']['values']) != 9216: raise ValueError('Invalid native latent')
        if any(type(v) not in (int,float) or not math.isfinite(v) for v in c['latent']['values']): raise ValueError('Invalid latent values')
        w = np.asarray(c['latent']['values'], dtype=np.float32).reshape(1,18,512)
        if not np.isfinite(w).all(): raise ValueError('Invalid native latent')
        latents.append(w)
    for i in range(segments):
        if np.array_equal(latents[i],latents[(i+1)%len(latents)]): raise ValueError('Degenerate adjacent controls')
    artifact = str(uuid.uuid4())
    folder = output / artifact
    folder.mkdir(parents=True)
    manifest = {'schemaVersion':1,'project':project,'frames':[],'developmentOnly':True}
    try:
        for i in range(count):
            segment, frame = divmod(i, frames)
            if segment == segments: w = latents[-1]
            else:
                u = np.float32(frame/frames)
                w = latents[segment]*(1-u)+latents[(segment+1)%len(latents)]*u
            target = folder / f'{i:04d}.png'
            Image.fromarray(rgb(infer(w))).save(target)
            manifest['frames'].append({'file':target.name,'sha256':sha(target.read_bytes())})
            emit(job,'progress',fraction=.25+.75*(i+1)/count)
        (folder/'project.json').write_text(json.dumps(manifest,allow_nan=False)+'\n')
        (folder/'COMPLETE').write_text('1\n')
        emit(job,'completed',localArtifactId=artifact,frameCount=count,developmentOnly=True)
    except BaseException:
        # Partial folders have no COMPLETE marker and are never successful artifacts.
        raise

def main():
    p=argparse.ArgumentParser(); p.add_argument('--bundle',type=Path,required=True); p.add_argument('--output',type=Path,required=True); args=p.parse_args()
    job='invalid'
    try:
        line=sys.stdin.buffer.readline(MAX_REQUEST+1)
        if len(line)>MAX_REQUEST: raise ValueError('Request too large')
        request=json.loads(line,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON')))
        job=request['jobId']
        if not isinstance(job,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',job) or type(request['schemaVersion']) is not int or request['schemaVersion']!=1 or request['type'] not in ['qualify','generate']: raise ValueError('Invalid native request')
        if request['type']=='qualify' and (not isinstance(request.get('attemptId'),str) or not request['attemptId']): raise ValueError('Missing qualification attempt')
        run(request,args.bundle,args.output)
    except Exception:
        # Do not emit user inputs, local paths or library diagnostics to renderer.
        emit(job,'failed',reason='Native request failed validation or execution')
        return 1
    return 0
if __name__=='__main__': sys.exit(main())
