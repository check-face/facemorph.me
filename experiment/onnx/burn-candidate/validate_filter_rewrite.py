"""Validate the exact common-filter premise and channel-as-batch geometry."""
from pathlib import Path
import onnx,numpy as np,torch,json
from onnx import numpy_helper,helper
ROOT=Path(__file__).resolve().parents[4];rows=[]
for relative in ['browser-onnx-block/block-b1.onnx','browser-onnx-block/block-b2.onnx','browser-onnx-block/block-b4.onnx','browser-onnx-profile/synthesis-polyphase.onnx']:
 m=onnx.load(ROOT/'review-artifacts'/relative);v={i.name:numpy_helper.to_array(i) for i in m.graph.initializer};count=0
 for n in m.graph.node:
  a={x.name:helper.get_attribute_value(x) for x in n.attribute}
  if n.op_type=='Conv' and a.get('group',1)>1:
   w=v[n.input[1]];assert w.shape[0]==a['group'] and w.shape[1:]==(1,4,4) and np.array_equal(w,np.broadcast_to(w[:1],w.shape));count+=1
 rows.append({'model':relative,'identical_channel_filters':count})
for b in [1,2,4]:
 torch.manual_seed(1234);x=torch.randn(b,7,19,19);w=torch.randn(1,1,4,4);p=torch.nn.functional.pad(x,(2,1,2,1))
 ref=torch.nn.functional.conv2d(p,w.repeat(7,1,1,1),groups=7)
 candidate=torch.nn.functional.conv2d(p.reshape(b*7,1,22,22),w).reshape(b,7,19,19)
 torch.testing.assert_close(ref,candidate,rtol=1e-5,atol=1e-5)
(ROOT/'review-artifacts/browser-onnx-block/filter-rewrite-validation.json').write_text(json.dumps({'models':rows,'batches':[1,2,4],'cpu_geometry_tests':'passed'},indent=2))
print('Original coefficients and batch geometry verified')
