import {createBrowserModelCache, MODEL_CACHE_NAME} from '/src/Next/Assets/model-cache.mjs';
import {decodeBounded,cropPhoto} from '/src/Next/photo/crop.mjs';
import {openShardStore} from '/src/Next/Assets/shard-store.mjs';

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
    // Small assets live as OPFS shards where the engine has them (Android Chrome), Cache Storage
    // elsewhere: every test starts from neither, and checks both for committed bytes.
    const raw=await caches.open(MODEL_CACHE_NAME),shards=await openShardStore();
    const forget=async()=>{await raw.delete(key);await shards?.remove(hash);};
    const committed=async()=>!!await raw.match(key)||!!await shards?.has(hash,bytes.length);
    await forget();
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
      await rejected(cache.acquire(asset));check(!await committed(),'Corrupt bytes committed');
    });
    await test('cancel-partial-retry',async()=>{
      let ready;const started=new Promise(resolve=>{ready=resolve;});
      const controller=new AbortController();
      const cache=await createBrowserModelCache({fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,1));ready();}}))});
      const pending=rejected(cache.acquire(asset,{signal:controller.signal}));
      await started;controller.abort();const error=await pending;
      check(error.name==='AbortError','Wrong cancellation error');
      check(!await committed(),'Partial bytes committed');
      const retry=await createBrowserModelCache({fetcher:async()=>new Response(bytes)});
      check(await (await (await retry.acquire(asset)).open()).text()==='abc','Retry failed');
      await forget();
    });
    await test('concurrent-download-dedup',async()=>{
      let calls=0;
      const cache=await createBrowserModelCache({fetcher:async()=>{calls++;return new Response(bytes);}});
      const handles=await Promise.all([cache.acquire(asset),cache.acquire(asset)]);
      check(calls===1,'Concurrent transfer repeated');
      for (const handle of handles) check(await (await handle.open()).text()==='abc','Cached bytes changed');
    });
    await test('corrupt-cache-repair',async()=>{
      await forget();const bad=new TextEncoder().encode('bad');
      if(shards)await shards.write(hash,bad);else await raw.put(key,new Response(bad));let calls=0;
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
    await test('portrait-exif-crop',async()=>{
      const canvas=document.createElement('canvas');canvas.width=800;canvas.height=1200;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#f00';ctx.fillRect(0,0,400,600);ctx.fillStyle='#0f0';ctx.fillRect(400,0,400,600);ctx.fillStyle='#00f';ctx.fillRect(0,600,400,600);ctx.fillStyle='#ff0';ctx.fillRect(400,600,400,600);
      const jpeg=new Uint8Array(await (await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.95))).arrayBuffer());
      for(let orientation=1;orientation<=8;orientation++){
        const app=new Uint8Array(36),view=new DataView(app.buffer);app.set([255,225,0,34,69,120,105,102,0,0,73,73],0);view.setUint16(12,42,true);view.setUint32(14,8,true);view.setUint16(18,1,true);view.setUint16(20,0x112,true);view.setUint16(22,3,true);view.setUint32(24,1,true);view.setUint16(28,orientation,true);
        const file=new File([jpeg.subarray(0,2),app,jpeg.subarray(2)],'portrait.jpg',{type:'image/jpeg'});
        const decoded=await decodeBounded(file,{edge:600});
        check(decoded.bitmap.width===400&&decoded.bitmap.height===600,'EXIF '+orientation+' distorted portrait dimensions');decoded.bitmap.close();
        const crop=await cropPhoto(file,{left:0,top:0,width:200,height:200},{previewScale:.5,rotation:90,output:128});
        const bitmap=await createImageBitmap(crop);canvas.width=canvas.height=128;canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();const pixel=canvas.getContext('2d').getImageData(64,64,1,1).data;
        check(pixel[0]>230&&pixel[1]<20&&pixel[2]<20,'EXIF '+orientation+' crop used the wrong source region');
        canvas.width=800;canvas.height=1200;
      }
      canvas.width=canvas.height=1;
    });
    sessionStorage.setItem(storageKey,JSON.stringify(report.results));
    location.reload();
  }
} catch(error) { report.error=String(error.stack||error);report.completed=false;await submit(); }
