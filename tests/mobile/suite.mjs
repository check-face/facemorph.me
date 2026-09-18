import {createBrowserModelCache, MODEL_CACHE_NAME} from '/src/Next/Assets/model-cache.mjs';

const runId = new URLSearchParams(location.search).get('run');
const storageKey = `mobile-ci-${runId}`;
const bytes = new TextEncoder().encode('abc');
const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const asset = {sha256:hash,size:3,url:'https://synthetic.invalid/model-v1'};
const key = new URL(`/__checkface_model_blobs__/sha256/${hash}`,location.origin).href;
const report = {runId,completed:false,evidenceLevel:'browser-component',e4eExecuted:false,
  inferenceExecuted:false,physicalDeviceQualified:false,userAgent:navigator.userAgent,
  secureContext:isSecureContext,results:[],capabilities:{webgpuExposed:!!navigator.gpu,cacheStorage:!!globalThis.caches}};
const check = (value,message) => { if (!value) throw Error(message); };
async function submit() {
  document.querySelector('#status').textContent=JSON.stringify(report,null,2);
  const response=await fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
  check(response.ok,'Collector rejected report');
}
async function test(id,run) {
  const started=performance.now();
  try { await run(); report.results.push({id,passed:true,elapsedMs:performance.now()-started}); }
  catch(error) { report.results.push({id,passed:false,error:String(error.stack||error)}); throw error; }
  await submit();
}
async function rejected(promise) {
  let error; try { await promise; } catch(e) { error=e; }
  check(error,'Expected rejection'); return error;
}
try {
  const previous=sessionStorage.getItem(storageKey);
  if (previous) {
    report.results=JSON.parse(previous);
    await test('reload-retained-offline',async()=>{
      const cache=await createBrowserModelCache({fetcher:()=>{throw Error('Unexpected network acquisition after reload');}});
      const handle=await cache.acquire({...asset,url:'https://synthetic.invalid/version-2-same-content'});
      check(await (await handle.open()).text()==='abc','Retained bytes changed');
    });
    sessionStorage.removeItem(storageKey);
    report.completed=true;await submit();
  } else {
    // Only synthetic identities on a dedicated ephemeral CI origin are removed.
    const raw=await caches.open(MODEL_CACHE_NAME);await raw.delete(key);
    await test('worker-module-hash',()=>new Promise((resolve,reject)=>{
      const worker=new Worker('./hash-worker.mjs',{type:'module'});
      const timer=setTimeout(()=>{worker.terminate();reject(Error('Worker timeout'));},10000);
      const finish=(error)=>{clearTimeout(timer);worker.terminate();error?reject(error):resolve();};
      worker.onerror=e=>finish(Error(e.message));
      worker.onmessage=({data})=>finish(data.hash===hash?null:Error('Worker hash mismatch: '+JSON.stringify(data)));
      worker.postMessage(bytes.buffer);
    }));
    await test('integrity-rejection',async()=>{
      const cache=await createBrowserModelCache({fetcher:async()=>new Response('abd')});
      await rejected(cache.acquire(asset));check(!await raw.match(key),'Corrupt bytes committed');
    });
    await test('cancel-partial-retry',async()=>{
      let ready;const started=new Promise(resolve=>{ready=resolve;});
      const controller=new AbortController();
      const cache=await createBrowserModelCache({fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,1));ready();}}))});
      const pending=rejected(cache.acquire(asset,{signal:controller.signal}));
      await started;controller.abort();const error=await pending;
      check(error.name==='AbortError','Wrong cancellation error');
      check(!await raw.match(key),'Partial bytes committed');
      const retry=await createBrowserModelCache({fetcher:async()=>new Response(bytes)});
      check(await (await (await retry.acquire(asset)).open()).text()==='abc','Retry failed');
      await raw.delete(key);
    });
    await test('concurrent-download-dedup',async()=>{
      let calls=0;
      const cache=await createBrowserModelCache({fetcher:async()=>{calls++;return new Response(bytes);}});
      const handles=await Promise.all([cache.acquire(asset),cache.acquire(asset)]);
      check(calls===1,'Concurrent transfer repeated');
      for (const handle of handles) check(await (await handle.open()).text()==='abc','Cached bytes changed');
    });
    await test('corrupt-cache-repair',async()=>{
      await raw.put(key,new Response('bad'));let calls=0;
      const cache=await createBrowserModelCache({fetcher:async()=>{calls++;return new Response(bytes);}});
      check(await (await (await cache.acquire(asset)).open()).text()==='abc','Repair failed');
      check(calls===1,'Repair did not acquire replacement');
    });
    await test('png-1024-roundtrip',async()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
      const ctx=canvas.getContext('2d');check(ctx,'Missing canvas context');
      const input=ctx.createImageData(1024,1024);
      for(let i=0;i<input.data.length;i+=4){input.data[i]=(i/4)%256;input.data[i+1]=Math.floor(i/4096)%256;input.data[i+2]=127;input.data[i+3]=255;}
      ctx.putImageData(input,0,0);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));check(blob,'PNG encoding failed');
      const url=URL.createObjectURL(blob);
      try {
        const image=new Image();image.src=url;await image.decode();check(image.naturalWidth===1024&&image.naturalHeight===1024,'Wrong PNG dimensions');
        ctx.clearRect(0,0,1024,1024);ctx.drawImage(image,0,0);
        const actual=ctx.getImageData(0,0,1024,1024).data;
        check(actual.every((v,i)=>v===input.data[i]),'Lossless image roundtrip changed pixels');
      } finally {URL.revokeObjectURL(url);canvas.width=canvas.height=1;}
    });
    sessionStorage.setItem(storageKey,JSON.stringify(report.results));
    location.reload();
  }
} catch(error) { report.error=String(error.stack||error);report.completed=false;await submit(); }
