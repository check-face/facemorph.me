"""Replace stride-2 3x3 ConvTranspose + filter with FP32 polyphase Conv.
Four 2x2 phase filters + DepthToSpace(CRD) use the existing optimized Conv kernel.
The extra bottom/right phase row is absorbed by the following filter's padding.
"""
from pathlib import Path
import json,hashlib
import numpy as np,onnx,torch
from onnx import helper,numpy_helper
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'review-artifacts/browser-onnx-profile'
def packed(w):
 ci,co,_,_=w.shape;p=np.zeros((co*4,ci,2,2),dtype=np.float32)
 for y in range(2):
  for x in range(2):
   for dy in range(2):
    for dx in range(2):
     ky=2*(1-dy)+y;kx=2*(1-dx)+x
     if ky<3 and kx<3:p[y*2+x::4,:,dy,dx]=w[:,:,ky,kx].T
 return p
# Independent PyTorch oracle: test phase ordering, boundaries and batch geometry.
for b,h,ci,co in [(1,3,2,3),(2,7,3,5),(4,5,5,2)]:
 rng=np.random.RandomState(1700+h);x=torch.from_numpy(rng.randn(b,ci,h,h).astype('float32'));w=rng.randn(ci,co,3,3).astype('float32');f=torch.from_numpy(rng.randn(co,1,4,4).astype('float32'))
 ref=torch.nn.functional.conv2d(torch.nn.functional.conv_transpose2d(x,torch.from_numpy(w),stride=2),f,padding=1,groups=co)
 phases=torch.nn.functional.conv2d(x,torch.from_numpy(packed(w)),padding=1)
 up=torch.nn.functional.pixel_shuffle(phases,2);candidate=torch.nn.functional.conv2d(torch.nn.functional.pad(up,(1,0,1,0)),f,groups=co)
 torch.testing.assert_close(candidate,ref,rtol=1e-5,atol=2e-5)
print('Independent PyTorch phase/boundary tests passed')
def transform(source,target):
 m=onnx.load(source);constants={v.name:numpy_helper.to_array(v) for v in m.graph.initializer};users={}
 for n in m.graph.node:
  for k in n.input:users.setdefault(k,[]).append(n)
 replace={};remove=set();records=[]
 for n in m.graph.node:
  if n.op_type!='ConvTranspose':continue
  a={a.name:helper.get_attribute_value(a) for a in n.attribute};assert a['strides']==[2,2] and a['kernel_shape']==[3,3] and a.get('group',1)==1 and a.get('pads',[0]*4)==[0]*4
  w=constants[n.input[1]];assert w.dtype==np.float32
  chain=[];cur=n
  while True:
   u=users[cur.output[0]];assert len(u)==1;cur=u[0]
   if cur.op_type=='Reshape':chain.append(cur);continue
   assert cur.op_type=='Conv';break
  attrs={a.name:helper.get_attribute_value(a) for a in cur.attribute};pads=attrs.get('pads',[0]*4);assert pads==[1]*4
  name=n.name+'__polyphase';weight=name+'_weight';convout=name+'_conv';upout=name+'_up';m.graph.initializer.append(numpy_helper.from_array(packed(w),weight))
  replace[n.name]=[helper.make_node('Conv',[n.input[0],weight],[convout],name=name,strides=[1,1],pads=[1,1,1,1],kernel_shape=[2,2]),helper.make_node('DepthToSpace',[convout],[upout],name=name+'_shuffle',blocksize=2,mode='CRD')]
  remove.update(x.name for x in chain);cur.input[0]=upout
  keep=[x for x in cur.attribute if x.name not in ['pads','auto_pad']];del cur.attribute[:];cur.attribute.extend(keep);cur.attribute.append(helper.make_attribute('pads',[1,1,0,0]))
  records.append({'original':n.name,'following_filter':cur.name,'original_weight_shape':list(w.shape),'new_weight_shape':list(packed(w).shape)})
 nodes=[]
 for n in m.graph.node:
  if n.name in remove:continue
  nodes.extend(replace.get(n.name,[n]))
 del m.graph.node[:];m.graph.node.extend(nodes)
 # Stale internal shapes from the previous graph no longer describe phase buffers.
 del m.graph.value_info[:]
 onnx.checker.check_model(m);onnx.save(m,target)
 return {'source':str(source),'target':str(target),'sha256':hashlib.sha256(Path(target).read_bytes()).hexdigest(),'rewrites':records,'dtype':'float32','arithmetic_note':'Original learned coefficients rearranged with explicit zero coefficients; summation order can differ.'}
if __name__=='__main__':
 r=[transform(OUT/'synthesis-spatial.onnx',OUT/'synthesis-polyphase.onnx')]
 for b in [1,2,4]:r.append(transform(ROOT/f'review-artifacts/browser-onnx-block/block-spatial-b{b}.onnx',ROOT/f'review-artifacts/browser-onnx-block/block-polyphase-b{b}.onnx'))
 (OUT/'polyphase.json').write_text(json.dumps(r,indent=2)+'\n')
