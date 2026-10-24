// Compact v2 media envelope: compact exact W+ plus independently hashed encoded image.
// This does not change model/synthesis tolerance. Product integration must retain the v1 reader.
const te=new TextEncoder(),td=new TextDecoder(),MAX_META=128*1024,MAX_FILE=64*1024*1024;
const PNG=[137,80,78,71,13,10,26,10],KEY='FaceMorph',WEBP_KEY='FMRP';
const hex=/^[a-f0-9]{64}$/;
async function digest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;}return (n^0xffffffff)>>>0;}
function text(bytes,at,n){return td.decode(bytes.subarray(at,at+n));}
function structure(bytes){
 if(bytes.byteLength>MAX_FILE)throw Error('Recovery image exceeds its size limit.');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),parts=[];
 if(bytes.length>=20&&PNG.every((x,i)=>bytes[i]===x)){
  let at=8,ended=false;
  while(at+12<=bytes.length){
   if(parts.length>=4096)throw Error('Excessive PNG chunks.');
   const size=v.getUint32(at);if(size>bytes.length-at-12)throw Error('Truncated PNG.');
   const type=text(bytes,at+4,4),end=at+size+12,data=bytes.subarray(at+8,end-4);
   if(parts.length===0&&(type!=='IHDR'||size!==13))throw Error('Invalid PNG header.');
   const own=type==='tEXt'&&text(data,0,KEY.length+1)===KEY+'\0';
   if(own&&crc(bytes.subarray(at+4,end-4))!==v.getUint32(end-4))throw Error('Damaged recovery metadata.');
   parts.push({at,end,type,data,own});at=end;
   if(type==='IEND'){if(size||at!==bytes.length)throw Error('Invalid PNG end.');ended=true;break;}
  }
  if(!ended)throw Error('Missing PNG end.');
  return {mime:'image/png',parts,width:v.getUint32(16),height:v.getUint32(20)};
 }
 if(bytes.length>=20&&text(bytes,0,4)==='RIFF'&&text(bytes,8,4)==='WEBP'){
  if(v.getUint32(4,true)!==bytes.length-8)throw Error('Invalid WebP container length.');
  let at=12;
  while(at<bytes.length){
   if(parts.length>=4096||at+8>bytes.length)throw Error('Invalid WebP chunks.');
   const size=v.getUint32(at+4,true),end=at+8+size+(size&1);
   if(end>bytes.length)throw Error('Truncated WebP chunk.');
   const type=text(bytes,at,4);parts.push({at,end,type,data:bytes.subarray(at+8,at+8+size),own:type===WEBP_KEY});at=end;
  }
  if(parts.some(p=>p.type==='ANIM'||p.type==='ANMF'))throw Error('Animated images cannot carry a face original.');
  const image=parts.find(p=>p.type==='VP8 '||p.type==='VP8L');if(!image)throw Error('WebP has no image.');
  const d=image.data;let width,height;
  if(image.type==='VP8 '){if(d.length<10||d[3]!==0x9d||d[4]!==1||d[5]!==0x2a)throw Error('Invalid WebP image header.');const iv=new DataView(d.buffer,d.byteOffset,d.byteLength);width=iv.getUint16(6,true)&16383;height=iv.getUint16(8,true)&16383;}
  else{if(d.length<5||d[0]!==0x2f)throw Error('Invalid lossless WebP header.');width=1+d[1]+((d[2]&63)<<8);height=1+(d[2]>>6)+(d[3]<<2)+((d[4]&15)<<10);}
  return {mime:'image/webp',parts,width,height};
 }
 return null;
}
function floatBytes(values){
 if(values?.length!==18*512)throw Error('Invalid recovery latent shape.');
 const bytes=new Uint8Array(values.length*4),v=new DataView(bytes.buffer);
 for(let i=0;i<values.length;i++){if(!Number.isFinite(values[i]))throw Error('Invalid recovery latent value.');v.setFloat32(i*4,values[i],true);if(!Number.isFinite(v.getFloat32(i*4,true)))throw Error('Invalid float32 latent.');}
 return bytes;
}
function b64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
function unb64(s){
 if(typeof s!=='string'||s.length!==49152||!/^[A-Za-z0-9+/]+$/.test(s))throw Error('Invalid latent encoding.');
 const raw=atob(s);if(raw.length!==36864)throw Error('Invalid latent byte length.');return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
function validateIdentity(r){
 if(!['seed','photo','latent'].includes(r.generationKind)||!hex.test(r.generationSha256||'')||!hex.test(r.provenance?.modelSha256||'')||!hex.test(r.provenance?.noiseSha256||''))throw Error('Invalid recovery generation identity.');
 if(r.seed!==undefined&&(!Number.isInteger(r.seed)||r.seed<0||r.seed>4294967295))throw Error('Invalid recovery seed.');
}
function strip(bytes,parsed){
 const own=parsed.parts.filter(p=>p.own);if(own.length!==1)throw Error('Duplicate recovery metadata.');
 const part=own[0],out=new Uint8Array(bytes.length-(part.end-part.at));out.set(bytes.subarray(0,part.at));out.set(bytes.subarray(part.end),part.at);
 if(parsed.mime==='image/webp')new DataView(out.buffer).setUint32(4,out.length-8,true);
 return {base:out,metadata:part.data};
}
export async function embedRecovery(blob,result,{seed}={}){
 const bytes=new Uint8Array(await blob.arrayBuffer()),parsed=structure(bytes);
 if(!parsed||blob.type!==parsed.mime)throw Error('Unsupported recovery image.');
 if(parsed.width!==1024||parsed.height!==1024)throw Error('Recovery requires a full1024 face.');
 if(parsed.parts.some(p=>p.own))throw Error('Image already has recovery metadata.');
 const values=result.latent?.values||result.values,raw=floatBytes(values);
 const record={schema:2,kind:'facemorph-image-v2',generationKind:result.generationKind,generationSha256:result.generationSha256,
  provenance:{...result.provenance},width:1024,height:1024,mime:parsed.mime,imageSha256:await digest(bytes),latentSha256:await digest(raw),
  latent:{space:'w-plus',shape:[18,512],encoding:'float32-le-base64',data:b64(raw)},...(seed===undefined?{}:{seed})};
 // Never copy a source photo or input string into the metadata envelope.
 const allowed=['bundleVersion','manifestSha256','modelSha256','noiseSha256','provider','mappingProvider','route','truncationPsi','truncationCutoff','createdAt'];
 record.provenance=Object.fromEntries(allowed.filter(k=>record.provenance[k]!==undefined).map(k=>[k,record.provenance[k]]));validateIdentity(record);
 const json=te.encode(JSON.stringify(record));if(json.length>MAX_META)throw Error('Recovery metadata exceeds limit.');
 let chunk,out;
 if(parsed.mime==='image/png'){
  const payload=new Uint8Array(KEY.length+1+json.length);payload.set(te.encode(KEY));payload.set(json,KEY.length+1);
  chunk=new Uint8Array(payload.length+12);const v=new DataView(chunk.buffer);v.setUint32(0,payload.length);chunk.set(te.encode('tEXt'),4);chunk.set(payload,8);v.setUint32(chunk.length-4,crc(chunk.subarray(4,chunk.length-4)));
  const at=parsed.parts.at(-1).at;out=new Blob([bytes.subarray(0,at),chunk,bytes.subarray(at)],{type:parsed.mime});
 }else{
  chunk=new Uint8Array(8+json.length+(json.length&1));chunk.set(te.encode(WEBP_KEY));new DataView(chunk.buffer).setUint32(4,json.length,true);chunk.set(json,8);
  const header=bytes.slice(0,12);new DataView(header.buffer).setUint32(4,bytes.length+chunk.length-8,true);out=new Blob([header,bytes.subarray(12),chunk],{type:parsed.mime});
 }
 return {blob:out,baseImageSha256:record.imageSha256,latentSha256:record.latentSha256,metadataBytes:out.size-blob.size};
}
export async function recoverEnvelope(blob){
 if(!(blob instanceof Blob)||blob.size>MAX_FILE)return null;
 const bytes=new Uint8Array(await blob.arrayBuffer()),parsed=structure(bytes);if(!parsed||!parsed.parts.some(p=>p.own))return null;
 const {base,metadata}=strip(bytes,parsed),payload=parsed.mime==='image/png'?metadata.subarray(KEY.length+1):metadata;
 if(payload.length>MAX_META)throw Error('Recovery metadata exceeds limit.');
 let r;try{r=JSON.parse(td.decode(payload));}catch{throw Error('Unreadable recovery metadata.');}
 if(r.schema===1&&parsed.mime==='image/png')return {legacy:true}; // product dispatch retains its existing v1 reader
 if(r.schema!==2||r.kind!=='facemorph-image-v2'||r.mime!==parsed.mime||r.width!==1024||r.height!==1024||r.latent?.space!=='w-plus'||JSON.stringify(r.latent.shape)!=='[18,512]'||r.latent.encoding!=='float32-le-base64')throw Error('Unsupported recovery metadata.');
 validateIdentity(r);const raw=unb64(r.latent.data);
 if(parsed.width!==r.width||parsed.height!==r.height)throw Error('Recovery dimensions do not match the image.');
 if(!hex.test(r.imageSha256||'')||!hex.test(r.latentSha256||'')||await digest(base)!==r.imageSha256||await digest(raw)!==r.latentSha256)throw Error('Image or latent integrity check failed.');
 const values=new Float32Array(18*512),v=new DataView(raw.buffer);for(let i=0;i<values.length;i++){values[i]=v.getFloat32(i*4,true);if(!Number.isFinite(values[i]))throw Error('Invalid latent value.');}
 return {blob:new Blob([base],{type:parsed.mime}),latent:{space:'w-plus',shape:[18,512],values},provenance:r.provenance,generationKind:r.generationKind,generationSha256:r.generationSha256,imageSha256:r.imageSha256,latentSha256:r.latentSha256,seed:r.seed};
}
