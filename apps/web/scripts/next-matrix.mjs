// Drives the same product workflow as the exact-artifact Chromium qualification, but through
// Playwright so Chromium, Firefox and WebKit can each be reported on their own row.
//
// An engine's row is evidence for that engine only. WebKit on Linux is the WebKit engine, not
// Safari on macOS or iOS; Chromium here is not Chrome on Android. Rows say which is which, and a
// stage that cannot run on an engine is recorded as unsupported with its reason, never skipped
// quietly and never counted as a pass.
//
// This runs against the deployed origin by default. The runtime's worker URLs are absolute and
// same-origin, so serving the artifact from somewhere else breaks worker construction on every engine;
// NEXT_MATRIX_LOCAL_PORT=<port> tunnels that origin through a job-owned CONNECT proxy on every engine.
// Exact-artifact CI uses scripts/ci/site/matrix-artifact.mjs to verify and own both the server and proxy;
// NEXT_MATRIX_PROXY passes its loopback endpoint here. The runtime digest records the actual bundle.
//
// Selectors follow the control's declared DOM contract (autoresearch/drivers/lib/journey.mjs): a face is
// `section.next-face` with `data-next-state`, each face has its own Generate and Choose photo controls, the
// product reports `data-next-busy`, Create morph is `.next-primary-action`. Stage outcomes and the row verdict
// are decided by next-matrix-stages.mjs. A stage whose control the artifact does not ship is
// `incomplete-not-shipped`, never a pass.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {classifyStage,encoderRan,hasRecoveryMetadata,rowVerdict,stageRecord} from './next-matrix-stages.mjs';
import {matrixProxy,startConnectProxy} from '../../../scripts/ci/site/matrix-artifact.mjs';

const engineName=process.argv[2];
const origin=process.env.NEXT_MATRIX_ORIGIN||'https://next.facemorph.me';
const out=path.resolve(process.env.NEXT_MATRIX_OUT||`next-matrix-${engineName}.json`);
const stageTimeout=Number(process.env.NEXT_MATRIX_STAGE_MS||900000);
const localPort=process.env.NEXT_MATRIX_LOCAL_PORT||'';
const photoFixture=new URL('../test/fixtures/next-matrix/photo-no-metadata.webp',import.meta.url);
if(!['chromium','firefox','webkit'].includes(engineName))throw Error('Usage: next-matrix.mjs <chromium|firefox|webkit>');
if((localPort||process.env.NEXT_MATRIX_PROXY)&&origin!=='https://next.facemorph.me')throw Error('Local matrix transport requires the production HTTPS origin');
if(localPort&&process.env.NEXT_MATRIX_PROXY)throw Error('Select one local matrix transport');

// Playwright lives in its own tree (scripts/matrix-tools) so the site's dependency resolution never changes for
// a test tool; when that tree is not installed, use apps/web's own playwright dependency.
const requireFrom=file=>createRequire(new URL(file,import.meta.url));
let playwrightFrom='scripts/matrix-tools';
let playwright;
try{playwright=requireFrom('./matrix-tools/package.json')('playwright');}
catch{playwrightFrom='apps/web';playwright=requireFrom('../package.json')('playwright');}
const {chromium,firefox,webkit}=playwright;
const engines={chromium,firefox,webkit};
const report={engine:engineName,origin,playwrightFrom,startedAt:new Date().toISOString(),passed:false,stages:{}};
if(process.env.NEXT_MATRIX_ARTIFACT_COMMIT||process.env.NEXT_MATRIX_ARTIFACT_DIGEST)report.artifact={commit:process.env.NEXT_MATRIX_ARTIFACT_COMMIT,digest:process.env.NEXT_MATRIX_ARTIFACT_DIGEST};

function record(name,data){report.stages[name]=data;console.log(JSON.stringify({stage:name,...data}));}
async function save(){await fs.writeFile(out,JSON.stringify(report,null,2));}
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');

/**
 * Runs a stage and records its outcome, decided by classifyStage. The report is written after every
 * stage: a slow engine can outlast its budget, and the stages that did pass are evidence worth keeping
 * rather than losing to the kill. A failure other than `unsupported` ends the row.
 */
