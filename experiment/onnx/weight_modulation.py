"""Batch-one modulation on small weight tensors instead of large activations."""
from pathlib import Path
import json,onnx,numpy as np
from onnx import helper as h,numpy_helper as nh
R=Path(__file__).resolve().parents[3]/'review-artifacts';O=R/'browser-onnx-weight-modulation';O.mkdir(exist_ok=True)
for graph in ['polyphase','spatial']:
 for mode in ['high','rgb']:
  m=onnx.shape_inference.infer_shapes(onnx.load(R/f'browser-onnx-energy/synthesis-{graph}.onnx'));prod={o:n for n in m.graph.node for o in n.output};shape={v.name:[d.dim_value for d in v.type.tensor_type.shape.dim] for v in [*m.graph.input,*m.graph.value_info,*m.graph.output]};const={x.name:nh.to_array(x) for x in m.graph.initializer};nodes=[];records=[]
  for n in m.graph.node:
   w=const.get(n.input[1]) if n.op_type=='Conv' else None;p=prod.get(n.input[0])
   if w is not None and w.ndim==4 and w.shape[1]>1 and p is not None and p.op_type=='Mul':
    style=next((x for x in p.input if shape.get(x)==[1,w.shape[1],1,1]),None);x=next((x for x in p.input if x!=style),None);dims=shape.get(x,[])
    if style and len(dims)==4 and dims[0]==1 and dims[2]>=128 and (mode=='high' or '/torgb/' in n.name):
     name=n.name+'__styled_weights';nodes.append(h.make_node('Mul',[n.input[1],style],[name],name=name));records.append({'conv':n.name,'inputShape':dims,'weightShape':list(w.shape)});n.input[0]=x;n.input[1]=name
   nodes.append(n)
  need={o.name for o in m.graph.output};keep=[]
  for n in reversed(nodes):
   if need.intersection(n.output):keep.append(n);need.update(n.input)
  del m.graph.node[:];m.graph.node.extend(reversed(keep));del m.graph.value_info[:];onnx.checker.check_model(m);onnx.save(m,O/f'{graph}-{mode}.onnx');(O/f'{graph}-{mode}.json').write_text(json.dumps(records,indent=2));print(graph,mode,len(records))
