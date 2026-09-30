"""Prove static identity Pad/Slice operations, then fold zero padding into Conv.
Never changes learned weights or arithmetic precision. ONNX shape-based predicates
are explicit; retained outputs are checked against the original in the browser.
"""
from pathlib import Path
import json,hashlib,sys
import onnx,numpy as np
from onnx import helper,numpy_helper
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'review-artifacts/browser-onnx-profile'
def optimize(source,target):
 m=onnx.shape_inference.infer_shapes(onnx.load(source));initial={v.name:numpy_helper.to_array(v) for v in m.graph.initializer};shapes={v.name:[d.dim_value for d in v.type.tensor_type.shape.dim] for v in list(m.graph.input)+list(m.graph.value_info)+list(m.graph.output)};removed=[];mapping={};keep=[]
 def actual(n):
  while n in mapping:n=mapping[n]
  return n
 for n in m.graph.node:
  for i,k in enumerate(n.input):n.input[i]=actual(k)
  shape=shapes.get(n.input[0],[]) if n.input else [];identity=False
  if n.op_type=='Pad' and n.input[1] in initial and np.all(initial[n.input[1]]==0):identity=True
  if n.op_type=='Slice' and len(n.input)>=3 and all(k in initial for k in n.input[1:] if k) and shape and all(shape):
   start=initial[n.input[1]].ravel();end=initial[n.input[2]].ravel();axes=initial[n.input[3]].ravel() if len(n.input)>3 and n.input[3] else np.arange(len(start));steps=initial[n.input[4]].ravel() if len(n.input)>4 and n.input[4] else np.ones(len(start),dtype=np.int64)
   identity=all(slice(int(a),int(b),int(st)).indices(shape[int(ax)])==(0,shape[int(ax)],1) for a,b,ax,st in zip(start,end,axes,steps))
  if identity:
   mapping[n.output[0]]=n.input[0];removed.append({'name':n.name,'op':n.op_type,'input_shape':shape});shapes[n.output[0]]=shape
  else:keep.append(n)
 for n in keep:
  for i,k in enumerate(n.input):n.input[i]=actual(k)
 # Fold explicit spatial constant-zero Pad into its sole Conv consumer.
 uses={}
 for n in keep:
  for k in n.input:uses.setdefault(k,[]).append(n)
 folded=[];filtered=[]
 for n in keep:
  targets=uses.get(n.output[0],[])
  if n.op_type=='Pad' and len(targets)==1 and targets[0].op_type=='Conv':
   pads=initial.get(n.input[1]);value=initial.get(n.input[2],np.array(0)) if len(n.input)>2 and n.input[2] else np.array(0);attrs={a.name:helper.get_attribute_value(a) for a in n.attribute}
   if pads is not None and len(pads)==8 and all(pads[[0,1,4,5]]==0) and np.all(value==0) and attrs.get('mode',b'constant')==b'constant':
    conv=targets[0];ca={a.name:helper.get_attribute_value(a) for a in conv.attribute};existing=ca.get('pads',[0,0,0,0]);new=(np.array(existing)+pads[[2,3,6,7]]).tolist();conv.input[0]=n.input[0];ret=[a for a in conv.attribute if a.name not in ['pads','auto_pad']];del conv.attribute[:];conv.attribute.extend(ret);conv.attribute.append(helper.make_attribute('pads',new));folded.append({'pad':n.name,'conv':conv.name,'pads':new});continue
  filtered.append(n)
 for out in m.graph.output:
  if out.name in mapping:filtered.append(helper.make_node('Identity',[actual(out.name)],[out.name]))
 del m.graph.node[:];m.graph.node.extend(filtered);onnx.checker.check_model(m);onnx.save(m,target)
 return {'source':str(source),'output':str(target),'sha256':hashlib.sha256(Path(target).read_bytes()).hexdigest(),'remaining_nodes':len(filtered),'removed_identity_ops':removed,'folded_pads':folded,'weights_changed':False,'precision':'float32'}
if __name__=='__main__':
 OUT.mkdir(exist_ok=True);records=[]
 records.append(optimize(ROOT/'review-artifacts/browser-onnx-optimization/synthesis-simplified.onnx',OUT/'synthesis-spatial.onnx'))
 for b in [1,2,4]:records.append(optimize(ROOT/f'review-artifacts/browser-onnx-block/block-b{b}.onnx',ROOT/f'review-artifacts/browser-onnx-block/block-spatial-b{b}.onnx'))
 (OUT/'spatial-rewrite.json').write_text(json.dumps(records,indent=2)+'\n')
 for r in records:print(Path(r['output']).name,r['remaining_nodes'],'identity ops',len(r['removed_identity_ops']),'folded pads',len(r['folded_pads']))
