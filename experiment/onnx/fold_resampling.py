"""Fold static 4x4 FIR into stride-2 3x3 learned convolution phases.
Candidate only: algebraic identity changes FP32 arithmetic order. Browser output
checks and full-model timings are required before accepting it.
"""
from pathlib import Path
import json,hashlib,re
import numpy as np,onnx,torch
from onnx import helper,numpy_helper
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'review-artifacts/browser-onnx-folded'
def packed(w,f):
 ci,co,_,_=w.shape;p=np.zeros((co*4,ci,3,3),np.float64)
 for py in range(2):
  for px in range(2):
   for dy in range(3):
    for dx in range(3):
     for fy in range(4):
      ky=1-2*dy+py+fy
      if not 0<=ky<3:continue
      for fx in range(4):
       kx=1-2*dx+px+fx
       if 0<=kx<3:p[py*2+px::4,:,dy,dx]+=w[:,:,ky,kx].T.astype(np.float64)*f[:,0,fy,fx,None].astype(np.float64)
 return p.astype(np.float32)
def test():
 torch.set_num_threads(1)
 for b,h,ci,co in [(1,3,2,3),(2,7,3,5),(4,5,5,2)]:
  rng=np.random.RandomState(7500+h);x=torch.from_numpy(rng.randn(b,ci,h,h).astype(np.float32));w=rng.randn(ci,co,3,3).astype(np.float32);f=rng.randn(co,1,4,4).astype(np.float32)
  ref=torch.nn.functional.conv2d(torch.nn.functional.conv_transpose2d(x,torch.from_numpy(w),stride=2),torch.from_numpy(f),padding=1,groups=co)
  y=torch.nn.functional.pixel_shuffle(torch.nn.functional.conv2d(x,torch.from_numpy(packed(w,f)),padding=1),2)
  torch.testing.assert_close(y,ref,rtol=2e-5,atol=3e-5)
def transform(source,target,min_resolution=0):
 m=onnx.load(source);constants={i.name:numpy_helper.to_array(i) for i in m.graph.initializer};users={}
 for n in m.graph.node:
  for name in n.input:users.setdefault(name,[]).append(n)
 replacements={};removed=set();records=[]
 for n in m.graph.node:
  if n.op_type!='ConvTranspose':continue
  if int(re.search(r'/b(\d+)/',n.name)[1])<min_resolution:continue
  a={x.name:helper.get_attribute_value(x) for x in n.attribute};assert a['strides']==[2,2] and a['kernel_shape']==[3,3] and a.get('pads',[0]*4)==[0]*4 and a.get('group',1)==1
  chain=[];cur=n
  while True:
   assert len(users[cur.output[0]])==1;cur=users[cur.output[0]][0]
   if cur.op_type=='Reshape':chain.append(cur);continue
   assert cur.op_type=='Conv';break
  a={x.name:helper.get_attribute_value(x) for x in cur.attribute};assert a['pads']==[1]*4 and a['kernel_shape']==[4,4] and a['strides']==[1,1]
  w=constants[n.input[1]];f=constants[cur.input[1]];assert f.shape==(w.shape[1],1,4,4) and a['group']==w.shape[1]
  name=n.name+'__folded';weight=name+'_weight';intermediate=name+'_phases';p=packed(w,f);m.graph.initializer.append(numpy_helper.from_array(p,weight))
  replacements[n.name]=[helper.make_node('Conv',[n.input[0],weight],[intermediate],name=name,kernel_shape=[3,3],pads=[1]*4,strides=[1,1]),helper.make_node('DepthToSpace',[intermediate],[cur.output[0]],name=name+'_shuffle',blocksize=2,mode='CRD')]
  removed.update(x.name for x in chain+[cur]);records.append({'node':n.name,'filter':cur.name,'weight_shape':list(p.shape)})
 nodes=[]
 for n in m.graph.node:
  if n.name not in removed:nodes.extend(replacements.get(n.name,[n]))
 del m.graph.node[:];m.graph.node.extend(nodes);del m.graph.value_info[:]
 used={k for n in nodes for k in n.input};initializers=[v for v in m.graph.initializer if v.name in used];del m.graph.initializer[:];m.graph.initializer.extend(initializers)
 onnx.checker.check_model(m);onnx.save(m,target)
 return {'source':str(source),'target':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'nodes':len(nodes),'bytes':target.stat().st_size,'folds':records,'precision':'FP32 coefficients; offline accumulation in FP64 then FP32 rounding','status':'requires full-model browser validation'}
if __name__=='__main__':
 test();OUT.mkdir(exist_ok=True);r=transform(ROOT/'review-artifacts/browser-onnx-profile/synthesis-spatial.onnx',OUT/'synthesis-folded.onnx');(OUT/'manifest.json').write_text(json.dumps(r,indent=2));print('Independent geometry tests passed;',r['nodes'],'nodes;',r['bytes'],'bytes')
