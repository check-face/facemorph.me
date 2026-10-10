// Exact-artifact CPU transfer screen. Run only through the research lease.
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {tmpdir,loadavg} from 'node:os';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'/home/cdilga/Work/runs/pw/node_modules/playwright');
const [controlArg,candidateArg,outArg]=process.argv.slice(2);
if(!outArg)throw Error('Usage: built-ui-paired.mjs control-artifact candidate-artifact output.json');
const repo=process.cwd(),out=resolve(outArg),pin='d9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c';
const artifacts={control:resolve(controlArg),candidate:resolve(candidateArg)},report={at:new Date().toISOString(),scope:'Paired exact built-UI Linux CPU screen; retained models and ordinary-user admission emulated explicitly. Not user analytics, hardware GPU, physical phone, compositor paint, total memory or OS share qualification.',policy:{webdriver:true,hostFullQualify:false,route:'cpu',network:'Pinned same-origin runtime mirror; no network-speed claim',samples:'fixed warmup per side, ABBA x3, six observations per side',boundaries:'action to full1024 drawn canvas/decoded image and idle; decoded playable32-frame video; browser download complete'},artifacts:{},samples:[],errors:[],loadBefore:loadavg(),harnessSha256:createHash('sha256').update(await readFile(import.meta.filename)).digest('hex')};
if(loadavg()[0]>4)throw Error('Contended host: measurement refused');
const work=await mkdtemp(tmpdir()+'/facemorph-built-paired-'),profiles={control:work+'/control-profile',candidate:work+'/candidate-profile'};
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',work+'/key','-out',work+'/crt','-days','1','-subj','/CN=next.facemorph.me'],{stdio:'ignore'});
for(const [side,root] of Object.entries(artifacts))report.artifacts[side]={source:(await readFile(root+'/next-site-source.txt','utf8')).trim(),artifactReceiptSha256:createHash('sha256').update(await readFile(root+'/next-site-SHA256SUMS')).digest('hex'),runtimeManifestSha256:pin};
const save=()=>writeFile(out,JSON.stringify(report,null,2)+'\n');
const fixture=await readFile('src/public/preview/hello-1024.webp');report.fixture={sha256:createHash('sha256').update(fixture).digest('hex'),dimensions:[1024,1024],provenance:'Public API hello preview; unique ignored RIFF chunk per sample; same decoded photo pixels, no recovery metadata'};
function photo(caseId,which){const nonce=Buffer.from('paired-photo-'+caseId+'-'+which),chunk=Buffer.alloc(8+nonce.length+(nonce.length&1));chunk.write('CIUN');chunk.writeUInt32LE(nonce.length,4);nonce.copy(chunk,8);const bytes=Buffer.concat([fixture,chunk]);bytes.writeUInt32LE(bytes.length-8,4);return {name:'synthetic-public-photo.webp',mimeType:'image/webp',buffer:bytes};}
async function one(side,caseId,warmup=false){
 if(loadavg()[0]>4)throw Error('Contention during paired run: measurement refused');
 const root=artifacts[side],server=spawn('python3',[repo+'/scripts/next-e2e-server.py','--manifest-sha',pin,'--runtime-overlay',repo+'/hosting/next-static/runtime-overlay','--runtime-files',repo+'/.runtime-public','--cert',work+'/crt','--key',work+'/key'],{cwd:root,stdio:['ignore','ignore','pipe']});let context;const entry={side,caseId,warmup,loadBefore:loadavg(),steps:[]};report.samples.push(entry);await save();
 try{
  await new Promise((resolve,reject)=>{let pending='';server.stderr.on('data',d=>{pending+=d;if(pending.includes('Serving exact'))resolve();});server.on('exit',code=>reject(Error('Server startup exit '+code+': '+pending)));setTimeout(resolve,1500);});
  context=await chromium.launchPersistentContext(profiles[side],{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,viewport:{width:1280,height:960},ignoreHTTPSErrors:true,args:['--no-sandbox','--ignore-certificate-errors','--no-proxy-server','--host-resolver-rules=MAP next.facemorph.me:443 127.0.0.1:8443']});
  await context.addInitScript(()=>{
   window.__FACEMORPH_FULL_QUALIFY__=false;
   window.__pair={events:[],workers:0,previewMs:null,restoredMs:null};
   const W=window.Worker;window.Worker=class extends W{constructor(...args){super(...args);window.__pair.workers++;this.addEventListener('message',({data:d})=>{if(d&&typeof d==='object')window.__pair.events.push({at:performance.now(),type:d.type,stage:d.stage,elapsedMs:d.elapsedMs,provider:d.provider,routeOutcome:d.routeOutcome});});}postMessage(m,...a){window.__pair.events.push({at:performance.now(),posted:m?.type});return super.postMessage(m,...a);}};
   document.addEventListener('load',e=>{const i=e.target;if(i instanceof HTMLImageElement&&i.complete){if(i.dataset.publicPreview!==undefined&&i.naturalWidth===1024&&window.__pair.previewMs===null)window.__pair.previewMs=performance.now();if(i.closest('.next-face-image')&&i.dataset.publicPreview===undefined&&i.naturalWidth===1024&&window.__pair.restoredMs===null)window.__pair.restoredMs=performance.now();}},true);
   window.addEventListener('DOMContentLoaded',()=>{setInterval(()=>document.querySelector('.next-download-dialog .next-download-accept')?.click(),30);});
  });
  const page=context.pages()[0];page.on('pageerror',error=>entry.pageErrors=(entry.pageErrors||[]).concat(error.message));
  await page.goto('https://next.facemorph.me/');await page.locator('.next-product').waitFor();
  const source=await page.evaluate(async()=> (await fetch('/')).headers.get('X-Next-Artifact-Source'));if(source!==report.artifacts[side].source)throw Error('Wrong served artifact');
  await page.locator('.next-consent-toast button[aria-label="Ask me later"]').click().catch(()=>{});
  await page.waitForFunction(()=>window.__pair.previewMs!==null||window.__pair.restoredMs!==null,null,{timeout:30000});
  if(!warmup)await page.waitForFunction(()=>window.__pair.restoredMs!==null,null,{timeout:30000});
  entry.navigation=await page.evaluate(()=>({previewDecodedMs:window.__pair.previewMs,restoredDecodedMs:window.__pair.restoredMs,workers:window.__pair.workers,visibility:document.visibilityState,userAgent:navigator.userAgent,webdriver:navigator.webdriver,isolation:crossOriginIsolated,scripts:[...document.scripts].map(s=>s.src).filter(Boolean)}));
  report.artifacts[side].liveScripts=entry.navigation.scripts;
  if(entry.navigation.visibility!=='visible'||!entry.navigation.isolation)throw Error('Invalid visible/isolation state');
  await page.getByRole('button',{name:'More options',exact:true}).click();await page.locator('.next-advanced').evaluate(e=>e.open=true);await page.getByLabel('Processing mode').selectOption('cpu');
  const faceDone=id=>({id});
  async function waitFace(id){await page.waitForFunction(({id})=>{const err=document.querySelector('.next-error');if(err)throw Error(err.innerText);const tile=document.querySelector('[data-next-face="'+id+'"]'),i=tile?.querySelector('img:not([data-public-preview])'),c=tile?.querySelector('canvas[data-face-drawn="true"]');return ((i?.complete&&i.naturalWidth===1024)||(c?.width===1024&&c.height===1024))&&!document.querySelector('.next-status progress')&&!document.querySelector('.next-face-active')&&!document.querySelector('.next-download-dialog');},faceDone(id),{timeout:240000,polling:10});}
  async function step(name,action,done){const before=await page.evaluate(()=>({at:performance.now(),n:window.__pair.events.length,w:window.__pair.workers}));const s={name};entry.steps.push(s);await save();await action();await done();Object.assign(s,await page.evaluate(({at,n,w})=>({ms:performance.now()-at,newWorkers:window.__pair.workers-w,events:window.__pair.events.slice(n).map(e=>({...e,at:e.at-at})),route:document.querySelector('.next-route-caption')?.innerText||''}),before));s.passed=true;await save();return s;}
  async function generate(id,value){const tile=page.locator('[data-next-face="'+id+'"]');await tile.locator('input[type=text]').fill('paired-media-'+value);await step('new-face-'+id,()=>tile.locator('.next-face-generate').click(),()=>waitFace(id));}
  await generate('face-1',71000+caseId*4);await generate('face-2',71001+caseId*4);
  async function download(name,tile='face-1'){let file;const s=await step(name,async()=>{const pending=page.waitForEvent('download',{timeout:60000});await page.locator('[data-next-face="'+tile+'"] button').filter({hasText:/^Save image$/}).click();file=await pending;},async()=>{if(await file.failure())throw Error(await file.failure());});const bytes=await readFile(await file.path());s.bytes=bytes.length;s.sha256=createHash('sha256').update(bytes).digest('hex');s.filename=file.suggestedFilename();return s;}
  const first=await download('first-download');
  const tile=page.locator('[data-next-face="face-1"]');await step('repeat-original',()=>tile.locator('.next-face-generate').click(),()=>waitFace('face-1'));
  const repeat=await download('repeat-download');if(first.sha256!==repeat.sha256)throw Error('Repeat file changed');
  await step('video32',()=>page.getByRole('button',{name:'Create morph',exact:true}).click(),()=>page.waitForFunction(()=>{const err=document.querySelector('.next-error');if(err)throw Error(err.innerText);const v=document.querySelector('.next-video-slot video');return v?.readyState>=2&&v.videoWidth===1024&&v.videoHeight===1024&&Number.isFinite(v.duration)&&Math.abs(v.duration-2)<.05&&!document.querySelector('.next-status progress');},null,{timeout:300000,polling:10}));
  entry.video=await page.locator('.next-video-slot video').evaluate(v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration,readyState:v.readyState}));
  // Photo warmup creates retained photo assets on each side; subsequent samples measure
  // the first photo session after reload and the next photo, never an original-cache hit.
  for(const which of ['first','next'])await step('photo-'+which,()=>page.locator('[data-next-face="face-2"] input[aria-label="Choose photo"]').setInputFiles(photo(caseId,which)),()=>waitFace('face-2'));
  await download('photo-download','face-2');
  entry.passed=!entry.pageErrors?.length;entry.loadAfter=loadavg();if(!entry.passed)throw Error('Browser page errors');
 }finally{if(context)await context.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));await save();}
}
try{await mkdir(resolve(out,'..'),{recursive:true});await one('control',-1,true);await one('candidate',-1,true);for(let block=0;block<3;block++)for(const [j,side] of ['control','candidate','candidate','control'].entries())await one(side,block*2+(j>=2?1:0));report.passed=true;}catch(error){report.passed=false;report.errors.push(error.message);}finally{report.finishedAt=new Date().toISOString();report.loadAfter=loadavg();await save();}
console.log(JSON.stringify({passed:report.passed,samples:report.samples.length,errors:report.errors}));if(!report.passed)process.exitCode=1;
