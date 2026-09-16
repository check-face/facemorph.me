"""Independent original PyTorch W+ controls versus sequential unchanged ONNX shards.

Run through the shared local-mac lease. Native ORT qualification does not admit
a browser or phone; those must separately pass the same vectors and heap gates.
"""
from pathlib import Path
import argparse,gc,hashlib,json,sys,time
import numpy as np
from PIL import Image
import onnxruntime as ort
import torch
C=Path(__file__).resolve().parent;R=C.parents[1]
p=argparse.ArgumentParser();p.add_argument('--assets',type=Path,default=C/'assets');a=p.parse_args()
manifest=json.loads((a.assets/'manifest.json').read_text());out=C/'qualification';out.mkdir(exist_ok=True)
sys.path.insert(0,str(R/'experiment/hf'))
from e4e_cpu import Encoder
torch.set_num_threads(2);torch.use_deterministic_algorithms(True)
encoder=Encoder();torch.set_num_threads(2)
fixture_manifest=json.loads((C.parent/'fixtures/manifest.json').read_text())
inputs={c['id']:c for c in fixture_manifest['cases']}
cases=[];states=[];reference=[]
for identity in ['seed-0-aligned','seed-0-unaligned','seed-1-aligned','seed-1-unaligned','no-face-aligned']:
 f=inputs[identity];photo=Image.open(C.parent/'fixtures'/f['input'])
 start=time.perf_counter();codes,prepared,did_align=encoder.encode(photo,f['tryAlign']);expected=codes.numpy().copy()
 prepared_bytes=np.asarray(prepared,dtype=np.uint8).tobytes()
 assert hashlib.sha256(prepared_bytes).hexdigest()==f['preparedSha256'],identity+' original preprocessing changed'
 tensor=np.fromfile(C.parent/'fixtures'/f['tensor'],dtype='<f4').reshape(1,3,256,256)
 assert np.isfinite(tensor).all() and expected.shape==(1,18,512) and np.isfinite(expected).all()
 fixed_error=None
 if identity in ('seed-0-aligned','seed-1-aligned'):
  fixed=np.load(C.parent/'fixture-sources'/f'{identity[:6]}-encoded-w-plus.npy',allow_pickle=False)
  fixed_error=float(np.max(np.abs(expected[0]-fixed)));assert fixed_error<=0.0001,(identity,fixed_error)
 expected.astype('<f4').tofile(out/(identity+'.w.f32'));tensor.tofile(out/(identity+'.input.f32'))
 cases.append({'id':identity,'didAlign':did_align,'inputFile':identity+'.input.f32','referenceFile':identity+'.w.f32','inputSha256':hashlib.sha256(tensor.tobytes()).hexdigest(),'referenceSha256':hashlib.sha256(expected.tobytes()).hexdigest(),'fixedHistoricWMaxError':fixed_error,'originalTorchMs':1000*(time.perf_counter()-start)})
 states.append({'image':tensor});reference.append(expected)
 print('Independent original control',identity,'fixed error',fixed_error,flush=True)
del encoder,codes,prepared,photo,expected;gc.collect()
timings=[]
for step in manifest['steps']:
 path=a.assets/step['file']
 with path.open('rb')as stream:assert hashlib.file_digest(stream,'sha256').hexdigest()==step['sha256']
 options=ort.SessionOptions();options.intra_op_num_threads=1;options.inter_op_num_threads=1;options.enable_cpu_mem_arena=False;options.enable_mem_pattern=False;options.add_session_config_entry('session.disable_prepacking','1')
 start=time.perf_counter();session=ort.InferenceSession(str(path),sess_options=options,providers=['CPUExecutionProvider']);loaded=time.perf_counter()
 for state in states:
  feeds={v['name']:state[v['name']]for v in step['inputs']}
  for v in step['inputs']:
   assert list(feeds[v['name']].shape)==v['shape'],(step['id'],v['name'],feeds[v['name']].shape,v['shape'])
  values=session.run([v['name']for v in step['outputs']],feeds)
  for spec,value in zip(step['outputs'],values):
   assert list(value.shape)==spec['shape'],(step['id'],spec,value.shape)
   if value.dtype.kind=='f':assert np.isfinite(value).all()
   state[spec['name']]=value
  for name in step['releaseAfter']:state.pop(name,None)
 timings.append({'id':step['id'],'loadMs':1000*(loaded-start),'fiveCasesRunMs':1000*(time.perf_counter()-loaded)})
 del session,values,feeds;gc.collect()
 print('Verified shard execution',step['id']+1,'/',len(manifest['steps']),flush=True)
for case,state,expected in zip(cases,states,reference):
 actual=state['w'];assert actual.shape==(1,18,512) and actual.dtype==np.float32 and np.isfinite(actual).all()
 error=np.abs(actual-expected);case.update(maxWError=float(error.max()),meanWError=float(error.mean()),passed=bool(error.max()<=0.0001))
 actual.tofile(out/(case['id']+'.actual-w.f32'))
report={'schemaVersion':1,'environment':'Native CPU ONNX Runtime; not browser/device qualification','sourceEncoderSha256':manifest['sourceEncoderSha256'],'manifestSha256':hashlib.sha256((a.assets/'manifest.json').read_bytes()).hexdigest(),'ort':ort.__version__,'torch':torch.__version__,'threshold':0.0001,'cases':cases,'shards':timings,'passed':all(c['passed']for c in cases),'browserQualified':False,'physicalPhoneQualified':False}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k!='shards'},indent=2))
if not report['passed']:raise SystemExit(1)
