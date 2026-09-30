"""Factor fixed 4x4 depthwise FIR into vertical/horizontal FP32 passes."""
from pathlib import Path
import json,onnx,numpy as np
from onnx import helper as h,numpy_helper as nh
R=Path(__file__).resolve().parents[3]/'review-artifacts';O=R/'browser-onnx-separable';O.mkdir(exist_ok=True)
for graph in ['spatial','polyphase']:
 m=onnx.load(R/f'browser-onnx-energy/synthesis-{graph}.onnx');const={x.name:nh.to_array(x) for x in m.graph.initializer};nodes=[];changed=[]
 for n in m.graph.node:
  attrs={a.name:h.get_attribute_value(a) for a in n.attribute};w=const.get(n.input[1]) if n.op_type=='Conv' else None
  if w is None or w.ndim!=4 or w.shape[1:]!=(1,4,4) or attrs.get('group',1)!=w.shape[0]:nodes.append(n);continue
  assert len(n.input)==2 and attrs.get('strides',[1,1])==[1,1] and attrs.get('dilations',[1,1])==[1,1]
  vertical=np.array([1,3,3,1],np.float32).reshape(1,1,4,1).repeat(w.shape[0],0);horizontal=w[:,:,:1,:].copy();assert np.array_equal(vertical*horizontal,w)
  v=n.name+'__vertical';q=n.name+'__horizontal';m.graph.initializer.extend([nh.from_array(vertical,v+'_w'),nh.from_array(horizontal,q+'_w')]);t,l,b,r=attrs.get('pads',[0]*4)
  nodes.extend([h.make_node('Conv',[n.input[0],v+'_w'],[v],name=v,group=w.shape[0],kernel_shape=[4,1],pads=[t,0,b,0]),h.make_node('Conv',[v,q+'_w'],list(n.output),name=q,group=w.shape[0],kernel_shape=[1,4],pads=[0,l,0,r])]);changed.append(n.name)
 del m.graph.node[:];m.graph.node.extend(nodes);used={x for n in nodes for x in n.input};initial=[x for x in m.graph.initializer if x.name in used];del m.graph.initializer[:];m.graph.initializer.extend(initial);del m.graph.value_info[:];onnx.checker.check_model(m);onnx.save(m,O/f'synthesis-{graph}.onnx');(O/f'{graph}.json').write_text(json.dumps({'changed':changed,'arithmetic':'separable FP32; changed accumulation order'},indent=2));print(graph,len(changed))