async function stage(name,run,{optional=false}={}){
 const startedAt=Date.now();
 const seconds=()=>(Date.now()-startedAt)/1000;
 try{
  const data=await run();
  const outcome=classifyStage({data});
  record(name,stageRecord(outcome,{seconds:seconds(),...data}));
  await save();
  return data;
 }
 catch(error){
  const outcome=classifyStage({error,optional});
  record(name,stageRecord(outcome,{seconds:seconds(),reason:String(error?.message||error).slice(0,400)}));
  await save();
  if(outcome!=='unsupported')throw error;
  return null;
 }
}

// A persistent profile, not the default ephemeral context: an ephemeral one is capped near 1 GB
// of storage, which the model bundle exceeds, so every row would fail on the harness rather than
// on the engine. A real visitor's browser has orders of magnitude more, and the quota each row
// actually had is recorded below. ignoreHTTPSErrors covers a locally served origin.
const downloads=await fs.mkdtemp(path.join(process.env.RUNNER_TEMP||'/tmp','next-matrix-'));
const profile=await fs.mkdtemp(path.join(process.env.RUNNER_TEMP||'/tmp','next-matrix-profile-'));
const launchOptions={acceptDownloads:true,ignoreHTTPSErrors:true,viewport:{width:1280,height:960}};
const localProxy=localPort?await startConnectProxy(Number(localPort)):null;
if(localProxy||process.env.NEXT_MATRIX_PROXY)launchOptions.proxy=localProxy?.proxy||matrixProxy(process.env.NEXT_MATRIX_PROXY);
if(engineName==='chromium'){
 launchOptions.args=[...(process.env.NEXT_MATRIX_NO_SANDBOX?['--no-sandbox']:[])];
 if(process.env.NEXT_MATRIX_CHROMIUM)launchOptions.executablePath=process.env.NEXT_MATRIX_CHROMIUM;
}
const context=await engines[engineName].launchPersistentContext(profile,launchOptions).catch(async error=>{await localProxy?.stop();throw error;});
await context.tracing.start({screenshots:true,snapshots:true});
// Worker traffic and the control's own prompts, as autoresearch/drivers/lib/journey.mjs INSTRUMENT does: every
// message to and from a worker is recorded with its stage, so the photo stage can show the encoder really ran,
// and the consent toast, model toast and download dialog are answered the moment they show.
await context.addInitScript(()=>{
 window.__pair={events:[],workers:0,busyChanges:0,mark:0,markAt:0};
 const W=window.Worker;
 window.Worker=class extends W{
  constructor(...args){
   super(...args);window.__pair.workers++;
   this.addEventListener('message',({data:d})=>{if(d&&typeof d==='object')window.__pair.events.push({at:performance.now(),type:d.type,stage:d.stage,provider:d.provider});});
  }
  postMessage(m,...a){window.__pair.events.push({at:performance.now(),posted:m?.type});return super.postMessage(m,...a);}
 };
 window.addEventListener('DOMContentLoaded',()=>{
  new MutationObserver(()=>window.__pair.busyChanges++).observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-next-busy']});
  setInterval(()=>{
   document.querySelector('.next-download-dialog .next-download-accept')?.click();
   document.querySelector('.next-consent-toast button[aria-label="Ask me later"]')?.click();
   [...document.querySelectorAll('.next-model-toast button')].find(b=>b.textContent.trim()==='Not now')?.click();
  },30);
 });
});
const page=context.pages()[0]||await context.newPage();
page.on('console',message=>{if(message.type()==='error')report.consoleErrors=[...(report.consoleErrors||[]),message.text().slice(0,300)].slice(-20);});

