"""Cut full FP32 synthesis around one validated external resampling/tail stage."""
from pathlib import Path
import json,onnx,os
from onnx import helper
R=Path(__file__).resolve().parents[3]/'review-artifacts';O=R/os.environ.get('FUSION_OUT','browser-onnx-fusion');O.mkdir(exist_ok=True)
m=onnx.shape_inference.infer_shapes(onnx.load(R/os.environ.get('FUSION_MODEL','browser-onnx-energy/synthesis-polyphase.onnx')))
meta=json.loads((R/'browser-onnx-fusion/manifest.json').read_text());nodes=list(m.graph.node);start=next(i for i,n in enumerate(nodes) if n.op_type=='DepthToSpace' and n.input[0]==meta['phase']);finish=next(i for i,n in enumerate(nodes) if meta['final'] in n.output)
const={i.name for i in m.graph.initializer};info={v.name:v for v in [*m.graph.value_info,*m.graph.input,*m.graph.output]}
for mode,end in [('resample',next(i for i,n in enumerate(nodes) if meta['filtered'] in n.output)),('segment',finish)]:
 external=meta['filtered'] if mode=='resample' else meta['final']; descendants={external};suffix=[]
 for n in nodes[end+1:]:
  if descendants.intersection(n.input):suffix.append(n);descendants.update(n.output)
 excluded={n.name for n in nodes[start:end+1]}|{n.name for n in suffix};prefixnodes=[n for n in nodes if n.name not in excluded];produced={v for n in suffix for v in n.output};boundary=sorted({v for n in suffix for v in n.input if v and v not in const and v not in produced});external=meta['filtered'] if mode=='resample' else meta['final'];preoutputs=sorted((set(boundary)-{external})|{meta['phase']}|({meta['demod']} if mode=='segment' else set()))
 def write(ns,inputs,outputs,path):
  needed=set(outputs);keep=[]
  for n in reversed(ns):
   if needed.intersection(n.output):keep.append(n);needed.update(n.input)
  keep.reverse();initial=[i for i in m.graph.initializer if i.name in needed];g=helper.make_graph(keep,path.name,[info[k] for k in inputs if k in needed],[info[k] for k in outputs],initial);m2=helper.make_model(g,opset_imports=m.opset_import);m2.ir_version=m.ir_version;onnx.checker.check_model(m2);onnx.save(m2,path)
  return {k:[d.dim_value for d in info[k].type.tensor_type.shape.dim] for k in outputs}
 # Inputs consumed by prefix can be passed through only via caller; remove from prefix outputs.
 inputnames={v.name for v in m.graph.input};passthrough=sorted(set(preoutputs)&inputnames);preoutputs=[k for k in preoutputs if k not in inputnames]
 shapes=write(prefixnodes,list(inputnames),preoutputs,O/f'prefix-{mode}.onnx');write(suffix,boundary,['image'],O/f'suffix-{mode}.onnx')
 (O/f'split-{mode}.json').write_text(json.dumps({'prefixOutputs':shapes,'suffixInputs':boundary,'passthrough':passthrough,'external':external},indent=2));print(mode,shapes,boundary,flush=True)
