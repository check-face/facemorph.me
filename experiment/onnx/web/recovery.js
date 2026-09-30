const status=document.querySelector('#status');const lossCase=Number(new URLSearchParams(location.search).get('loss')??1);if(!Number.isInteger(lossCase)||lossCase<0||lossCase>30)throw Error('Invalid loss case');
document.querySelector('button').onclick=async()=>{
 document.querySelector('button').disabled=true;const report={started:new Date().toISOString(),injectedLossCase:lossCase,scope:'Controlled GPU loss after submission; new WASM worker retries unfinished case and completes 31-case synthesis suite',rows:[],attempts:[]};let worker,saveChain=Promise.resolve(),nextCase=0,recovered=false,recoveryAt;
 const save=()=>{document.querySelector('pre').textContent=JSON.stringify(report,null,2);const snapshot=JSON.stringify(report,null,2);saveChain=saveChain.then(async()=>{const r=await fetch('/save/browser.json',{method:'POST',body:snapshot});if(!r.ok)throw Error('Report save failed');});return saveChain;};
 const launch=(provider,startCase)=>{const attempt={provider,startCase,startedMs:performance.now()};report.attempts.push(attempt);worker=new Worker('./recovery-worker.js',{type:'module'});
 worker.onmessage=async({data:m})=>{
  if(m.progress)status.textContent=m.progress;if(m.meta)Object.assign(attempt,m.meta);
  if(m.row){if(m.row.caseIndex!==nextCase){worker.terminate();report.error='Skipped or duplicated case';report.completed=false;await save();return;}nextCase++;report.rows.push(m.row);if(recovered&&report.recoveryToFirstValidatedFrameMs===undefined)report.recoveryToFirstValidatedFrameMs=performance.now()-recoveryAt;}
  if(m.rgba){const canvas=document.querySelector('canvas');canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.rgba),1024,1024),0,0);}
  if(m.done){attempt.completed=m.completed;attempt.error=m.error;attempt.failedCase=m.failedCase;worker.terminate();
   if(!m.completed&&!recovered&&attempt.deviceLost){recovered=true;recoveryAt=performance.now();report.retriedCase=nextCase;if(m.failedCase!==nextCase){report.error='Retry index mismatch';await save();return;}await save();launch('wasm',nextCase);return;}
   report.finished=true;report.completed=!!(m.completed&&recovered&&nextCase===31&&report.rows.every(r=>r.passed));report.error=m.error;report.finishedAt=new Date().toISOString();status.textContent=report.completed?'Recovered on CPU: all 31 cases passed':(m.error||'Recovery validation failed');if(report.completed){const blob=await new Promise(resolve=>document.querySelector('canvas').toBlob(resolve,'image/png'));const saved=await fetch('/save/recovery-last.png',{method:'POST',body:blob});if(!saved.ok){report.error='Final image save failed';report.completed=false;}}
  }await save();
 };worker.onerror=async e=>{worker.terminate();report.error=e.message;report.completed=false;status.textContent=e.message;await save();};worker.postMessage({provider,startCase,...(provider==='auto'?{injectLossAt:lossCase}:{})});};
 launch('auto',-2);
};
