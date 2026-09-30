from pathlib import Path
import json
import numpy as np,onnx,onnxruntime as ort
from onnx import helper,numpy_helper,TensorProto
R=Path(__file__).resolve().parents[3]/'review-artifacts';O=R/'browser-onnx-fusion';O.mkdir(exist_ok=True)
m=onnx.load(R/'browser-onnx-energy/synthesis-polyphase.onnx');prefix='/synthesis/b1024/conv0/'
phase=prefix+'ConvTranspose__polyphase_conv';demod=prefix+'Reshape_9_output_0';final=prefix+'Mul_6_output_0';filtered=prefix+'Conv_output_0'
shape={phase:[1,128,513,513],demod:[1,32,1,1],filtered:[1,32,1024,1024],final:[1,32,1024,1024],'noise_15':[1,1,1024,1024]}
const={i.name:numpy_helper.to_array(i) for i in m.graph.initializer}
# Restrict backward walk to selected boundaries.
def cut(outputs,inputs,path):
 need=set(outputs);kept=[]
 for n in reversed(m.graph.node):
  if need.intersection(n.output) and not set(n.output)<=set(inputs):kept.append(n);need.update(n.input)
 kept.reverse();init=[i for i in m.graph.initializer if i.name in need];g=helper.make_graph(kept,'cut',[helper.make_tensor_value_info(k,TensorProto.FLOAT,shape[k]) for k in inputs],[helper.make_tensor_value_info(k,TensorProto.FLOAT,shape[k]) for k in outputs],init)
 model=helper.make_model(g,opset_imports=m.opset_import);model.ir_version=m.ir_version;onnx.checker.check_model(model);onnx.save(model,path)
cut([final],[phase,demod,'noise_15'],O/'segment.onnx');cut([filtered],[phase],O/'resample.onnx');cut([final],[filtered,demod,'noise_15'],O/'tail.onnx')
# Native reference model outputs the actual layer inputs.
del m.graph.output[:];m.graph.output.extend([helper.make_tensor_value_info(k,TensorProto.FLOAT,shape[k]) for k in [phase,demod]])
so=ort.SessionOptions();so.intra_op_num_threads=4;so.log_severity_level=3
s=ort.InferenceSession(m.SerializeToString(),so,providers=['CPUExecutionProvider']);meta=json.loads((R/'browser-onnx-phase1/manifest.json').read_text());feed={n['name']:np.fromfile(R/'browser-onnx-phase1'/n['file'],np.float32).reshape(n['shape']) for n in meta['noise']};feed['w']=np.fromfile(R/'browser-onnx-video/w.f32',np.float32)[:18*512].reshape(1,18,512)
a,d=s.run(None,feed);a.tofile(O/'phase.f32');d.tofile(O/'demod.f32');feed['noise_15'].tofile(O/'noise.f32')
filt=const[prefix+'Reshape_8_output_0'];assert np.all(filt==filt[:1]);filt[0].tofile(O/'filter.f32');const['onnx::Add_5111'].tofile(O/'bias.f32');strength=float(const['g.synthesis.b1024.conv0.noise_strength']);gain=float(const[prefix+'Constant_59_output_0'])
(O/'manifest.json').write_text(json.dumps({'phase':phase,'demod':demod,'filtered':filtered,'final':final,'strength':strength,'gain':gain,'shape':shape},indent=2));print('Fusion fixtures exported',flush=True)
