import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)('/home/cdilga/Work/runs/pw/node_modules/playwright');
const mode=process.argv[2]||'correctness',out=process.argv[3];if(!out)throw Error('Output path required');
const load=()=>Number(execFileSync('cat',['/proc/loadavg'],{encoding:'utf8'}).split(' ')[0]);
execFileSync('bash',['autoresearch/devices/eris/require-quiet-gpu.sh']);if(mode==='benchmark'&&load()>4)process.exit(75);
const server=spawn('python3',['autoresearch/candidates/direct-rgba-media-v1/serve.py','8739'],{stdio:'ignore'}),profile=await mkdtemp('/home/cdilga/Work/runs/raw-synthesis-');
const report={at:new Date().toISOString(),mode,scope:'Frozen source runtime/worker raw-frame screening, not compiled UI, fixed full31 reference or physical phone qualification',loadBefore:load(),sourceSnapshot:JSON.parse(await readFile('autoresearch/candidates/direct-rgba-media-v1/source-snapshot.json','utf8')),runs:[],errors:[]};let context;
try{
 for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:8739/autoresearch/candidates/direct-rgba-media-v1/raw-screen.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 context=await chromium.launchPersistentContext(profile,{executablePath:'/usr/bin/chromium',headless:true,viewport:{width:1024,height:768},args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--use-gl=angle','--disable-vulkan-surface']});
 const page=context.pages()[0];page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:8739/autoresearch/candidates/direct-rgba-media-v1/raw-screen.html');await page.waitForFunction(()=>!!window.rawBench,null,{timeout:30000});report.browser=await page.evaluate(()=>rawBench.info());report.manifestSha256=await page.evaluate(()=>rawBench.manifestSha256);
 if(!report.browser.adapter||/swiftshader|llvmpipe/i.test(JSON.stringify(report.browser.adapter)))throw Error('No verified hardware adapter');
 if(mode==='benchmark'){
  const correctness=JSON.parse(await readFile('autoresearch/candidates/direct-rgba-media-v1/correctness-raw.json','utf8'));
  if(!correctness.passed||JSON.stringify(correctness.sourceSnapshot.files)!==JSON.stringify(report.sourceSnapshot.files))throw Error('Matching raw correctness evidence required before timing');
  report.correctnessEvidence='correctness-raw.json';await page.evaluate(()=>rawBench.setMeasurement(true));
 }
 const order=mode==='benchmark'?Array.from({length:3},()=>['blob','raw','raw','blob']).flat():['blob','raw'];
 for(const variant of order){
  const run={variant};report.runs.push(run);run.qualification=await page.evaluate(v=>rawBench.start(v),variant);
  run.warmup=await page.evaluate(()=>rawBench.single(91));
  run.single=await page.evaluate(()=>rawBench.single(17));run.frames=await page.evaluate(()=>rawBench.frames(31));
 }
 const control=report.runs.find(r=>r.variant==='blob');for(const candidate of report.runs.filter(r=>r.variant==='raw')){
  if(mode!=='benchmark'){
   if(candidate.single.rawSha256!==control.single.rawSha256)throw Error('Single raw RGBA differs from PNG control');
   for(let i=0;i<31;i++)if(candidate.frames.outputs[i].rawSha256!==control.frames.outputs[i].rawSha256)throw Error('Raw RGBA differs at sample '+i);
  }
  if(candidate.frames.peakReservedRawBytes>8*1024*1024)throw Error('Encoding queue exceeded budget');
 }
 report.passed=report.errors.length===0;await page.screenshot({path:out.replace(/\.json$/,'.png')});await page.evaluate(()=>rawBench.dispose());
}catch(error){report.passed=false;report.errors.push(error.message);}finally{report.loadAfter=load();report.timingQualified=mode==='benchmark'&&report.loadBefore<=4&&report.loadAfter<=4;if(context)await context.close();server.kill();await writeFile(out,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,mode,timingQualified:report.timingQualified,errors:report.errors,runs:report.runs.map(r=>({variant:r.variant,single:r.single,frames:r.frames&&{n:r.frames.n,peakReservedRawBytes:r.frames.peakReservedRawBytes}}))}));if(!report.passed)process.exitCode=1;
