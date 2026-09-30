importScripts('../node_modules/onnxruntime-web/dist/ort.min.js');
async function array(url){const r=await fetch(url);if(!r.ok)throw Error(`${r.status} ${url}`);return new Float32Array(await r.arrayBuffer());}
function diff(a,b){if(a.length!==b.length)throw Error('Output shape mismatch');let max=0,sum=0,rgb=0;const pixel=v=>Math.trunc(Math.max(0,Math.min(255,Math.fround(Math.fround(v*127.5)+128))));for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);sum+=d;rgb=Math.max(rgb,Math.abs(pixel(a[i])-pixel(b[i])));}return {maxFloatDiff:max,meanFloatDiff:sum/a.length,rgbMaxDiff:rgb};}
onmessage=async({data:cfg})=>{
 const row={...cfg,started:new Date().toISOString(),provider:'wasm only',crossOriginIsolated:self.crossOriginIsolated,hardwareConcurrency:navigator.hardwareConcurrency};let session;
 const progress=stage=>postMessage({progress:stage,row});try{
  ort.env.wasm.numThreads=cfg.threads;ort.env.wasm.wasmPaths='/facemorph.me/experiment/onnx/node_modules/onnxruntime-web/dist/';
  const base='/review-artifacts/',gen=base+'browser-onnx-phase1/';const manifest=await(await fetch(gen+'manifest.json')).json();let t=performance.now();
  const w=await array(base+'browser-onnx-video/w.f32'),noise=await Promise.all(manifest.noise.map(n=>array(gen+n.file))),firstRef=await array(base+'browser-onnx-polyphase/browser-image.f32'),lastRef=await array(base+'browser-onnx-polyphase/browser-zero.f32');row.fixtureFetchMs=performance.now()-t;
  progress('Loading WASM model');t=performance.now();session=await ort.InferenceSession.create(base+(cfg.energy?'browser-onnx-energy/':'browser-onnx-profile/')+'synthesis-'+cfg.graph+'.onnx',{executionProviders:['wasm']});row.loadMs=performance.now()-t;row.runtimeThreads=ort.env.wasm.numThreads;
  const feeds={};manifest.noise.forEach((n,i)=>feeds[n.name]=new ort.Tensor('float32',noise[i],n.shape));
  const run=async seed=>{feeds.w=new ort.Tensor('float32',w.slice(seed*18*512,(seed+1)*18*512),[1,18,512]);return (await session.run(feeds)).image;};
  row.warmupMs=[];for(let i=0;i<2;i++){progress('Warmup '+(i+1)+'/2');t=performance.now();const out=await run(0);row.warmupMs.push(performance.now()-t);if(i===1)row.firstCorrectness=diff(out.data,firstRef);out.dispose();}
  if(!Number.isFinite(row.firstCorrectness.maxFloatDiff)||row.firstCorrectness.maxFloatDiff>.002)throw Error('First output correctness failed');
  row.timesMs=[];for(const seed of [0,1,25]){progress('Timed fixture '+seed);t=performance.now();const out=await run(seed);row.timesMs.push(performance.now()-t);if(seed===25)row.lastCorrectness=diff(out.data,lastRef);out.dispose();}
  row.medianMs=[...row.timesMs].sort((a,b)=>a-b)[1];if(!Number.isFinite(row.lastCorrectness.maxFloatDiff)||row.lastCorrectness.maxFloatDiff>.002)throw Error('Last output correctness failed');row.completed=true;
 }catch(e){row.error=String(e);}finally{if(session)await session.release();}postMessage({done:true,row});
};
