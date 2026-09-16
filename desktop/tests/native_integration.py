"""Real Rust supervisor -> pinned ORT CPU worker -> full-resolution PNG proof."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import argparse
import os
import tempfile
import numpy as np
from PIL import Image

D=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--bundle',type=Path,default=D/'local-native/bundle.json')
parser.add_argument('--probe',type=Path,default=D/('src-tauri/target/debug/native-probe.exe' if sys.platform=='win32' else 'src-tauri/target/debug/native-probe'))
parser.add_argument('--report',type=Path,default=D/'local-native/verification.json')
args=parser.parse_args()
bundle_path=args.bundle.resolve()
sys.path.insert(0,str(D/'native'))
from bundle_paths import resolve_assets
data=bundle_path.read_bytes(); bundle=resolve_assets(json.loads(data),bundle_path.parent); digest=hashlib.sha256(data).hexdigest()
route={'provider':'native-cpu','bundle':{'version':bundle['version'],'manifestSha256':digest},'admissionKey':hashlib.sha256((digest+bundle['runtime']['onnxruntime']+'CPUExecutionProvider').encode()).hexdigest()}
probe=args.probe.resolve()
def invoke(request,folder,bundle_file=bundle_path):
    command=[str(probe),sys.executable,str(D/'native/worker.py'),str(bundle_file),str(folder)]
    result=subprocess.run(command,input=json.dumps(request),text=True,capture_output=True,timeout=int(os.environ.get("CHECKFACE_PROBE_TIMEOUT_SECONDS","180"))+15)
    events=[json.loads(line) for line in result.stdout.splitlines()]
    assert events, result.stderr
    return result,events[-1]
with tempfile.TemporaryDirectory(prefix='checkface-native-') as temp:
    folder=Path(temp)
    result,event=invoke({'schemaVersion':1,'jobId':'qualify-1','attemptId':'attempt-1','type':'qualify','route':route},folder)
    assert result.returncode==0 and event['type']=='qualified' and event['checksPassed']==31,(event,result.stderr)
    assert event['attemptId']=='attempt-1' and event['developmentOnly']
    qualification=event
    assert len(qualification['checks'])==31
    controls=[]
    for i in [0,1]:
        values=np.fromfile(bundle['cases'][i]['w']['path'],dtype='<f4').astype(float).tolist()
        controls.append({'visitId':f'face-{i}','latent':{'space':'w-plus','shape':[1,18,512],'values':values}})
    project={'schemaVersion':1,'bundle':route['bundle'],'modelSha256':bundle['model']['sha256'],'noiseSha256':bundle['noiseSha256'],'truncationPsi':.7,'truncationCutoff':8,
             'morph':{'kind':'linear','algorithmVersion':'1','controls':controls,'closed':False,'width':0,'pinchCenter':False,'framesPerSegment':2,'framesPerSecond':24}}
    request={'schemaVersion':1,'jobId':'generate-1','type':'generate','route':route,'project':project,'video':False}
    result,event=invoke(request,folder)
    assert result.returncode==0 and event['type']=='completed' and event['frameCount']==3,(event,result.stderr)
    artifact=folder/event['localArtifactId']; assert (artifact/'COMPLETE').exists()
    manifest=json.loads((artifact/'project.json').read_text()); assert manifest['project']==project
    assert len(manifest['frames'])==3
    for frame in manifest['frames']:
        frame_path=artifact/frame['file']
        assert hashlib.sha256(frame_path.read_bytes()).hexdigest()==frame['sha256']
        assert Image.open(frame_path).size==(1024,1024)
    endpoint_errors=[]
    for index,case in [(0,0),(2,1)]:
        actual=np.asarray(Image.open(artifact/f'{index:04d}.png')).astype(np.int16)
        expected=np.asarray(Image.open(bundle['cases'][case]['reference']['path'])).astype(np.int16)
        endpoint_errors.append(int(np.abs(actual-expected).max()))
        assert actual.shape==(1024,1024,3) and endpoint_errors[-1]<=1
    # Host supervisor must fail closed on corrupt bundle before native inference.
    corrupt=folder/'bundle.json'; corrupt.write_bytes(data+b' ')
    corrupt.with_suffix('.sha256').write_text(digest)
    result,event=invoke(request,folder,corrupt)
    assert result.returncode!=0 and event['type']=='failed'
    controls[0]['latent']['space']='z'
    result,event=invoke(request,folder)
    assert result.returncode!=0 and event['type']=='failed'
    proof={'schemaVersion':1,'bundleVersion':bundle['version'],'evidenceScope':'development CPU integration; not release admission','qualification':qualification,'linearFrames':3,'endpointMaxErrors':endpoint_errors,'exactProjectRoundtrip':True,'corruptBundleRejected':True,'wrongLatentSpaceRejected':True,
           'sources':{str(p.relative_to(D)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [D/'native/worker.py',D/'native/bundle_paths.py',D/'src-tauri/src/bridge.rs',D/'src-tauri/src/bin/native-probe.rs',D/'src-tauri/Cargo.lock']}}
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(proof,indent=2)+'\n')
    print('PASS: 31 native CPU cases, 3-frame linear PNG sequence, reference-matching endpoints (max RGB error 1), project roundtrip, corrupt bundle and wrong-latent-space rejection through Rust supervisor')
