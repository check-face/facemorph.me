"""Adapt Burn 0.21 ONNX Gemm storage for nonblocking LinearLayout::Row.
Transpose exact FP32 weight coefficients; remove singleton bias dimension.
Reads newly generated packs, never re-transposes an already adapted file.
"""
from pathlib import Path
import struct,cbor2,numpy as np,json
ROOT=Path(__file__).resolve().parents[4];CRATE=Path(__file__).resolve().parent
for b in [1,2,4,"full"]:
 name='synthesis-polyphase.bpk' if b=='full' else f'block-b{b}.bpk'
 source=max((CRATE/'target').rglob(name),key=lambda p:p.stat().st_mtime)
 data=source.read_bytes();magic,version,length=struct.unpack('<IHI',data[:10]);assert magic==0x4255524e and version==1
 metadata=cbor2.loads(data[10:10+length]);start=(10+length+255)//256*256;body=bytearray(data[start:]);changes=[]
 for name,tensor in metadata['tensors'].items():
  if name.endswith('.weight') and any(part.startswith('linear') for part in name.split('.')):
   a,z=tensor['data_offsets'];arr=np.frombuffer(body[a:z],dtype='<f4').reshape(tensor['shape']);body[a:z]=arr.T.copy().tobytes();tensor['shape']=list(arr.T.shape);changes.append(name)
  if name.endswith('.bias') and any(part.startswith('linear') for part in name.split('.')) and len(tensor['shape'])==2:
   assert tensor['shape'][0]==1;tensor['shape']=tensor['shape'][1:];changes.append(name)
 meta=cbor2.dumps(metadata);header=struct.pack('<IHI',magic,version,len(meta))+meta;header+=bytes((-len(header))%256)
 dest=ROOT/('review-artifacts/browser-onnx-block/full.bpk' if b=='full' else f'review-artifacts/browser-onnx-block/block-b{b}.bpk');dest.write_bytes(header+body);print(dest.name,changes)
