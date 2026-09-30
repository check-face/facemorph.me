"""Prefix with only proven unchanged dependencies: styles 0..8 and noise 0..8."""
from pathlib import Path
import json,onnx
from onnx import helper
R=Path(__file__).resolve().parents[3]/'review-artifacts';O=R/'browser-onnx-cache';O.mkdir(exist_ok=True)
m=onnx.shape_inference.infer_shapes(onnx.load(R/'browser-onnx-energy/synthesis-polyphase.onnx'));info={v.name:v for v in [*m.graph.input,*m.graph.output,*m.graph.value_info]};boundary=['/synthesis/b64/conv1/Mul_6_output_0','/synthesis/b64/Conv_output_0'];inputs=[i.name for i in m.graph.input]
def cut(outputs,stops,path):
 need=set(outputs);keep=[]
 for n in reversed(m.graph.node):
  if need.intersection(n.output) and not set(n.output).intersection(stops):keep.append(n);need.update(n.input)
 root=[k for k in [*inputs,*stops] if k in need];g=helper.make_graph(list(reversed(keep)),path.name,[info[k] for k in dict.fromkeys(root)],[info[k] for k in outputs],[i for i in m.graph.initializer if i.name in need]);model=helper.make_model(g,opset_imports=m.opset_import);model.ir_version=m.ir_version;onnx.checker.check_model(model);onnx.save(model,path)
cut(boundary,[],O/'prefix.onnx');cut(['image'],boundary,O/'suffix.onnx');(O/'manifest.json').write_text(json.dumps({'outputs':{k:[d.dim_value for d in info[k].type.tensor_type.shape.dim] for k in boundary},'styleIndices':list(range(9)),'noiseIndices':list(range(9))},indent=2));print('Cache-prefix models exported')
