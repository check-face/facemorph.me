"""Experimental contiguous FP16 graph; float32 reductions/demodulation and W+ affine."""
from pathlib import Path
import onnx,json,hashlib
from onnxruntime.transformers.float16 import convert_float_to_float16
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'review-artifacts/browser-onnx-optimization'
m=onnx.load(OUT/'synthesis-simplified.onnx')
# Keep the entire style/demodulation branch in float32, including its
# squares before ReduceSum (FP16 underflow there destroys normalization).
image_values=set();style_values={'w'};blocked=[]
for n in m.graph.node:
 is_image=n.op_type in ['Conv','ConvTranspose'] or any(v in image_values for v in n.input)
 is_style=any(v in style_values for v in n.input)
 if is_image: image_values.update(n.output)
 if is_style: style_values.update(n.output)
 if is_style and not is_image: blocked.append(n.name)
m=convert_float_to_float16(m,keep_io_types=True,op_block_list=[],node_block_list=blocked)
# Converter appends interface casts; restore topological order before validation.
pending=list(m.graph.node);ordered=[];known={x.name for x in m.graph.input}|{x.name for x in m.graph.initializer}|{''}
while pending:
 ready=[n for n in pending if set(n.input)<=known]
 if not ready: raise RuntimeError('Unresolved graph dependency')
 for n in ready: ordered.append(n);known.update(n.output);pending.remove(n)
del m.graph.node[:];m.graph.node.extend(ordered)
onnx.checker.check_model(m);p=OUT/'synthesis-half-safe.onnx';onnx.save(m,p)
(OUT/'half-safe.json').write_text(json.dumps({'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'method':'FP16 image path with complete float32 style/demodulation branch; float32 external interface. Constants subject to FP16 rounding/clamping.','status':'Experimental accuracy/performance tradeoff'},indent=2)+'\n')
