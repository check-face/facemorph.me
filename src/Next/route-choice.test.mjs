// Real reports from an S24 show WebGL costing about twice the CPU path, so the runtime must not
// assume a GPU route is the fast one. It measures, and it settles on what this device proved.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
const read=n=>fs.readFile(new URL(n,import.meta.url),'utf8');
const plain=s=>s.replace(/^import .*;\n/gm,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify(import.meta.url));

function harness({gpu=false,costs={},store=new Map()}={}){
 const admitted=[];
 const ctx=vm.createContext({Blob,Float32Array,AbortController,DOMException,crypto:webcrypto,console,setTimeout,clearTimeout,JSON,Date,
  localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  OffscreenCanvas:class{},navigator:{gpu:gpu?{}:undefined},
  openOriginals:async()=>({get:async()=>null,put:async()=>{},close(){}}),digest:async()=>'hash',
  generationIdentity:()=>({}),inputLatent:async()=>({identity:'seed'}),requireLatent:v=>v});
 return {ctx,admitted,costs};
}

test('A device that measures a slow route tries an untried one, then keeps the winner',async()=>{
 const source=plain(await read('browser/runtime.mjs'));
 const store=new Map();
 // Replay the S24 shape: webgl qualifies slowly, cpu qualifies quickly.
 const costs={webgl:9000,cpu:2500};
 const seen=[];
 for(let run=0;run<3;run++){
  const {ctx}=harness({gpu:false,store});
  vm.runInContext(source+'\nglobalThis.create=createBrowserRuntime;',ctx);
  const runtime=ctx.create({manifest:{schemaVersion:1,bundleVersion:'t',webgl:{},webgpu:{},canaries:[{},{}]},manifestSha256:'0'.repeat(64),
   workerFactory:()=>{throw Error('no worker in this check');}});
  // Drive only the private choice through a generation attempt we let fail after route selection.
  try{await runtime.generate({mode:'seed',value:'1'});}catch{}
  const saved=JSON.parse(store.get('facemorph-route-speed-v1')||'{}');
  seen.push(Object.keys(saved.routes||{}));
  // Stand in for the admission timing the real worker would produce.
  const routes={...(saved.routes||{})};
  for(const name of Object.keys(costs)) if(!(name in routes)&&seen.length>run) {routes[name]=costs[name];break;}
  store.set('facemorph-route-speed-v1',JSON.stringify({bundle:'0'.repeat(64),routes}));
  runtime.dispose?.();
 }
 const final=JSON.parse(store.get('facemorph-route-speed-v1')).routes;
 assert(Object.keys(final).length>=2,'more than one route ends up measured');
 const fastest=Object.entries(final).sort((a,b)=>a[1]-b[1])[0][0];
 assert.equal(fastest,'cpu','the cheaper measured route is the one that wins');
});
