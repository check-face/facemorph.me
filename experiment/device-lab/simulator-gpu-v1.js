// Operator-only integration entry: the normal lab UI, selection and workers.
const q=new URLSearchParams(location.search),campaign=q.get('campaign');
async function start(){
 if(!/iPhone|iPad|iPod/.test(navigator.platform))throw Error('This entry requires iOS Simulator Safari');
 if(!campaign||!/^[-a-zA-Z0-9]{8,80}$/.test(campaign)||!q.get('udid')||!q.get('device')||!q.get('runtime'))throw Error('Explicit operator campaign and Simulator identity required');
 globalThis.__facemorphSimulatorContext=Object.freeze({campaignId:campaign,executionEnvironment:{kind:'ios-simulator',declaredBy:'operator-harness',simulatorDeviceId:q.get('udid'),deviceProfile:q.get('device'),runtime:q.get('runtime'),physicalPerformanceEvidence:false}});
 const prior=JSON.parse(localStorage.getItem('facemorph-lab-last')||'null');
 const key='facemorph-simulator-suite-'+campaign,seen=localStorage.getItem(key);
 await import('./lab-gpu-diagnostic-v1.js');
 const end=performance.now()+60000;
 while(document.querySelector('#run').disabled){if(performance.now()>end)throw Error('Normal lab did not become ready');await new Promise(r=>setTimeout(r,100));}
 if(seen||prior?.runId&&!prior.finished){document.querySelector('#status').textContent='SIMULATOR: previous run shown/recovered; no automatic rerun.';document.querySelector('#run').disabled=true;return;}
 localStorage.setItem(key,new Date().toISOString());if(!localStorage.getItem(key))throw Error('Campaign marker could not persist');
 document.querySelector('#label').value=('SIMULATOR '+q.get('device')+' '+q.get('runtime')+' normal suite').slice(0,80);
 const run=document.querySelector('#run');let started=false;run.addEventListener('click',e=>{if(started){e.preventDefault();e.stopImmediatePropagation();document.querySelector('#status').textContent='SIMULATOR: use a new campaign for another run.';}else started=true;},{capture:true});run.click();
}
start().catch(e=>{document.querySelector('#status').textContent='SIMULATOR startup failed: '+String(e);});
