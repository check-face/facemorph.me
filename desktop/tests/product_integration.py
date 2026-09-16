"""Execute the frozen product worker: admission, input, photo, cache and W+ reuse.

Uses synthetic bundled canary imagery; never real user uploads. Worker bytes tested
here are subsequently included unchanged in the desktop package.
"""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
from asset_store import acquire, checksum


def main():
    p=argparse.ArgumentParser();p.add_argument('--worker',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True);p.add_argument('--cache',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--report',type=Path,required=True);p.add_argument('--python',type=Path);a=p.parse_args()
    manifest=json.loads(a.manifest.read_text());reports=[]
    command=([str(a.python)] if a.python else [])+[str(a.worker),'--manifest',str(a.manifest),'--cache',str(a.cache),'--output',str(a.output)]
    def run(operation,**payload):
        job=str(uuid.uuid4());request=dict(schemaVersion=1,jobId=job,type='qualify' if operation=='qualify' else 'generate',attemptId=job,operation=operation,provider='cpu',**payload)
        started=time.monotonic();done=subprocess.run(command,input=json.dumps(request)+'\n',text=True,capture_output=True,timeout=1200,env={**os.environ,'CHECKFACE_NATIVE_DIAGNOSTICS':'1'})
        events=[json.loads(line) for line in done.stdout.splitlines()];terminal=events[-1] if events else {}
        if done.returncode or terminal.get('type') not in ('qualified','completed'):
            a.report.parent.mkdir(parents=True,exist_ok=True)
            a.report.write_text(json.dumps({'schemaVersion':1,'passed':False,'workerSha256':checksum(a.worker),'manifestSha256':checksum(a.manifest),'runs':reports,'failure':{'operation':operation,'exitCode':done.returncode,'events':events,'diagnostics':done.stderr[-3000:]}},indent=2)+'\n')
            raise RuntimeError(f'{operation} failed: {terminal}; {done.stderr[-3000:]}')
        entry={'operation':operation,'seconds':time.monotonic()-started,'terminal':terminal,'stages':[e for e in events if e['type']=='progress']};reports.append(entry)
        if terminal.get('cacheMiss') is True:return terminal
        if operation=='qualify':
            if not terminal.get('deviceValidated'):raise AssertionError('Missing device admission')
            return terminal
        folder=a.output/terminal['localArtifactId'];result=json.loads((folder/'result.json').read_text())
        from PIL import Image
        with Image.open(folder/'image.png') as image:
            if image.size!=(1024,1024) or image.format!='PNG':raise AssertionError('Full1024 lossless original missing')
        if checksum(folder/'image.png')!=result['imageSha256']:raise AssertionError('Original integrity mismatch')
        if len(result['values'])!=9216:raise AssertionError('Editable W+ missing')
        return result
    missing=run('generate',mode='seed',value='4294967295',cacheOnly=True)
    if missing.get('cacheMiss') is not True or any(e.get('stage')=='model-loading' for e in reports[-1]['stages']):raise AssertionError('Cache-only miss started inference')
    run('qualify')
    seed=run('generate',mode='seed',value='0');again=run('generate',mode='seed',value='0',cacheOnly=True)
    if not again.get('cached') or seed['imageSha256']!=again['imageSha256']:raise AssertionError('Persistent original reuse failed')
    text=run('generate',mode='text',value='oliver')
    reconstructed=run('synthesize',values=text['values'])
    if reconstructed['imageSha256']!=text['imageSha256']:raise AssertionError('Project latent roundtrip changed result')
    original_keys=set((a.cache/'originals').iterdir());intermediate=list(text['values']);intermediate[0]+=.01
    run('synthesize',values=intermediate,persist=False)
    if set((a.cache/'originals').iterdir())!=original_keys or not any(e.get('stage')=='transient-frame' for e in reports[-1]['stages']):raise AssertionError('Intermediate video frame polluted the persistent originals cache')
    from PIL import Image
    blank=io.BytesIO();Image.new('RGB',(256,256),(128,128,128)).save(blank,format='PNG')
    rejected_request={'schemaVersion':1,'jobId':str(uuid.uuid4()),'type':'generate','operation':'encodePhoto','provider':'cpu','photoBase64':base64.b64encode(blank.getvalue()).decode()}
    rejected=subprocess.run(command,input=json.dumps(rejected_request)+'\n',text=True,capture_output=True,timeout=120)
    rejected_events=[json.loads(line) for line in rejected.stdout.splitlines()]
    if rejected.returncode!=1 or rejected_events[-1].get('reason')!='Choose a photo with one clear face, or crop it closer.' or any(e.get('stage')=='encoding' for e in rejected_events):raise AssertionError('Photo without a detected face did not fail closed before encoding')
    photo_cases=manifest.get('photoCanaries') or [manifest.get('photoCanary')]
    if not photo_cases or not all(photo_cases):raise AssertionError('Independent photo canary missing')
    import numpy as np
    photo_checks=[]
    for index,photo_case in enumerate(photo_cases):
        photo=acquire(photo_case['image'],a.cache/'models')
        encoded=run('encodePhoto',photoBase64=base64.b64encode(photo.read_bytes()).decode())
        if encoded['encoderProvider']!='native-cpu':raise AssertionError('Actual native encoder missing')
        reference=np.fromfile(acquire(photo_case['w'],a.cache/'models'),dtype='<f4')
        if reference.size!=9216:raise AssertionError('Invalid encoder reference')
        photo_error=float(np.abs(np.asarray(encoded['values'],dtype=np.float32)-reference).max())
        if not np.isfinite(photo_error) or photo_error>min(.0001,photo_case['maxAbs']):raise AssertionError(f'Actual alignment/e4e W+ error {photo_error}')
        if encoded.get('aligned') is not True:raise AssertionError('Photo canary was not aligned')
        evidence={'index':index,'maxWError':photo_error}
        if photo_case.get('reconstruction'):
            with Image.open(acquire(photo_case['reconstruction'],a.cache/'models')) as expected,Image.open(a.output/reports[-1]['terminal']['localArtifactId']/'image.png') as actual:
                delta=np.abs(np.asarray(expected.convert('RGB'),dtype=np.int16)-np.asarray(actual.convert('RGB'),dtype=np.int16))
                evidence['maxRgb']=int(delta.max())
                if evidence['maxRgb']>1:raise AssertionError('Photo reconstruction differs from independent reference')
        repeated=run('encodePhoto',photoBase64=base64.b64encode(photo.read_bytes()).decode())
        if not repeated['cached'] or repeated['imageSha256']!=encoded['imageSha256']:raise AssertionError('Photo original cache failed')
        photo_checks.append(evidence)
    a.report.parent.mkdir(parents=True,exist_ok=True)
    a.report.write_text(json.dumps({'schemaVersion':1,'workerSha256':checksum(a.worker),'manifestSha256':checksum(a.manifest),'passed':True,'installedUiTested':False,'photoWithoutFaceRejected':True,'photoNumericalReferenceQualified':True,'photoMaxAbs':max(x['maxWError'] for x in photo_checks),'photoChecks':photo_checks,'runs':reports},indent=2)+'\n')
    print('PASS actual worker: native canaries, seed/text, photo encoder/reconstruction, cache and latent reopening')
if __name__=='__main__':main()