const tile=i=>page.locator('section.next-face').nth(i);
const product=()=>page.locator('.next-product');
// Marks the busy counter before an action; a run is over when the product is idle after having gone busy (or
// after 2 s, for a cached face that never goes busy), the tile is in the wanted state, and nothing errored.
async function mark(){return page.evaluate(()=>{const p=window.__pair;p.mark=p.busyChanges;p.markAt=performance.now();return p.events.length;});}
async function settled(i,state='filled',{crop=false}={}){
 await page.waitForFunction(({i,state,crop})=>{
  const err=document.querySelector('.next-error');
  if(err?.innerText)throw Error(err.innerText);
  if(!crop&&document.querySelector('.next-crop-view'))throw Error('The crop dialog opened: this stage expects a face the detector finds');
  const p=window.__pair;
  return (p.busyChanges>p.mark||performance.now()-p.markAt>2000)&&document.querySelector('.next-product')?.getAttribute('data-next-busy')==='false'&&document.querySelectorAll('section.next-face')[i]?.getAttribute('data-next-state')===state;
 },{i,state,crop},{timeout:stageTimeout,polling:50});
}
/** Types text into a face's field and generates it with that face's own Generate control. */
async function generateFace(i,text){
 await tile(i).locator('.next-field input').fill(text);
 await mark();
 await tile(i).locator('.next-face-generate').click();
 await settled(i);
}
async function download(button){
 const [file]=await Promise.all([page.waitForEvent('download',{timeout:120000}),button.click()]);
 const target=path.join(downloads,`${Date.now()}-${file.suggestedFilename()}`);
 await file.saveAs(target);
 return target;
}
const saveImage=i=>tile(i).getByRole('button',{name:'Save image',exact:true});
const faceSize=i=>tile(i).evaluate(t=>{const x=t.querySelector('.next-face-image img:not([data-public-preview]), .next-face-image canvas[data-face-drawn="true"]');return x?{width:x.naturalWidth||x.width,height:x.naturalHeight||x.height}:null;});
const eventsSince=n=>page.evaluate(n=>window.__pair.events.slice(n),n);

// Failure evidence: a Playwright trace and a screenshot, kept next to the report.
async function keepEvidence(){
 const base=out.replace(/\.json$/,'');
 report.evidence={};
 await page.screenshot({path:`${base}.failure.png`,fullPage:true}).then(()=>{report.evidence.screenshot=`${base}.failure.png`;},error=>{report.evidence.screenshotError=String(error?.message||error).slice(0,200);});
 await context.tracing.stop({path:`${base}.trace.zip`}).then(()=>{report.evidence.trace=`${base}.trace.zip`;tracingStopped=true;},error=>{report.evidence.traceError=String(error?.message||error).slice(0,200);});
}
let tracingStopped=false;

