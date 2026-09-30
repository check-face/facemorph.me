"""Replace dynamic 5D weight squaring/reduction with precomputed weight energy.
FP32 graph; changed operation order requires numerical qualification.
"""
from pathlib import Path
import json,hashlib
import onnx,numpy as np
from onnx import helper,numpy_helper
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'review-artifacts/browser-onnx-energy'
def transform(source,target):
 m=onnx.load(source);constants={i.name:numpy_helper.to_array(i) for i in m.graph.initializer};producer={k:n for n in m.graph.node for k in n.output};nodes=[];records=[]
 for n in m.graph.node:
  if n.op_type!='ReduceSum':nodes.append(n);continue
  square=producer[n.input[0]];assert square.op_type=='Mul' and square.input[0]==square.input[1]
  modulation=producer[square.input[0]];assert modulation.op_type=='Mul'
  const=next(k for k in modulation.input if k in constants);weight=constants[const];assert weight.ndim==5 and weight.shape[0]==1 and weight.dtype==np.float32
  style_name=next(k for k in modulation.input if k!=const);reshape=producer[style_name];assert reshape.op_type=='Reshape';style=reshape.input[0]
  attrs={a.name:helper.get_attribute_value(a) for a in n.attribute};axes=attrs.get('axes',constants.get(n.input[1]) if len(n.input)>1 else None);assert list(axes)==[2,3,4] and attrs.get('keepdims',1)==0
  energy=(weight[0].astype(np.float64)**2).sum(axis=(2,3)).T.astype(np.float32);name=n.name+'__energy';squared=name+'_style_squared';matrix=name+'_matrix';m.graph.initializer.append(numpy_helper.from_array(energy,matrix))
  nodes.extend([helper.make_node('Mul',[style,style],[squared],name=name+'_square'),helper.make_node('MatMul',[squared,matrix],list(n.output),name=name+'_matmul')]);records.append({'node':n.name,'original_weight_shape':list(weight.shape),'energy_shape':list(energy.shape)})
 needed={o.name for o in m.graph.output};kept=[]
 for n in reversed(nodes):
  if needed.intersection(n.output):kept.append(n);needed.update(n.input)
 kept.reverse();del m.graph.node[:];m.graph.node.extend(kept);initial=[i for i in m.graph.initializer if i.name in needed];del m.graph.initializer[:];m.graph.initializer.extend(initial);del m.graph.value_info[:];onnx.checker.check_model(m);onnx.save(m,target)
 return {'source':str(source),'target':str(target),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'rewrites':records,'nodes':len(kept),'precision':'Precompute energy in FP64, round coefficients to FP32; FP32 runtime; changed reduction order'}
if __name__=='__main__':
 OUT.mkdir(exist_ok=True);rows=[]
 for graph in ['spatial','polyphase']:
  r=transform(ROOT/f'review-artifacts/browser-onnx-profile/synthesis-{graph}.onnx',OUT/f'synthesis-{graph}.onnx');rows.append(r);print(graph,len(r['rewrites']),r['nodes'],r['bytes'],flush=True)
 (OUT/'manifest.json').write_text(json.dumps(rows,indent=2))
