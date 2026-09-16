"""Split the unchanged FP32 e4e ONNX DAG into small sequential sessions.

No operators, weights, latent averages or reduction expressions are rewritten.
Every intermediate that crosses a partition is an explicit input/output. This
exports a candidate; actual WASM heap and W+ correctness still need measurement.
"""
from pathlib import Path
import argparse,hashlib,json,gc
import onnx
import onnxruntime as ort
import numpy as np
from onnx import helper
C=Path(__file__).resolve().parent;R=C.parents[1]
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=C/'external/encoder.onnx');p.add_argument('--out',type=Path,default=C/'assets');p.add_argument('--max-initializer-mib',type=int,default=16);p.add_argument('--preprocessing-sha256',default=None);a=p.parse_args()
if a.preprocessing_sha256 is not None and (len(a.preprocessing_sha256)!=64 or any(c not in '0123456789abcdef'for c in a.preprocessing_sha256)):raise ValueError('Invalid preprocessing identity')
def sha(path):
 with path.open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
a.out.mkdir(parents=True,exist_ok=True);source_sha=sha(a.source)
if source_sha!='d525a985a43e4d49ef4590a8b8cc6f487992065bee00014fe8c6f8ab4ac291b1':raise ValueError('Unexpected full encoder source')
inferred=a.out/'shape-inferred.work.onnx'
print('Inferring static graph boundary types',flush=True)
onnx.shape_inference.infer_shapes_path(str(a.source),str(inferred),check_type=True,strict_mode=True,data_prop=True)
model=onnx.load(inferred);graph=model.graph
initializers={t.name:t for t in graph.initializer};types={v.name:v for v in list(graph.value_info)+list(graph.input)+list(graph.output)}
graph_inputs={v.name for v in graph.input};graph_outputs={v.name for v in graph.output}
nodes=list(graph.node);producers={name:i for i,n in enumerate(nodes)for name in n.output if name};consumers={}
for i,n in enumerate(nodes):
 for name in n.input:
  if name:consumers.setdefault(name,[]).append(i)
for name in graph_outputs:consumers.setdefault(name,[]).append(len(nodes))
groups=[];group=[];owned=set();size=0;cap=a.max_initializer_mib*1024*1024
for i,n in enumerate(nodes):
 new={name for name in n.input if name in initializers and name not in owned};extra=sum(initializers[name].ByteSize()for name in new)
 if group and size+extra>cap:groups.append(group);group=[];owned=set();size=0;new={name for name in n.input if name in initializers};extra=sum(initializers[name].ByteSize()for name in new)
 group.append(i);owned.update(new);size+=extra
if group:groups.append(group)
last_use={name:0 for name in graph_inputs};steps=[]
observed={}
def spec(name):
 if name not in types:raise ValueError('Missing inferred boundary type '+name)
 v=types[name];t=v.type.tensor_type
 if not t.elem_type:raise ValueError('Missing element type '+name)
 shape=[]
 for d in t.shape.dim:
  if not d.HasField('dim_value'):
   if name not in observed:raise ValueError('Boundary lacks inferred or executed shape: '+name)
   shape=list(observed[name].shape);break
  shape.append(d.dim_value)
 return{'name':name,'dtype':onnx.TensorProto.DataType.Name(t.elem_type),'shape':shape}
for v in graph.input:
 s=spec(v.name)
 if s['dtype']!='FLOAT':raise ValueError('Unexpected source input dtype')
 observed[v.name]=np.zeros(s['shape'],dtype=np.float32)