try{
 await page.goto(origin,{waitUntil:'load',timeout:120000});
 await tile(1).waitFor({timeout:60000});
 await page.waitForFunction(()=>document.querySelector('.next-product')?.getAttribute('data-next-busy')==='false',null,{timeout:stageTimeout});
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

 // Force CPU: an engine without a qualified GPU route must still complete the workflow. The processing mode is under
 // More options > Advanced in the control and above the faces in the destination (fm-5kpx).
 await page.getByRole('button',{name:'More options',exact:true}).click();
 if(await page.locator('.next-advanced').count())await page.locator('.next-advanced').evaluate(e=>{e.open=true;});
 await page.getByLabel('Processing mode').selectOption('cpu');
 if(await page.getByLabel('Processing mode').inputValue()!=='cpu')throw Error('Could not select CPU processing');
 await page.keyboard.press('Escape');

 await stage('nameSeed',async()=>{
  await generateFace(0,'next-matrix-one');
  await generateFace(1,'next-matrix-two');
  const sizes=[await faceSize(0),await faceSize(1)];
  if(!sizes.every(s=>s&&s.width===1024&&s.height===1024))throw Error(`Expected two 1024 faces, saw ${JSON.stringify(sizes)}`);
  return {dimensions:sizes.map(s=>[s.width,s.height])};
 });

 const first=await download(saveImage(0));
 const firstHash=sha(await fs.readFile(first));
 await stage('repeatOriginal',async()=>{
  await mark();
  await tile(0).locator('.next-face-generate').click();
  await settled(0);
  const again=sha(await fs.readFile(await download(saveImage(0))));
  if(again!==firstHash)throw Error('A repeat of the same face produced different bytes');
  return {sha256:firstHash};
 });

 // An independent photo: a public preview face the app never produced, with no recovery metadata, so the encoder
 // must run. The evidence is the app's own worker events (encode request posted, encoder complete), not a hook.
 const photo=await fs.readFile(photoFixture);
 if(hasRecoveryMetadata(photo))throw Error('The photo fixture carries recovery metadata; it would bypass the encoder');
 await stage('photoE4e',async()=>{
  const from=await mark();
  await tile(1).locator('input[aria-label="Choose photo"]').setInputFiles({name:'next-matrix-photo.webp',mimeType:'image/webp',buffer:photo});
  // Photo mode is set while selection/encoding is still pending. Wait for the
  // actual reconstruction, not the earlier input-state transition.
  await tile(1).locator('.next-face-image img:not([data-public-preview]), .next-face-image canvas[data-face-drawn="true"]').waitFor({timeout:stageTimeout});
  await settled(1,'photo');
  const events=await eventsSince(from);
  if(!encoderRan(events))throw Error(`The photo did not run the encoder; worker events: ${JSON.stringify(events.map(e=>e.posted||e.stage).filter(Boolean))}`);
  const size=await faceSize(1);
  if(!size||size.width!==1024)throw Error('Photo reconstruction did not produce a 1024 face');
  const names=[...new Set(events.map(e=>e.posted||e.stage).filter(Boolean))];
  return {inputSha256:sha(photo),encoderEvents:names,posted:events.filter(e=>e.posted).map(e=>e.posted),stages:[...new Set(events.map(e=>e.stage).filter(Boolean))]};
 });

 await stage('localCrop',async()=>{
  // The photo face's own Crop photo control opens the crop dialog on the chosen photo.
  const from=await mark();
  await tile(1).getByRole('button',{name:'Crop photo',exact:true}).click();
  await page.waitForSelector('.next-crop-view img',{timeout:60000});
  // The whole square is kept: alignment rightly refuses a crop that cuts the face in half or
  // turns it on its side. Four right angles exercise the control and end upright.
  await page.locator('.next-crop-zoom input').fill('1');
  for(let turn=0;turn<4;turn++)await page.getByRole('button',{name:'Rotate',exact:true}).click();
  await page.getByRole('button',{name:'Use this crop',exact:true}).click();
  await page.waitForSelector('.next-crop-view',{state:'detached',timeout:60000});
  // Cropping does not own the busy flag, so idle alone is not the end: wait for the cropped file to be published as
  // the face's input, then for the product to be idle with no error and no reopened dialog. The whole square at
  // zoom 1 has the pixels of the photo already encoded in this profile, so the app may answer from its cache; the
  // encoder events are recorded, but this stage's claim is the crop control and its result, and photoE4e's is the encoder.
  await tile(1).locator('.next-file span',{hasText:'cropped.png'}).waitFor({timeout:60000});
  await page.waitForTimeout(3000);
  await page.waitForFunction(()=>{const err=document.querySelector('.next-error');if(err?.innerText)throw Error(err.innerText);return !document.querySelector('.next-crop-view')&&document.querySelector('.next-product')?.getAttribute('data-next-busy')==='false';},null,{timeout:stageTimeout,polling:250});
  const events=await eventsSince(from);
  const size=await faceSize(1);
  if(!size||size.width!==1024)throw Error('Generation from the crop did not produce a 1024 face');
  return {file:'cropped.png',encoderRanForCrop:encoderRan(events),posted:events.filter(e=>e.posted).map(e=>e.posted)};
 });

 await stage('projectSaveReopen',async()=>{
  // Project export and open sit behind `projectFilesVisible` in the retained app, off since 21 September
  // (operator), so the control is not on the surface. Calling that a pass would be the false confirmation
  // this lane exists to prevent. This reads the DOM today; it reads the TS flag from the project-JSON port
  // once that port exists. The stage qualifies itself again the day the control returns.
  const exportButton=page.getByRole('button',{name:'Export project',exact:true});
  if(!await page.locator('input[aria-label="Open project"]').count()||!await exportButton.count())
   return {notShipped:true,skipped:'Project export and open are not in this artifact (projectFilesVisible=false); ProjectJson round-trip is covered by apps/web/test/project/project-json.test.ts'};
  const file=await download(exportButton.first());
  const parsed=JSON.parse(await fs.readFile(file,'utf8'));
  if(parsed.morph.controls.length!==2||!parsed.morph.controls.every(c=>c.latent.values.length===9216))throw Error('Exported project does not carry two W+ latents');
  await mark();
  await page.locator('input[aria-label="Open project"]').setInputFiles(file);
  await page.waitForFunction(()=>document.querySelector('.next-product')?.getAttribute('data-next-busy')==='false',null,{timeout:stageTimeout});
  const states=await page.evaluate(()=>[...document.querySelectorAll('section.next-face')].map(s=>s.dataset.nextState));
  if(!states.every(v=>v==='project'))throw Error(`Reopened project left face states as ${JSON.stringify(states)}`);
  return {sha256:sha(await fs.readFile(file))};
 });

 // Exporting is checked on every engine. Playback is only checked where the build can decode
 // H.264 at all; where it cannot, the export is still verified and the skip is recorded with its
 // reason rather than being called a pass or blamed on the engine.
 await stage('morphExport',async()=>{
  const create=page.locator('.next-primary-action');
  const saveVideo=page.locator('.next-video-slot').getByRole('button',{name:'Save video',exact:true});
  if(!await create.count())return {notShipped:true,skipped:'Create morph is not in this artifact, so there is no video to export'};
  await mark();
  await create.click();
  await page.waitForFunction(()=>{
   const err=document.querySelector('.next-error');
   if(err?.innerText)throw Error(err.innerText);
   const v=document.querySelector('video.next-video');
   return v&&v.readyState>=2&&Number.isFinite(v.duration)&&document.querySelector('.next-product')?.getAttribute('data-next-busy')==='false';
  },null,{timeout:stageTimeout,polling:100});
  if(!await saveVideo.count())return {notShipped:true,skipped:'Save video is not in this artifact'};
  const file=await download(saveVideo);
  const bytes=await fs.readFile(file);
  if(bytes.length<1000||!bytes.subarray(0,32).includes(Buffer.from('ftyp')))throw Error('Saved video is not an MP4');
  return {bytes:bytes.length,sha256:sha(bytes)};
 });
 await stage('morphPlayback',async()=>{
  if(!await page.locator('video.next-video').count())return {notShipped:true,skipped:'There is no video element in this artifact to play'};
  if(!report.mp4Playback)return {skipped:'This browser build ships without H.264, so playback cannot be checked here',buildLimitation:true};
  const playback=await page.evaluate(async()=>{
   const video=document.querySelector('video.next-video');
   video.muted=true;
   await video.play();
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No decoded video frame')),30000);
    if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(()=>{clearTimeout(timer);resolve();});
    else video.addEventListener('timeupdate',function once(){if(video.currentTime>0){clearTimeout(timer);video.removeEventListener('timeupdate',once);resolve();}});});
   const result={width:video.videoWidth,height:video.videoHeight,duration:video.duration,time:video.currentTime};
   video.pause();
   return result;
  });
  if(playback.width!==1024||playback.height!==1024||!(playback.duration>0))throw Error(`Unexpected playback ${JSON.stringify(playback)}`);
  return playback;
 });
}catch(error){
 report.error=String(error?.message||error).slice(0,600);
}finally{
 // A row passes only when every stage in the shared list really passed. Stages the artifact does not ship,
 // or the build could not check, are listed and are not passes; a row that never reached a stage has it missing.
 const verdict=rowVerdict(report.stages);
 Object.assign(report,{passed:verdict.passed,status:verdict.status,failed:verdict.failed,unsupported:verdict.unsupported,missing:verdict.missing,incompleteNotShipped:verdict.incompleteNotShipped,notShipped:verdict.incompleteNotShipped,buildLimited:verdict.buildLimited});
 const ok=verdict.ok&&!report.error;
 if(!ok)await keepEvidence();
 report.finishedAt=new Date().toISOString();
 await save();
 if(!tracingStopped)await context.tracing.stop().catch(()=>{});
 await context.close();
 await localProxy?.stop();
 console.log(JSON.stringify({engine:engineName,passed:report.passed,status:report.status,failed:report.failed,incompleteNotShipped:report.incompleteNotShipped,buildLimited:report.buildLimited,mp4Playback:report.mp4Playback,error:report.error||'',report:out,evidence:report.evidence||null}));
 process.exit(ok?0:1);
}
