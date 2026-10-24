// One observational run of the deployed UI. Run under autoresearch/run.py's eris lease.
// Usage: PLAYWRIGHT_MODULE=/path/to/playwright node observe-live.mjs /absolute/output.json
// Uses an isolated profile and synthetic inputs; sends no diagnostic reports.
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
execFileSync('bash',['autoresearch/devices/eris/require-quiet-gpu.sh']);
const profile=process.env.REVIEW_PROFILE||await mkdtemp('/home/cdilga/Work/runs/e2e-review-');
const out=process.argv[2];
const report={deployedSourceSha:process.env.DEPLOYED_SOURCE_SHA||null,date:new Date().toISOString(),scope:'Single unpaired headless live-UI observation on eris; not full31 or physical-phone qualification',host:execFileSync('nvidia-smi',['--query-gpu=name,driver_version,memory.used,utilization.gpu','--format=csv,noheader'],{encoding:'utf8'}).trim(),loadBefore:execFileSync('uptime',{encoding:'utf8'}).trim(),url:'https://next.facemorph.me/',steps:[],errors:[]};
const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--use-gl=angle','--disable-vulkan-surface'],viewport:{width:1280,height:900}});
await context.addInitScript(()=>{
 window.__review={events:[],workers:0};
 const Original=window.Worker;
 window.Worker=function(...args){
  window.__review.workers++;
  const worker=new Original(...args);
  worker.addEventListener('message',({data:d})=>{
   if(d&&typeof d==='object')window.__review.events.push({at:performance.now(),type:d.type,stage:d.stage,elapsedMs:d.elapsedMs,provider:d.provider,gpuEngine:d.gpuEngine});
  });
  return worker;
 };
 window.Worker.prototype=Original.prototype;
});
const page=context.pages()[0];
page.on('pageerror',e=>report.errors.push(e.name));
async function save(){await writeFile(out,JSON.stringify(report,null,2)+'\n');}
async function arm(){
 await page.evaluate(()=>{
  const later=document.querySelector('.next-consent-toast button[aria-label="Ask me later"]');later?.click();
  if(!window.__review.acceptGate)window.__review.acceptGate=setInterval(()=>document.querySelector('.next-download-dialog .next-download-accept')?.click(),100);
 });
}
async function step(name,action,done){
 const before=await page.evaluate(()=>({at:performance.now(),eventCount:window.__review.events.length,workers:window.__review.workers}));
 const start=performance.now();
 const entry={name};report.steps.push(entry);await save();
 try{
  await action();
  await page.waitForFunction(done,null,{timeout:180000,polling:20});
  const facts=await page.evaluate(({at,eventCount,workers})=>({elapsedMs:performance.now()-at,workers:window.__review.workers-workers,events:window.__review.events.slice(eventCount).map(e=>({...e,at:e.at-at})),route:document.querySelector('.next-route-caption')?.innerText||'',dimensions:[...document.querySelectorAll('.next-face-image img')].map(i=>[i.naturalWidth,i.naturalHeight]),video:(()=>{const v=document.querySelector('video.next-video');return v?{width:v.videoWidth,height:v.videoHeight,duration:v.duration,readyState:v.readyState}:null;})()}),before);
  Object.assign(entry,{passed:true,...facts,controllerMs:performance.now()-start});
 }catch(e){Object.assign(entry,{passed:false,error:e.message.slice(0,300)});throw e;}finally{await save();}
}
const idle=()=>!document.querySelector('.next-status progress')&&!document.querySelector('.next-face-active')&&!document.querySelector('.next-download-dialog');
async function generateOne(value){
 const tile=page.locator('[data-next-face="face-1"]');
 await tile.locator('input[type="text"]').fill(value);
 await tile.locator('button.next-face-generate').click();
}
const faceDone=()=>{
 const i=document.querySelector('[data-next-face="face-1"] .next-face-image img');
 const error=document.querySelector('.next-error');if(error)throw Error(error.innerText);
 return i?.complete&&i.naturalWidth===1024&&!document.querySelector('.next-status progress')&&!document.querySelector('.next-face-active')&&!document.querySelector('.next-download-dialog');
};
const videoDone=()=>{
 const error=document.querySelector('.next-error');if(error)throw Error(error.innerText);
 const v=document.querySelector('video.next-video');
 return v?.readyState>=2&&v.videoWidth>0&&!document.querySelector('.next-status progress')&&!document.querySelector('.next-download-dialog');
};
try{
 const nav=performance.now();await page.goto(report.url);await page.locator('.next-product').waitFor();await arm();
 report.startup={controllerToUiMs:performance.now()-nav,...await page.evaluate(async()=>{
  const adapter=await navigator.gpu?.requestAdapter();
  return {userAgent:navigator.userAgent,webdriver:navigator.webdriver,isolation:crossOriginIsolated,adapter:adapter?{info:{vendor:adapter.info?.vendor,architecture:adapter.info?.architecture},bindingBytes:adapter.limits.maxStorageBufferBindingSize}:null,scripts:[...document.scripts].map(s=>s.src).filter(Boolean),facesShown:document.querySelectorAll('.next-face-image img').length};
 })};
 if(!report.startup.adapter||/swiftshader|llvmpipe/.test(JSON.stringify(report.startup.adapter)))throw Error('No verified hardware adapter');
 await page.getByLabel('Processing mode').selectOption('webgpu');
 const prefix='review-2026-10-10-'+Date.now();
 if(process.env.REVIEW_FOLLOWUP==='1'){
  await step('warm-storage-face-for-photo',()=>generateOne(prefix+'-photo-fixture'),faceDone);
  const fixture=Buffer.from(await page.locator('[data-next-face="face-1"] .next-face-image img').evaluate(async i=>Array.from(new Uint8Array(await (await fetch(i.src)).arrayBuffer()))));
  report.syntheticFixture={origin:'Newly generated synthetic face from this product, no private photo',bytes:fixture.length,sha256:createHash('sha256').update(fixture).digest('hex')};
  await step('first-photo-align-encode-and-reconstruct',()=>page.locator('input#photo-face-1').setInputFiles({name:'synthetic-face.png',mimeType:'image/png',buffer:fixture}),()=>{
   const e=document.querySelector('.next-error');if(e)throw Error(e.innerText);
   const i=document.querySelector('[data-next-face="face-1"] .next-face-image img');
   return window.__review.events.some(e=>e.stage==='encoding-complete')&&i?.complete&&i.naturalWidth===1024&&!document.querySelector('.next-status progress')&&!document.querySelector('.next-face-active')&&!document.querySelector('.next-download-dialog');
  });
  await step('photo-repeat-same-session',()=>page.locator('[data-next-face="face-1"] button.next-face-generate').click(),faceDone);
  await step('generate-second-face',()=>page.locator('[data-next-face="face-2"] button.next-face-generate').click(),()=>{const i=document.querySelector('[data-next-face="face-2"] .next-face-image img');return i?.complete&&i.naturalWidth===1024&&!document.querySelector('.next-status progress')&&!document.querySelector('.next-face-active')&&!document.querySelector('.next-download-dialog');});
  await step('photo-morph-to-playable-video',()=>page.getByRole('button',{name:/^Create morph$/i}).click(),videoDone);
  const downloadPromise=page.waitForEvent('download',{timeout:30000});
  const saveStart=performance.now();await page.getByRole('button',{name:/^Save video$/i}).click();
  const download=await downloadPromise;await download.saveAs(profile+'/saved-synthetic-morph.mp4');
  report.savedVideo={elapsedMs:performance.now()-saveStart,bytes:(await stat(profile+'/saved-synthetic-morph.mp4')).size,downloadFailure:await download.failure()};
 }else{
 await step('cold-first-single-face',()=>generateOne(prefix+'-0'),faceDone);
 for(let i=1;i<=3;i++)await step('warm-single-face-'+i,()=>generateOne(prefix+'-'+i),faceDone);
 await step('repeat-original-same-session',()=>page.locator('[data-next-face="face-1"] button.next-face-generate').click(),faceDone);
 await step('generate-second-face',()=>page.locator('[data-next-face="face-2"] button.next-face-generate').click(),()=>{
  const i=document.querySelector('[data-next-face="face-2"] .next-face-image img');
  const e=document.querySelector('.next-error');if(e)throw Error(e.innerText);
  return i?.complete&&i.naturalWidth===1024&&!document.querySelector('.next-status progress')&&!document.querySelector('.next-face-active')&&!document.querySelector('.next-download-dialog');
 });
 report.morphSettings=await page.evaluate(()=>({note:'Default product loop; two faces, 16 frames per segment, 32 output frames, smooth figure-eight and pinched centre'}));
 await step('default-morph-to-playable-video',()=>page.getByRole('button',{name:'Create morph',exact:true}).click(),videoDone);
 await step('repeat-morph-to-playable-video',()=>page.getByRole('button',{name:'Create morph',exact:true}).click(),videoDone);
 await page.reload();await page.locator('.next-product').waitFor();await arm();await page.getByLabel('Processing mode').selectOption('webgpu');
 await step('repeat-original-after-reload',()=>generateOne(prefix+'-3'),faceDone);
 await step('warm-storage-new-face-after-reload',()=>generateOne(prefix+'-4'),faceDone);
 }
 report.loadAfter=execFileSync('uptime',{encoding:'utf8'}).trim();report.completed=true;
}catch(e){report.completed=false;report.failure=e.message.slice(0,300);}finally{await save();await context.close();}
console.log(JSON.stringify({completed:report.completed,failure:report.failure,steps:report.steps.map(({name,passed,elapsedMs,workers,video})=>({name,passed,elapsedMs,workers,video}))}));
if(!report.completed)process.exitCode=1;
