// Remote HTTP is a read-only live viewer. The localhost tab runs the experiment.
if(new URLSearchParams(location.search).has('view')){
 const button=document.querySelector('button');button.disabled=true;button.textContent='Live results from the benchmark machine';document.querySelector('canvas').style.display='none';
 async function refresh(){try{const response=await fetch('/review-artifacts/browser-onnx-throughput/browser.json?t='+Date.now(),{cache:'no-store'});if(!response.ok)throw Error('Waiting for the first saved result');const r=await response.json();document.querySelector('#status').textContent=r.completed?'Benchmark completed':r.finished?'Benchmark finished with failed cases':'Benchmark in progress — updates automatically';const body=document.querySelector('tbody');body.replaceChildren();for(const row of r.rows)for(const m of row.measurements||[]){const tr=document.createElement('tr');for(const v of [row.name,row.batch,m.depth,m.msPerUsefulFace.toFixed(2),m.lastCorrectness?.rgbMaxDiff??'checking']){const td=document.createElement('td');td.textContent=v;tr.append(td);}body.append(tr);}document.querySelector('pre').textContent=JSON.stringify(r,null,2);const img=document.querySelector('#saved-face');img.onload=()=>img.style.display='block';img.src='/review-artifacts/browser-onnx-throughput/face.png?t='+Date.now();}catch(e){document.querySelector('#status').textContent=String(e);}}
 refresh();setInterval(refresh,5000);
}

else if(!navigator.gpu){
 document.querySelector('button').disabled=true;
 document.querySelector('#status').textContent='WebGPU needs a secure context. In Chrome or Edge, open chrome://flags/#unsafely-treat-insecure-origin-as-secure (Edge: edge://flags/#unsafely-treat-insecure-origin-as-secure), add only http://192.168.11.20:7874, enable the flag, and relaunch. Then return here and run the benchmark. This is a development-only exception; remove it when finished. Alternatively use a trusted HTTPS endpoint.';
}
