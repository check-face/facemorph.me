"""Packaged native ORT pipeline: seed/text, aligned e4e and full1024 PNG.

Only host-selected manifests and output roots are accepted. No network inference.
The diagnostic worker remains separate; this worker uses the product asset schema.
"""
import argparse
import base64
import hashlib
import io
import json
import os
import platform
from pathlib import Path
import re
import sys
import time
import uuid
import warnings
from asset_store import acquire, checksum

MAX_REQUEST = 36 * 1024 * 1024

class PhotoAlignmentError(ValueError):
    pass

def execute(request, manifest, cache, output, emit):
    import numpy as np
    import onnxruntime as ort
    from PIL import Image, ImageOps
    if manifest.get('schemaVersion') != 1 or ort.__version__ != manifest['runtime']['version']:
        raise ValueError('Pinned runtime mismatch')
    if request.get('provider', 'cpu') != 'cpu':
        raise ValueError('This native artifact only qualifies CPU')
    asset_root = cache / 'models'
    def asset(item):
        emit('asset-acquisition')
        return acquire(item, asset_root, lambda done,total: emit('asset-acquisition', loaded=done,total=total))
    def floats(item): return np.fromfile(asset(item), dtype='<f4')
    options = ort.SessionOptions()
    options.intra_op_num_threads = min(4, os.cpu_count() or 1)
    emit('native-environment',architecture=platform.machine(),os=platform.system(),osRelease=platform.release(),runtime=ort.__version__,threads=options.intra_op_num_threads)
    def session(item):
        path = asset(item)
        started = time.monotonic(); emit('model-loading',modelSha256=item['sha256'])
        # Exported graphs are self-contained; external data are forbidden by bundle build.
        model = ort.InferenceSession(str(path), options, providers=['CPUExecutionProvider'])
        if model.get_providers() != ['CPUExecutionProvider']: raise ValueError('Unexpected native provider')
        emit('model-loaded', elapsedMs=(time.monotonic()-started)*1000,modelSha256=item['sha256'])
        return model
    def checked(values):
        values = np.asarray(values,dtype=np.float32)
        if values.size != 9216 or not np.isfinite(values).all(): raise ValueError('Invalid W+ latent')
        return values.reshape(1,18,512)
    def pixels(raw):
        if raw.shape != (1,3,1024,1024) or not np.isfinite(raw).all(): raise ValueError('Invalid synthesis output')
        return np.clip(raw[0]*np.float32(127.5)+np.float32(128),0,255).astype(np.uint8).transpose(1,2,0)
    def synthesis(values, model, noise, mode='original'):
        feed = {name: value if mode=='original' else np.zeros_like(value) if mode=='zero' else -value for name,value in noise.items()}
        emit('synthesis'); started = time.monotonic()
        result = model.run(None, dict(feed,w=checked(values)))[0]
        pixels(result); emit('synthesis-complete',elapsedMs=(time.monotonic()-started)*1000)
        return result
    operation = request.get('operation', request['type'])
    identity = {'pipeline':'native-product-v3','synthesisSha256':manifest['synthesis']['sha256'],
                'noiseSha256':manifest['noiseSha256'],'architecture':platform.machine(),
                'provider':'CPUExecutionProvider','runtime':ort.__version__,'operation':operation}
    values = None; photo_aligned = None
    if operation == 'generate':
        identity.update(mappingSha256=manifest['mapping']['sha256'],averageSha256=manifest['average']['sha256'],truncationPsi=.7,truncationCutoff=8)
        mode, value = request['mode'], request['value']
        if not isinstance(value,str) or len(value.encode()) > 512: raise ValueError('Invalid input')
        if mode == 'seed':
            if not re.fullmatch('[0-9]+',value) or int(value)>4294967295: raise ValueError('Invalid seed')
            seed = int(value); identity['seed'] = seed
        elif mode == 'text':
            digest = hashlib.sha256(value.encode()).digest(); seed = np.frombuffer(digest,dtype='<u4')
            identity['textSha256'] = digest.hex()
        else: raise ValueError('Unknown input mode')
    elif operation == 'synthesize':
        values = checked(request['values']); identity['latentSha256'] = hashlib.sha256(values.astype('<f4').tobytes()).hexdigest()
    elif operation == 'encodePhoto':
        image_data = base64.b64decode(request['photoBase64'],validate=True)
        if not 0 < len(image_data) <= 25*1024*1024: raise ValueError('Invalid photo size')
        identity['photoSha256'] = hashlib.sha256(image_data).hexdigest()
        identity.update(encoderSha256=manifest.get('encoder',{}).get('sha256'),landmarksSha256=manifest.get('landmarks',{}).get('sha256'),preprocessing='dlib-one-face-ffhq-pillow-exif-bilinear-v2')
    elif operation != 'qualify': raise ValueError('Unknown operation')
    key = hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()
    originals = cache / 'originals' / key
    def publish(folder,cached):
        artifact = str(uuid.uuid4()); destination = output / artifact; destination.mkdir(parents=True)
        import shutil
        shutil.copyfile(folder/'image.png',destination/'image.png')
        result = json.loads((folder/'result.json').read_text()); result['cached'] = cached
        (destination/'result.json').write_text(json.dumps(result,allow_nan=False))
        (destination/'COMPLETE').write_text('1')
        return {'localArtifactId':artifact,'provider':'native-cpu','cached':cached}
    if operation != 'qualify' and (originals/'COMPLETE').exists():
        try:
            record=json.loads((originals/'result.json').read_text())
            checked(record['values'])
            if record['shape']!=[1,18,512] or record['space']!='w-plus':raise ValueError('Cached latent metadata invalid')
            if operation=='encodePhoto' and record.get('aligned') is not True:raise ValueError('Unaligned cached photo')
            if checksum(originals/'image.png') == record['imageSha256']:
                emit('original-cache-hit'); return publish(originals,True)
        except (OSError,ValueError,TypeError,KeyError):
            emit('original-cache-invalid')
    if operation != 'qualify' and request.get('cacheOnly') is True:
        return {'cacheMiss':True,'provider':'native-cpu'}
    if operation == 'generate':
        mapping = session(manifest['mapping']); average = floats(manifest['average'])
        z = np.random.RandomState(seed).randn(1,512).astype(np.float32)
        emit('mapping'); started=time.monotonic(); values = checked(mapping.run(None,{'z':z})[0]); del mapping
        emit('mapping-complete',elapsedMs=(time.monotonic()-started)*1000)
        values[:,:8] = (values[:,:8]-average)*np.float32(.7)+average
    elif operation == 'encodePhoto':
        if not manifest.get('encoder') or not manifest.get('landmarks'): raise ValueError('Native photo assets unavailable')
        import dlib
        from alignment import align_face, NumberOfFacesError
        Image.MAX_IMAGE_PIXELS=8192*4096
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(image_data)) as source:
                image = ImageOps.exif_transpose(source).convert('RGB')
        predictor=dlib.shape_predictor(str(asset(manifest['landmarks']))); emit('alignment'); started=time.monotonic()
        try: image=align_face(None,predictor,img=image); photo_aligned=True
        except NumberOfFacesError as error:
            raise PhotoAlignmentError('Choose a photo with one clear face, or crop it closer.') from error
        del predictor
        emit('alignment-complete',elapsedMs=(time.monotonic()-started)*1000,aligned=photo_aligned)
        image=image.resize((256,256),Image.Resampling.BILINEAR)
        tensor=((np.asarray(image,dtype=np.float32)/np.float32(255)-np.float32(.5))/np.float32(.5)).transpose(2,0,1)[None]
        encoder=session(manifest['encoder']); emit('encoding'); started=time.monotonic()
        values=checked(encoder.run(None,{'image':tensor})[0]); del encoder
        emit('encoding-complete',elapsedMs=(time.monotonic()-started)*1000)
    model=session(manifest['synthesis'])
    noise={item['name']:floats(item).reshape(item['shape']) for item in manifest['noise']}
    if operation == 'qualify':
        cases=manifest['canaries']
        if len(cases)<2: raise ValueError('Incomplete canary suite')
        indices=np.fromfile(asset(manifest['sampleIndices']),dtype='<i4'); checks=[]
        for case in cases:
            raw=synthesis(floats(case['w']),model,noise,case['noise'])
            reference=np.asarray(Image.open(asset(case['reference'])).convert('RGB'))
            max_rgb=int(np.abs(pixels(raw).astype(np.int16)-reference.astype(np.int16)).max())
            max_float=float(np.abs(raw.reshape(-1)[indices]-floats(case['samples'])).max())
            if max_rgb>1 or max_float>.002: raise ValueError('Native reference check failed')
            checks.append(dict(name=case['name'],maxRgb=max_rgb,maxFloat=max_float,passed=True))
        return dict(deviceValidated=True,provider='native-cpu',checks=checks,releaseQualified=manifest.get('releaseQualified') is True)
    raw=synthesis(values,model,noise)
    transient=operation=='synthesize' and request.get('persist') is False
    if transient:originals=output/('.transient-'+str(uuid.uuid4()))
    originals.mkdir(parents=True,exist_ok=True)
    temporary=originals/'image.partial'; Image.fromarray(pixels(raw)).save(temporary,format='PNG'); temporary.replace(originals/'image.png')
    result={'space':'w-plus','shape':[1,18,512],'values':values.reshape(-1).tolist(),'width':1024,'height':1024,
            'imageSha256':checksum(originals/'image.png'),'provenance':{**identity,
                'bundleVersion':manifest['bundleVersion'],
                'manifestSha256':hashlib.sha256(json.dumps(manifest,separators=(',',':'),ensure_ascii=False).encode()).hexdigest(),
                'modelSha256':manifest['modelSourceSha256'],'noiseSha256':manifest['noiseSha256'],
                'truncationPsi':None if operation=='encodePhoto' else .7 if operation=='generate' else 1,
                'truncationCutoff':None if operation=='encodePhoto' else 8 if operation=='generate' else 0},'aligned':photo_aligned,'encoderProvider':'native-cpu' if operation=='encodePhoto' else None}
    (originals/'result.json').write_text(json.dumps(result,allow_nan=False)); (originals/'COMPLETE').write_text('1')
    emit('transient-frame' if transient else 'original-cached')
    try:return publish(originals,False)
    finally:
        if transient:
            for name in ('image.png','result.json','COMPLETE'):(originals/name).unlink(missing_ok=True)
            originals.rmdir()

