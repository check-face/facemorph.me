const status=document.querySelector('#status');document.querySelector('button').onclick=async()=>{
 document.querySelector('button').disabled=true;const r={started:new Date().toISOString(),userAgent:navigator.userAgent,runtime:'ORT Web 1.24.3',scope:'1024px FP32 synthesis, WASM CPU only; fresh worker per thread configuration',rows:[]};
 const cases=new URLSearchParams(location.search).has('energy')?[{threads:4,graph:'spatial',energy:false},{threads:4,graph:'spatial',energy:true}]:new URLSearchParams(location.search).has('no-isolation')?[{threads:4,graph:'spatial'}]:[1,4].flatMap(threads=>['spatial','polyphase'].map(graph=>({threads,graph})));
 for(const {threads,graph,energy} of cases){
  const worker=new Worker('./cpu-worker.js');const row=await new Promise(resolve=>{worker.onmessage=({data:m})=>{status.textContent=`${energy?'energy ':''}${graph}, ${threads} threads: ${m.progress||'finished'}`;if(m.done)resolve(m.row);};worker.onerror=e=>resolve({graph,threads,error:e.message});worker.postMessage({graph,threads,energy});});worker.terminate();r.rows.push(row);document.querySelector('pre').textContent=JSON.stringify(r,null,2);await fetch('/save/browser.json',{method:'POST',body:JSON.stringify(r,null,2)});
 }
 r.finished=true;r.completed=r.rows.every(x=>x.completed);status.textContent=r.completed?'CPU cases completed':'Finished with failed cases';document.querySelector('pre').textContent=JSON.stringify(r,null,2);await fetch('/save/browser.json',{method:'POST',body:JSON.stringify(r,null,2)});
};
