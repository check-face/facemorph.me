from pathlib import Path
import numpy as np,onnx,onnxruntime as ort,json
from onnx import helper,TensorProto
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'review-artifacts/browser-onnx-block'
m=onnx.load(OUT/'block-b1.onnx');names=['/layer/affine/Gemm_output_0','/layer/Mul_3_output_0','/layer/ConvTranspose_output_0','/layer/Conv_output_0','/layer/Mul_4_output_0','y','/layer/Pad_1_output_0','/layer/Slice_3_output_0','/layer/Reshape_5_output_0']
del m.graph.output[:]
for name in names:m.graph.output.append(helper.make_tensor_value_info(name,TensorProto.FLOAT,None))
o=ort.SessionOptions();o.intra_op_num_threads=1;s=ort.InferenceSession(m.SerializeToString(),o,providers=['CPUExecutionProvider'])
x=np.fromfile(OUT/'x.f32',np.float32).reshape(4,256,128,128)[:1];w=np.fromfile(OUT/'w.f32',np.float32).reshape(4,512)[:1];noise=np.fromfile(OUT/'noise.f32',np.float32).reshape(256,256)
rows=[]
for i,(name,array) in enumerate(zip(names,s.run(names,dict(x=x,w=w,noise=noise)))):
 file=f'diagnostic-{i}.f32';array.tofile(OUT/file);rows.append(dict(name=name,file=file,shape=list(array.shape)));print(i,name,list(array.shape),flush=True)
(OUT/'diagnostics.json').write_text(json.dumps(rows,indent=2))