def main():
    if sys.argv[1:]==['--self-check']:
        import numpy as np
        import onnxruntime as ort
        import dlib
        import scipy.ndimage
        import alignment
        import certifi, ssl
        ssl.create_default_context(cafile=certifi.where())
        dlib.get_frontal_face_detector()(np.zeros((32,32,3),dtype=np.uint8),0)
        scipy.ndimage.gaussian_filter(np.zeros((4,4),dtype=np.float32),1)
        print(json.dumps({'nativeDependenciesAvailable':True,'onnxruntime':ort.__version__,'architecture':platform.machine()}))
        return 0
    p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True);p.add_argument('--cache',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();job='invalid'
    def send(kind,**fields): print(json.dumps(dict(schemaVersion=1,jobId=job,type=kind,**fields),allow_nan=False),flush=True)
    try:
        data=sys.stdin.buffer.readline(MAX_REQUEST+1)
        if len(data)>MAX_REQUEST: raise ValueError('Request too large')
        request=json.loads(data);job=request['jobId']
        if not isinstance(job,str) or not re.fullmatch('[A-Za-z0-9_-]{1,128}',job) or request.get('schemaVersion')!=1:raise ValueError('Invalid request')
        manifest=json.loads(a.manifest.read_text())
        result=execute(request,manifest,a.cache,a.output,lambda stage,**details:send('progress',fraction=0,stage=stage,**details))
        if request['type']=='qualify':send('qualified',attemptId=request['attemptId'],**result)
        else:send('completed',**result)
    except Exception as error:
        if os.environ.get('CHECKFACE_NATIVE_DIAGNOSTICS')=='1':
            import traceback;traceback.print_exc(file=sys.stderr)
        send('failed',reason=str(error) if isinstance(error,PhotoAlignmentError) else 'Native processing failed. Retry or enable optional diagnostics.');return 1
    return 0
if __name__=='__main__':sys.exit(main())