for step,indexes in enumerate(groups):
 first,last=indexes[0],indexes[-1];selected=[nodes[i]for i in indexes];internal={name for n in selected for name in n.output if name};weights={name for n in selected for name in n.input if name in initializers}
 inputs=sorted({name for n in selected for name in n.input if name and name not in internal and name not in weights})
 outputs=sorted({name for name in internal if any(j>last for j in consumers.get(name,[]))})
 if not outputs:raise ValueError('Dead partition')
 for name in inputs:last_use[name]=step
 subgraph=helper.make_graph(selected,f'e4e-stream-{step:03d}',[types[n]for n in inputs],[types[n]for n in outputs],[initializers[n]for n in sorted(weights)])
 submodel=helper.make_model(subgraph,opset_imports=model.opset_import,producer_name='checkface-e4e-graph-stream-v1');submodel.ir_version=model.ir_version
 onnx.checker.check_model(submodel,full_check=True)
 # Source shape-inference leaves symbolic sizes after the exported Expand /
 # Transpose style construction. Resolve them by executing each unchanged
 # shard once, preserving INT64 shape values; independently recheck five real
 # photo inputs in verify.py. This profile is NOT W+ qualification.
 options=ort.SessionOptions();options.intra_op_num_threads=1;options.inter_op_num_threads=1;options.enable_cpu_mem_arena=False;options.enable_mem_pattern=False;options.add_session_config_entry('session.disable_prepacking','1')
 session=ort.InferenceSession(submodel.SerializeToString(),sess_options=options,providers=['CPUExecutionProvider'])
 values=session.run(outputs,{name:observed[name]for name in inputs})
 for name,value in zip(outputs,values):
  if value.dtype.kind=='f' and not np.isfinite(value).all():raise ValueError('Nonfinite shape-profile output')
  observed[name]=value
  if name in types:
   tensor=types[name].type.tensor_type
   for i,d in enumerate(tensor.shape.dim):
    if d.HasField('dim_value') and d.dim_value!=value.shape[i]:raise ValueError('Inferred shape disagrees with execution')
   del tensor.shape.dim[:]
   for dimension in value.shape:tensor.shape.dim.add().dim_value=dimension
 del session,values
 for value in submodel.graph.input:
  value.CopyFrom(types[value.name])
 for value in submodel.graph.output:
  value.CopyFrom(types[value.name])
 onnx.checker.check_model(submodel,full_check=True)
 name=f'part-{step:03d}.onnx';path=a.out/name;onnx.save(submodel,path)
 steps.append({'id':step,'file':name,'sha256':sha(path),'size':path.stat().st_size,'sourceNodeFirst':first,'sourceNodeLast':last,'sourceNodeCount':len(indexes),'initializerBytes':sum(initializers[n].ByteSize()for n in weights),'inputs':[spec(n)for n in inputs],'outputs':[spec(n)for n in outputs]})
 for key in list(observed):
  if key not in graph_outputs and not any(j>last for j in consumers.get(key,[])):del observed[key]
 print(step,name,path.stat().st_size,'nodes',len(indexes),flush=True);del submodel,subgraph;gc.collect()
for name in graph_outputs:last_use[name]=len(steps)
live={v.name:spec(v.name)for v in graph.input};maximum=0
def bytes_of(t):
 import math
 widths={'FLOAT':4,'DOUBLE':8,'FLOAT16':2,'INT64':8,'INT32':4,'BOOL':1,'UINT8':1,'INT8':1}
 if t['dtype']not in widths:raise ValueError('Unaccounted type '+t['dtype'])
 return math.prod(t['shape'])*widths[t['dtype']]
for step in steps:
 for v in step['outputs']:live[v['name']]=v
 step['liveBoundaryBytesBeforeRelease']=sum(bytes_of(v)for v in live.values());maximum=max(maximum,step['liveBoundaryBytesBeforeRelease'])
 step['releaseAfter']=[name for name in live if last_use.get(name,-1)<=step['id'] and name not in graph_outputs]
 for name in step['releaseAfter']:del live[name]
 step['liveBoundaryBytesAfterRelease']=sum(bytes_of(v)for v in live.values())
manifest={'schemaVersion':1,'kind':'e4e-onnx-sequential-shards-v1','sourceSha256':source_sha,'sourceEncoderSha256':source_sha,'preprocessingSha256':a.preprocessing_sha256,'boundaryShapeEvidence':'Native ORT execution with fixed [1,3,256,256] zero input; independent real photo controls required','qualifiedReferenceEvidence':None,'phoneAdmitted':False,'sourceBytes':a.source.stat().st_size,'input':[spec(v.name)for v in graph.input],'output':[spec(v.name)for v in graph.output],'steps':steps,'maxShardBytes':max(s['size']for s in steps),'totalShardBytes':sum(s['size']for s in steps),'maxLiveBoundaryBytes':maximum,'sourceNodeCount':len(nodes),'exportedNodeCount':sum(s['sourceNodeCount']for s in steps),'precision':'unchanged FP32 ONNX','latentAverage':'Preserved in original final graph nodes; do not add again','wasmMemoryStatus':'Unmeasured; one live session required, release does not shrink heap capacity','qualification':'Not qualified; requires independent W+ <=0.0001 and actual browser/device memory/workflow checks'}
assert manifest['sourceNodeCount']==manifest['exportedNodeCount']
(a.out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({k:v for k,v in manifest.items()if k!='steps'},indent=2))
# This is a disposable intermediate produced by this script, never a source model.
inferred.unlink()
