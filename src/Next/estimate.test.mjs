// The estimate must come from measurement and must not appear before there is one.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
const read=n=>fs.readFile(new URL(n,import.meta.url),'utf8');
const plain=s=>s.replace(/^import .*;\n/gm,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify(import.meta.url));
test('Face time is measured from real work only, and frames come from the shared geometry',async()=>{
 const source=plain(await read('product-bridge.mjs'));
 let counter=0,slow=false;
 const service={setPreferredRoute(){},generate:async()=>{const at=Date.now();while(slow&&Date.now()-at<25);return {blob:new Blob(['i'],{type:'image/png'}),cached:false,latent:{space:'w-plus',shape:[18,512],values:new Float32Array(9216)},provenance:{bundleVersion:'t',manifestSha256:'0'.repeat(64),modelSha256:'m',noiseSha256:'n'}};}};
 const ctx=vm.createContext({Blob,Float32Array,AbortController,DOMException,TextDecoder,crypto:webcrypto,JSON,Map,Date,performance:{now:()=>Date.now()},
  URL:{createObjectURL:()=>'blob:'+ ++counter,revokeObjectURL(){}},
  fetch:async()=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify({codec:{}})).buffer}),
  createBrowserRuntime:()=>service,createDesktopRuntime:()=>service,decode:s=>({tag:0,fields:[JSON.parse(s)]}),encode:x=>({tag:0,fields:[JSON.stringify(x)]}),
  saveFile:async()=>'Saved',GEOMETRY_VERSION:'t',createLatentPath:o=>({totalFrames:o.framesPerSegment*o.controls.length,frames:()=>[]}),
  videoWriter:()=>({initialize:async()=>{},dispose(){}}),diagnostics:{start(){},stage(){},finish(){},bundle(){}},window:{addEventListener(){}}});
 vm.runInContext(source+'\nglobalThis.run=execute;globalThis.faceMs=measuredFaceMs;globalThis.frames=plannedFrames;',ctx);
 assert.equal(ctx.faceMs(),null,'no estimate before this device has produced a face');
 const request={jobId:1,action:'faces',provider:'auto',inputs:[{id:'a',mode:'seed',value:'1'},{id:'b',mode:'seed',value:'2'}],kind:'linear',width:0,pinch:false,frames:16,fps:16};
 slow=true;await ctx.run(request);
 const measured=ctx.faceMs();
 assert(measured>0,'a real face produces a measurement');
 assert.equal(ctx.frames({...request}),32,'frames come from the same geometry the morph renders');
});
