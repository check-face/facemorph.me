const status=document.querySelector('#status');
document.querySelector('button').onclick=async()=>{
 document.querySelector('button').disabled=true;
 const report={started:new Date().toISOString(),version:ort.env.versions,rows:[]};
 const mode=new URLSearchParams(location.search).get('mode')||'default';
 const sessions=[];let device;
 try {
  ort.env.wasm.numThreads=1;
  if(mode==='custom'){const adapter=await navigator.gpu.requestAdapter();device=await adapter.requestDevice();}
  for(let i=0;i<(mode==='shared'?2:1);i++){
   const row={mode,index:i};report.rows.push(row);status.textContent='Loading '+mode+' '+i;
   try{
    const start=performance.now();const session=await ort.InferenceSession.create('/review-artifacts/browser-onnx-round6/add.onnx',{executionProviders:device?[{name:'webgpu',device}]:['webgpu'],extra:{session:{disable_cpu_ep_fallback:'1'}}});sessions.push(session);row.loadMs=performance.now()-start;
    device=ort.env.webgpu.device;
    const y=await session.run({x:new ort.Tensor('float32',new Float32Array([1,2,3,4]),[4])});await device.queue.onSubmittedWorkDone();row.output=Array.from(y.y.data);row.correct=row.output.every((v,j)=>v===(j+1)*2);y.y.dispose();
   }catch(e){row.error=String(e);break;}
  }
 }catch(e){report.error=String(e);}finally{for(const session of sessions)await session.release();}
 report.finished=true;document.querySelector('pre').textContent=JSON.stringify(report,null,2);status.textContent='Completed '+mode;
 await fetch('/save/browser.json',{method:'POST',body:JSON.stringify(report,null,2)});
};
