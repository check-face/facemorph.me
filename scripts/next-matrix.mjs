// Drives the same product workflow as the exact-artifact Chromium qualification, but through
// Playwright so Chromium, Firefox and WebKit can each be reported on their own row.
//
// An engine's row is evidence for that engine only. WebKit on Linux is the WebKit engine, not
// Safari on macOS or iOS; Chromium here is not Chrome on Android. Rows say which is which, and a
// stage that cannot run on an engine is recorded as unsupported with its reason, never skipped
// quietly and never counted as a pass.
//
// This runs against the deployed origin rather than a local copy of the bytes. The runtime's
// worker URLs are absolute and same-origin, so serving the artifact from somewhere else breaks
// worker construction on every engine; only Chrome can be told to resolve the real hostname
// locally, which is what the byte-exact qualification does. Pairing the two keeps both honest:
// that one proves the exact artifact, this one proves the deployed site across engines, and the
// runtime manifest digest below records which bundle was actually live.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const engineName=process.argv[2];
const origin=process.env.NEXT_MATRIX_ORIGIN||'https://next.facemorph.me';
const out=process.env.NEXT_MATRIX_OUT||`next-matrix-${engineName}.json`;
const stageTimeout=Number(process.env.NEXT_MATRIX_STAGE_MS||900000);
if(!['chromium','firefox','webkit'].includes(engineName))throw Error('Usage: next-matrix.mjs <chromium|firefox|webkit>');

// Playwright lives in its own tree so the site's dependency resolution never changes for a
// test tool; resolve it from there rather than from the repository's node_modules.
const {chromium,firefox,webkit}=createRequire(new URL('./matrix-tools/package.json',import.meta.url))('playwright');
const engines={chromium,firefox,webkit};
const report={engine:engineName,origin,startedAt:new Date().toISOString(),passed:false,stages:{}};

function record(name,data){report.stages[name]=data;console.log(JSON.stringify({stage:name,...data}));}
async function save(){await fs.writeFile(out,JSON.stringify(report,null,2));}
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');

/**
 * Runs a stage, recording an unsupported result rather than failing the whole row. The report is
 * written after every stage: a slow engine can outlast its budget, and the stages that did pass
 * are evidence worth keeping rather than losing to the kill.
 */
async function stage(name,run,{optional=false}={}){
 const startedAt=Date.now();
 try{
  const data=await run();
  // A stage the build could not exercise is not a pass. It is recorded, it counts against the
  // row, and it is never allowed to stand in for evidence that was never collected.
  // A control the artifact does not ship is the same shape of non-evidence: recorded, never
  // counted as a pass, and never allowed to stand in for a check that could not run.
  const verified=!(data&&(data.buildLimitation||data.notShipped));
  record(name,{passed:verified,seconds:(Date.now()-startedAt)/1000,...data});
  await save();
  return data;
 }
 catch(error){
  const unsupported=optional&&/not supported|unsupported|no decoder|NotSupportedError|is not a function|undefined is not an object/i.test(String(error?.message));
  record(name,{passed:false,unsupported,seconds:(Date.now()-startedAt)/1000,reason:String(error?.message||error).slice(0,400)});
  await save();
  if(!unsupported)throw error;
  return null;
 }
}

// A persistent profile, not the default ephemeral context: an ephemeral one is capped near 1 GB
// of storage, which the model bundle exceeds, so every row would fail on the harness rather than
// on the engine. A real visitor's browser has orders of magnitude more, and the quota each row
// actually had is recorded below. ignoreHTTPSErrors covers a locally served origin.
const downloads=await fs.mkdtemp(path.join(process.env.RUNNER_TEMP||'/tmp','next-matrix-'));
const profile=await fs.mkdtemp(path.join(process.env.RUNNER_TEMP||'/tmp','next-matrix-profile-'));
const context=await engines[engineName].launchPersistentContext(profile,{acceptDownloads:true,ignoreHTTPSErrors:true});
const page=context.pages()[0]||await context.newPage();
page.on('console',message=>{if(message.type()==='error')report.consoleErrors=[...(report.consoleErrors||[]),message.text().slice(0,300)].slice(-20);});

