// Operator-only UI lifecycle test. Uses the normal controller and FFmpeg worker.
const q=new URLSearchParams(location.search),campaign=q.get('campaign');
const operatorScope='FFmpeg-only UI lifecycle validation; no inference';
async function start(){
 if(!/iPhone|iPad|iPod/.test(navigator.platform))throw Error('This entry requires iOS Simulator Safari');
 if(!campaign||!/^[-a-zA-Z0-9]{8,80}$/.test(campaign)||!q.get('udid')||!q.get('device')||!q.get('runtime'))throw Error('Explicit operator campaign and Simulator identity required');
 globalThis.__facemorphSimulatorContext=Object.freeze({campaignId:campaign,test:true,operatorScope,executionEnvironment:{kind:'ios-simulator',declaredBy:'operator-harness',simulatorDeviceId:q.get('udid'),deviceProfile:q.get('device'),runtime:q.get('runtime'),physicalPerformanceEvidence:false}});
 const prior=JSON.parse(localStorage.getItem('facemorph-lab-last')||'null');
 const key='facemorph-simulator-playback-'+campaign,seen=localStorage.getItem(key);
 const originalFetch=globalThis.fetch,target=new URL('./experiments-v25.json',location.href).href;
 let intercepted=false;
 const scopedFetch=async(input,options)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,location.href).href;
  const response=await originalFetch.call(globalThis,input,options);
  if(url!==target)return response;
  if(!response.ok)throw Error('Playback configuration HTTP '+response.status);
  const config=await response.json(),ffmpeg=config.experiments.filter(e=>e.id==='ffmpeg');
  if(config.version!=='2026-09-15.25'||ffmpeg.length!==1)throw Error('Unexpected playback configuration');
  config.experiments=ffmpeg;config.automaticSuite.rules={ffmpeg:config.automaticSuite.rules.ffmpeg};
  intercepted=true;
  if(globalThis.fetch===scopedFetch)globalThis.fetch=originalFetch;
  return new Response(JSON.stringify(config),{status:200,headers:{'Content-Type':'application/json'}});
 };
 globalThis.fetch=scopedFetch;
 try{
  await import('./lab-v25.js');
  const end=performance.now()+60000;
  while(document.querySelector('#run').disabled){if(performance.now()>end)throw Error('Normal lab did not become ready');await new Promise(r=>setTimeout(r,100));}
  if(!intercepted)throw Error('FFmpeg-only configuration was not applied');
 }finally{if(globalThis.fetch===scopedFetch)globalThis.fetch=originalFetch;}
 if(seen||prior?.runId&&!prior.finished){document.querySelector('#status').textContent='SIMULATOR: previous run shown/recovered; no automatic rerun.';document.querySelector('#run').disabled=true;return;}
 localStorage.setItem(key,new Date().toISOString());if(!localStorage.getItem(key))throw Error('Campaign marker could not persist');
 document.querySelector('#label').value=('SIMULATOR '+q.get('device')+' FFmpeg-only UI lifecycle').slice(0,80);
 const run=document.querySelector('#run');let started=false;run.addEventListener('click',e=>{if(started){e.preventDefault();e.stopImmediatePropagation();document.querySelector('#status').textContent='SIMULATOR: use a new campaign for another run.';}else started=true;},{capture:true});run.click();
}
start().catch(e=>{document.querySelector('#status').textContent='SIMULATOR playback startup failed: '+String(e);document.querySelector('#run').disabled=true;});
