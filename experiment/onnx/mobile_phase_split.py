"""Split the 128.5 MiB phase output into two 64.25 MiB channel tiles.
Keeps the same FP32 convolution coefficients and each output's accumulation order.
The external WGSL stage reads the two tiles without concatenating them.
"""
from pathlib import Path
import copy,json,onnx,numpy as np
from onnx import helper as h,numpy_helper as nh
R=Path(__file__).resolve().parents[3]/'review-artifacts';I=R/'browser-onnx-mod-fusion';O=R/'browser-onnx-mobile-fusion';O.mkdir(exist_ok=True)
meta=json.loads((R/'browser-onnx-fusion/manifest.json').read_text());phase=meta['phase'];m=onnx.load(I/'prefix-segment.onnx');target=next(n for n in m.graph.node if phase in n.output)
assert target.op_type=='Conv' and len(target.input)==2
assert not any(phase in n.input for n in m.graph.node)
nodes=[]
for n in m.graph.node:
 if n is not target and n.name!=target.name:nodes.append(n);continue
 for tile in range(2):
  name=phase+f'__tile{tile}';params=[]
  for suffix,val in [('start',[tile*64]),('end',[(tile+1)*64]),('axes',[0]),('steps',[1])]:
   k=name+'_'+suffix;m.graph.initializer.append(nh.from_array(np.array(val,np.int64),k));params.append(k)
  weight=name+'_weights';nodes.append(h.make_node('Slice',[n.input[1],*params],[weight],name=weight));conv=copy.deepcopy(n);conv.name=name;conv.input[1]=weight;conv.output[0]=name;nodes.append(conv)
del m.graph.node[:];m.graph.node.extend(nodes)
outputs=[copy.deepcopy(v) for v in m.graph.output if v.name!=phase]
for tile in range(2):outputs.append(h.make_tensor_value_info(phase+f'__tile{tile}',onnx.TensorProto.FLOAT,[1,64,513,513]))
del m.graph.output[:];m.graph.output.extend(outputs);del m.graph.value_info[:];m=onnx.shape_inference.infer_shapes(m);onnx.checker.check_model(m);onnx.save(m,O/'prefix-segment.onnx')
(O/'suffix-segment.onnx').write_bytes((I/'suffix-segment.onnx').read_bytes());split=json.loads((I/'split-segment.json').read_text());del split['prefixOutputs'][phase]
for tile in range(2):split['prefixOutputs'][phase+f'__tile{tile}']=[1,64,513,513]
(O/'split-segment.json').write_text(json.dumps(split,indent=2));print('Two 67371264-byte phase tiles; maximum exposed binding 134217728 bytes')
