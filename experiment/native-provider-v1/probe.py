"""Bounded provider feasibility; never promotes a product route or claims GPU from EP names."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import platform
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'desktop/native'))
from asset_store import acquire,checksum
import numpy as np
import onnxruntime as ort
from PIL import Image

p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True);p.add_argument('--cache',type=Path,required=True);p.add_argument('--report',type=Path,required=True);p.add_argument('--provider',choices=['coreml','directml','cuda'],required=True);p.add_argument('--cases',type=int,choices=[1,31],default=1);a=p.parse_args()
m=json.loads(a.manifest.read_text());a.report.parent.mkdir(parents=True,exist_ok=True)
provider={'coreml':'CoreMLExecutionProvider','directml':'DmlExecutionProvider','cuda':'CUDAExecutionProvider'}[a.provider]
result={'schemaVersion':1,'candidate':'native-provider-v1','sourceSha256':checksum(Path(__file__)),'manifestSha256':checksum(a.manifest),'platform':platform.platform(),'runtime':ort.__version__,'availableProviders':ort.get_available_providers(),'requestedProvider':provider,'productQualified':False,'gpuExecutionProven':False,'alignedPhotoPipelineTested':False,'stages':[]}
def save():a.report.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
def asset(x):return acquire(x,a.cache/'models')
def floats(x):return np.fromfile(asset(x),dtype='<f4')
save()
if provider not in result['availableProviders']:
    result.update(status='unavailable');save();raise SystemExit(2)
if ort.__version__!=m['runtime']['version']:raise ValueError('Unqualified runtime version')
provider_options={
    'coreml':{'ModelFormat':'MLProgram','MLComputeUnits':'CPUAndGPU','RequireStaticInputShapes':'1','AllowLowPrecisionAccumulationOnGPU':'0','ProfileComputePlan':'1','ModelCacheDirectory':str((a.cache/'coreml-compiled').resolve())},
    'directml':{},'cuda':{'use_tf32':'0'}}[a.provider]
def run_stage(name,descriptor,inputs,check):
    entry={'name':name,'modelSha256':descriptor['sha256'],'providerOptions':provider_options};result['stages'].append(entry);save()
    session=None
    try:
        options=ort.SessionOptions();options.intra_op_num_threads=4;options.enable_profiling=True
        options.profile_file_prefix=str(a.report.parent/(name+'-profile'));options.log_severity_level=0
        if a.provider=='directml':options.enable_mem_pattern=False;options.execution_mode=ort.ExecutionMode.ORT_SEQUENTIAL
        before=time.monotonic();session=ort.InferenceSession(str(asset(descriptor)),options,providers=[(provider,provider_options),'CPUExecutionProvider'])
        entry['loadMs']=(time.monotonic()-before)*1000;entry['registeredProviders']=session.get_providers();entry['checks']=[];save()
        for label,feed in inputs:
            before=time.monotonic();output=session.run(None,feed)[0];elapsed=(time.monotonic()-before)*1000
            metrics=check(label,output);entry['checks'].append({'case':label,'elapsedMs':elapsed,**metrics});save()
        entry['numericallyPassed']=all(x['passed'] for x in entry['checks'])
    except Exception as error:entry.update(error=str(error),numericallyPassed=False)
    finally:
        if session is not None:
            profile=Path(session.end_profiling());events=json.loads(profile.read_text())
            entry['profile']=str(profile);entry['nodeProviderCounts']=dict(Counter(e.get('args',{}).get('provider') for e in events if e.get('args',{}).get('provider')))
            entry['requestedProviderExecuted']=entry['nodeProviderCounts'].get(provider,0)>0
            del session
        save()

noise={x['name']:floats(x).reshape(x['shape']) for x in m['noise']}
cases=m['canaries'][:a.cases];by_name={x['name']:x for x in cases};indices=np.fromfile(asset(m['sampleIndices']),dtype='<i4')
def synthesis_check(label,raw):
    case=by_name[label];finite=bool(np.isfinite(raw).all())
    rgb=np.clip(raw[0]*np.float32(127.5)+np.float32(128),0,255).astype(np.uint8).transpose(1,2,0)
    reference=np.asarray(Image.open(asset(case['reference'])).convert('RGB'))
    pixel=int(np.abs(rgb.astype(np.int16)-reference.astype(np.int16)).max());error=float(np.abs(raw.reshape(-1)[indices]-floats(case['samples'])).max())
    return {'passed':finite and pixel<=1 and error<=.002,'finite':finite,'maxRgb':pixel,'maxFloat':error if np.isfinite(error) else None}
feeds=[(case['name'],dict(w=floats(case['w']).reshape(1,18,512),**{k:v if case['noise']=='original' else np.zeros_like(v) if case['noise']=='zero' else -v for k,v in noise.items()})) for case in cases]
run_stage('synthesis',m['synthesis'],feeds,synthesis_check)
photo=m['photoCanary'];reference=floats(photo['w'])
def encoder_check(label,raw):
    error=float(np.abs(raw.reshape(-1)-reference).max());finite=bool(np.isfinite(raw).all())
    return {'passed':finite and error<=.0001,'finite':finite,'maxWError':error if np.isfinite(error) else None}
run_stage('actual-e4e',m['encoder'],[('aligned-tensor',{'image':floats(photo['tensor']).reshape(1,3,256,256)})],encoder_check)
result['status']='screening-passed' if all(x['numericallyPassed'] and x.get('requestedProviderExecuted') for x in result['stages']) else 'rejected';save()
print(json.dumps(result,indent=2))
raise SystemExit(0 if result['status']=='screening-passed' else 1)