const control=name=>page.getByRole('button',{name,exact:true}).first();
async function download(name){
 const [file]=await Promise.all([page.waitForEvent('download',{timeout:120000}),control(name).click()]);
 const target=path.join(downloads,`${Date.now()}-${file.suggestedFilename()}`);
 await file.saveAs(target);
 return target;
}
async function idle(){
 await page.waitForFunction(()=>!document.querySelector('.next-status progress')&&[...document.querySelectorAll('button')].some(b=>b.textContent==='Generate faces'&&!b.disabled),null,{timeout:stageTimeout});
}
async function generate(name='Generate faces'){
 await control(name).click();
 await page.waitForTimeout(250);
 await idle();
 const error=await page.evaluate(()=>document.querySelector('.next-error')?.innerText||'');
 if(error)throw Error(error);
}
const faces=()=>page.evaluate(()=>[...document.querySelectorAll('.next-face-image img')].map(i=>({width:i.naturalWidth,height:i.naturalHeight})));

try{
 await page.goto(origin,{waitUntil:'load',timeout:120000});
 // Close the trial-phase reporting toast without answering it; it can cover a click target.
 await page.waitForTimeout(1000);await page.evaluate(()=>{const b=document.querySelector('.next-consent-toast button[aria-label="Ask me later"]');if(b)b.click();});
 await page.evaluate(()=>{if(!window.__ciGate){window.__ciGate=0;setInterval(()=>{const b=document.querySelector('.next-download-dialog .next-download-accept');if(b){window.__ciGate++;b.click();}},250);}});
 await idle();
 report.agent=await page.evaluate(()=>navigator.userAgent);
 report.storageQuota=await page.evaluate(()=>navigator.storage&&navigator.storage.estimate?navigator.storage.estimate().then(e=>e.quota).catch(()=>null):null);
 // Playwright's Chromium and WebKit builds ship without proprietary codecs, so they cannot play
 // an H.264 MP4 that the shipping browser plays perfectly well. That is a property of the test
 // build, not of the engine or the product, and the two must not be reported as the same thing.
 report.mp4Playback=await page.evaluate(()=>document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"')||'');
 // Record the bundle this row actually exercised, so a row cannot be read against another build.
 report.runtimeSha256=await page.evaluate(async()=>{
  const response=await fetch('/runtime/manifest.json',{cache:'no-cache'});
  const raw=await response.arrayBuffer();
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
 });
 if(process.env.NEXT_MATRIX_RUNTIME_SHA&&report.runtimeSha256!==process.env.NEXT_MATRIX_RUNTIME_SHA)throw Error(`Deployed runtime ${report.runtimeSha256} is not the expected bundle`);
 report.crossOriginIsolated=await page.evaluate(()=>crossOriginIsolated);
 if(!report.crossOriginIsolated)throw Error('Production isolation headers missing');

 // Force CPU: an engine without a qualified GPU route must still complete the workflow.
 await page.evaluate(()=>{document.querySelector('.next-advanced').open=true;});
 await page.selectOption('select[aria-label="Processing mode"]','cpu');
 if(await page.inputValue('select[aria-label="Processing mode"]')!=='cpu')throw Error('Could not select CPU processing');

 await stage('nameSeed',async()=>{
  await generate();
  const images=await faces();
  if(images.length!==2||!images.every(i=>i.width===1024&&i.height===1024))throw Error(`Expected two 1024 faces, saw ${JSON.stringify(images)}`);
  return {dimensions:images.map(i=>[i.width,i.height])};
 });

 const first=await download('Save image');
 const firstHash=sha(await fs.readFile(first));
 await stage('repeatOriginal',async()=>{
  await generate();
  const again=sha(await fs.readFile(await download('Save image')));
  if(again!==firstHash)throw Error('A repeat of the same face produced different bytes');
  return {sha256:firstHash};
 });

 await stage('photoE4e',async()=>{
  await page.setInputFiles('input[aria-label="Choose photo"]',first);
  await page.waitForFunction(()=>document.querySelector('select[aria-label="Face source"]').value==='photo',null,{timeout:120000});
  await generate();
  const images=await faces();
  if(images.length!==2||!images.every(i=>i.width===1024))throw Error('Photo reconstruction did not produce two 1024 faces');
  return {inputSha256:firstHash};
 });

 await stage('localCrop',async()=>{
  await control('Crop photo').click();
  await page.waitForSelector('.next-crop-view img',{timeout:60000});
  // The whole square is kept: alignment rightly refuses a crop that cuts the face in half or
  // turns it on its side. Four right angles exercise the control and end upright.
  await page.locator('.next-crop-zoom input').fill('1');
  for(let turn=0;turn<4;turn++)await control('Rotate').click();
  await control('Use this crop').click();
  await page.waitForSelector('.next-crop-view',{state:'detached',timeout:60000});
  await idle();
  const chosen=await page.evaluate(()=>document.querySelector('.next-file span')?.textContent||'');
  if(chosen!=='cropped.png')throw Error(`Crop did not replace the photo, saw ${chosen}`);
  await generate();
  const images=await faces();
  if(!images.every(i=>i.width===1024))throw Error('Generation from the crop did not produce 1024 faces');
  return {file:chosen};
 });

 await stage('projectSaveReopen',async()=>{
  // Project export and open sit behind `projectFilesVisible` in Product.fs, off since
  // 21 September (operator). There is nothing on the surface to drive, and calling that a pass
  // would be the false confirmation this lane exists to prevent. The round trip stays covered by
  // src/Next/verify-fable.mjs, and this stage qualifies itself again the day the control returns.
  if(!await page.evaluate(()=>!!document.querySelector('input[aria-label="Open project"]')))
   return {notShipped:true,skipped:'Project export and open are not in this artifact (Product.fs projectFilesVisible=false); ProjectJson round-trip is covered by src/Next/verify-fable.mjs'};
  const file=await download('Export project');
  const parsed=JSON.parse(await fs.readFile(file,'utf8'));
  if(parsed.morph.controls.length!==2||!parsed.morph.controls.every(c=>c.latent.values.length===9216))throw Error('Exported project does not carry two W+ latents');
  await page.setInputFiles('input[aria-label="Open project"]',file);
  await idle();
  const sources=await page.evaluate(()=>[...document.querySelectorAll('select[aria-label="Face source"]')].map(s=>s.value));
  if(!sources.every(v=>v==='project'))throw Error(`Reopened project left face sources as ${JSON.stringify(sources)}`);
  return {sha256:sha(await fs.readFile(file))};
 });

 // Exporting is checked on every engine. Playback is only checked where the build can decode
 // H.264 at all; where it cannot, the export is still verified and the skip is recorded with its
 // reason rather than being called a pass or blamed on the engine.
 await stage('morphExport',async()=>{
  await generate('Create morph');
  await page.waitForSelector('.next-result video',{timeout:stageTimeout});
  const file=await download('Save video');
  const bytes=await fs.readFile(file);
  if(bytes.length<1000||!bytes.subarray(0,32).includes(Buffer.from('ftyp')))throw Error('Saved video is not an MP4');
  return {bytes:bytes.length,sha256:sha(bytes)};
 });
 await stage('morphPlayback',async()=>{
  if(!report.mp4Playback)return {skipped:'This browser build ships without H.264, so playback cannot be checked here',buildLimitation:true};
  const playback=await page.evaluate(async()=>{
   const video=document.querySelector('.next-result video');
   video.muted=true;
   await video.play();
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No decoded video frame')),30000);
    if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(()=>{clearTimeout(timer);resolve();});
    else video.addEventListener('timeupdate',function once(){if(video.currentTime>0){clearTimeout(timer);video.removeEventListener('timeupdate',once);resolve();}});});
   const result={width:video.videoWidth,height:video.videoHeight,duration:video.duration,time:video.currentTime};
   video.pause();
   return result;
  });
  if(playback.width!==512||!(playback.duration>0))throw Error(`Unexpected playback ${JSON.stringify(playback)}`);
  return playback;
 });

 // A stage whose control is not in the artifact leaves the requirement with its reason on the
 // record; it is neither a failure of this engine nor evidence that anything was checked.
 const required=['nameSeed','repeatOriginal','photoE4e','localCrop','projectSaveReopen','morphExport','morphPlayback']
  .filter(name=>!report.stages[name]?.notShipped);
 report.notShipped=Object.entries(report.stages).filter(([,v])=>v.notShipped).map(([k])=>k);
 report.buildLimited=Object.entries(report.stages).filter(([,v])=>v.buildLimitation).map(([k])=>k);
 report.failed=required.filter(name=>!report.stages[name]?.passed&&!report.stages[name]?.buildLimitation);
 // Complete means every required stage was actually verified here. A row that could not check a
 // stage is incomplete, not passed, however good the stages around it look.
 report.passed=required.every(name=>report.stages[name]?.passed);
}catch(error){
 report.error=String(error?.message||error).slice(0,600);
}finally{
 report.finishedAt=new Date().toISOString();
 await save();
 await context.close();
 console.log(JSON.stringify({engine:engineName,passed:report.passed,failed:report.failed||[],buildLimited:report.buildLimited||[],mp4Playback:report.mp4Playback,error:report.error||''}));
 process.exit(report.passed?0:1);
}
