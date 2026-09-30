"""Experimental FP16 Conv/Gemm only; preserve float32 style/noise/demodulation ops."""
from pathlib import Path
import onnx,json,hashlib
from onnx import helper,TensorProto
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'review-artifacts/browser-onnx-optimization'
m=onnx.load(OUT/'synthesis-simplified.onnx');nodes=[];count=0
for n in m.graph.node:
 if n.op_type in ['Conv','ConvTranspose','Gemm']:
  count+=1
  for i,name in enumerate(n.input):
   if name:
    new=f'{name}__fp16_{count}_{i}';nodes.append(helper.make_node('Cast',[name],[new],to=TensorProto.FLOAT16));n.input[i]=new
  outputs=list(n.output)
  for i,name in enumerate(outputs):n.output[i]=name+'__fp16_output'
  nodes.append(n)
  for i,name in enumerate(outputs):nodes.append(helper.make_node('Cast',[n.output[i]],[name],to=TensorProto.FLOAT))
 else:nodes.append(n)
del m.graph.node[:];m.graph.node.extend(nodes);m=onnx.shape_inference.infer_shapes(m);onnx.checker.check_model(m);p=OUT/'synthesis-mixed.onnx';onnx.save(m,p)
(OUT/'mixed.json').write_text(json.dumps({'converted_ops':count,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'method':'FP16 only Conv, ConvTranspose, Gemm; all other arithmetic, noise, W+ interface and image output float32','status':'Experimental accuracy/performance tradeoff; not equivalent arithmetic'},indent=2)+'\n')
