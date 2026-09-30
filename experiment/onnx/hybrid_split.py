"""Separate early batched synthesis from batch-one high-resolution synthesis."""
from pathlib import Path
import json,onnx
from onnx import helper
R=Path(__file__).resolve().parents[3]/'review-artifacts';O=R/'browser-onnx-hybrid';O.mkdir(exist_ok=True)
for res in [64,256]:
 for batch in [1,2,4]:
  m=onnx.shape_inference.infer_shapes(onnx.load(R/'browser-onnx-energy'/('synthesis-polyphase'+('' if batch==1 else f'-b{batch}')+'.onnx')));nodes=list(m.graph.node);boundary=f'/synthesis/b{res}/conv1/Mul_6_output_0';desc={boundary};suffix=[]
  for n in nodes:
   if desc.intersection(n.input):suffix.append(n);desc.update(n.output)
  suffixnames={n.name for n in suffix};prefix=[n for n in nodes if n.name not in suffixnames];produced={v for n in suffix for v in n.output};const={i.name for i in m.graph.initializer};bounds=sorted({v for n in suffix for v in n.input if v and v not in produced and v not in const});inputnames={v.name for v in m.graph.input};outs=[v for v in bounds if v not in inputnames];info={v.name:v for v in [*m.graph.value_info,*m.graph.input,*m.graph.output]}
  def write(ns,ins,outputs,path):
   need=set(outputs);kept=[]
   for n in reversed(ns):
    if need.intersection(n.output):kept.append(n);need.update(n.input)
   g=helper.make_graph(list(reversed(kept)),path.name,[info[k] for k in ins if k in need],[info[k] for k in outputs],[i for i in m.graph.initializer if i.name in need]);model=helper.make_model(g,opset_imports=m.opset_import);model.ir_version=m.ir_version;onnx.checker.check_model(model);onnx.save(model,path)
  write(prefix,inputnames,outs,O/f'prefix-{res}-b{batch}.onnx')
  if batch==1:write(suffix,bounds,['image'],O/f'suffix-{res}.onnx')
  shapes={k:[d.dim_value for d in info[k].type.tensor_type.shape.dim] for k in outs};assert all(all(d>0 for d in s) for s in shapes.values());(O/f'split-{res}-b{batch}.json').write_text(json.dumps({'prefixOutputs':shapes,'suffixInputs':bounds},indent=2));print(res,batch,len(outs),sum(__import__('math').prod(s)*4 for s in shapes.values()),flush=True)
