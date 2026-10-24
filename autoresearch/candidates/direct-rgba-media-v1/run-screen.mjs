// Requires the cooperative eris lease. correctness-only is allowed under contention;
// benchmark mode refuses a contended host before collecting any samples.
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'/home/cdilga/Work/runs/pw/node_modules/playwright');
const mode=process.argv[2]||'correctness',out=process.argv[3];if(!out||!['correctness','benchmark'].includes(mode))throw Error('Usage: run-screen.mjs correctness|benchmark output.json');
const load=()=>Number(execFileSync('cat',['/proc/loadavg'],{encoding:'utf8'}).split(' ')[0]);
if(mode==='benchmark'&&load()>4){console.error('Host contended; no benchmark started.');process.exit(75);}
const server=spawn('python3',['autoresearch/candidates/direct-rgba-media-v1/serve.py','8739'],{stdio:'ignore'});
const report={at:new Date().toISOString(),scope:'Component image/video codec screen; no model or compiled product UI; not full31 or physical phone qualification',mode,loadBefore:load(),fixtures:[],images:[],videos:[],errors:[],sourceHashes:{}};
for(const name of ['control-png.mjs','control-video-worker.mjs','realtime-video-worker.mjs','encode-worker.mjs','encode-client.mjs','recovery.mjs','screen.mjs'])report.sourceHashes[name]=createHash('sha256').update(await readFile('autoresearch/candidates/direct-rgba-media-v1/'+name)).digest('hex');
const profile=await mkdtemp(tmpdir()+'/checkface-rgba-screen-');let context;
try{
 for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:8739/autoresearch/candidates/direct-rgba-media-v1/screen.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,viewport:{width:1024,height:768},args:['--no-sandbox']});
 const page=context.pages()[0];page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:8739/autoresearch/candidates/direct-rgba-media-v1/screen.html');await page.waitForFunction(()=>Boolean(window.screenBench),null,{timeout:30000});report.browser=await page.evaluate(()=>screenBench.info());
 const fixtures=process.env.SCREEN_FIXTURES?JSON.parse(process.env.SCREEN_FIXTURES):['/src/public/preview/hello-1024.webp'];
 for(const fixture of fixtures){
  let facts;try{facts=await page.evaluate(path=>screenBench.load(path),fixture);}catch(error){report.fixtures.push({path:fixture,error:error.message});continue;}report.fixtures.push(facts);
  if(mode==='correctness'){
   for(const [path,format] of [['blob','png'],['direct','png'],['direct','webp']]){const result=await page.evaluate(([path,format])=>screenBench.imageCase(path,format),[path,format]);report.images.push({fixture:fixture,...result,qualification:'correctness_only_not_timing'});}
  }else{
   // Fixed warmup, then two independent questions in alternating ABBA ×3 order.
   await page.evaluate(()=>screenBench.imageCase('blob','png'));await page.evaluate(()=>screenBench.imageCase('direct','png'));
   for(let pair=0;pair<3;pair++)for(const path of ['blob','direct','direct','blob'])report.images.push({fixture,pair,...await page.evaluate(path=>screenBench.imageCase(path,'png'),path)});
   await page.evaluate(()=>screenBench.imageCase('direct','webp'));
   for(let pair=0;pair<3;pair++)for(const format of ['png','webp','webp','png'])report.images.push({fixture,pair,...await page.evaluate(format=>screenBench.imageCase('direct',format),format)});
  }
 }
 await page.evaluate(()=>screenBench.load('/src/public/preview/hello-1024.webp'));
 if(mode==='benchmark'){await page.evaluate(()=>screenBench.videoCase('quality','png'));await page.evaluate(()=>screenBench.videoCase('quality','raw'));await page.evaluate(()=>screenBench.videoCase('realtime','raw'));}
 const cases=mode==='correctness'?[['quality','png'],['quality','raw'],['realtime','raw']]:Array.from({length:3},(_,pair)=>[['quality','png'],['quality','raw'],['quality','raw'],['quality','png']].map(x=>[...x,pair])).flat();
 for(const [config,input,pair] of cases)report.videos.push({pair,...await page.evaluate(([config,input])=>screenBench.videoCase(config,input),[config,input]),...(mode==='correctness'?{qualification:'correctness_only_not_timing'}:{})});
 if(mode==='benchmark')for(let pair=0;pair<3;pair++)for(const config of ['quality','realtime','realtime','quality'])report.videos.push({pair,...await page.evaluate(config=>screenBench.videoCase(config,'raw'),config)});
 await page.screenshot({path:out.replace(/\.json$/,'.png')});report.passed=report.errors.length===0&&report.fixtures.every(x=>!x.error)&&report.images.length>0&&report.videos.length>0&&report.images.every(x=>x.decoded&&x.recovered)&&report.videos.every(x=>!x.skipped&&x.decodedWidth===1024);
}catch(error){report.passed=false;report.errors.push(error.message);}finally{report.loadAfter=load();report.timingQualified=mode==='benchmark'&&report.loadBefore<=4&&report.loadAfter<=4;if(context)await context.close();server.kill();await writeFile(out,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,mode,loadBefore:report.loadBefore,loadAfter:report.loadAfter,timingQualified:report.timingQualified,errors:report.errors,images:report.images.map(x=>({fixture:x.fixture,format:x.format,totalBytes:x.totalBytes,decoded:x.decoded,recovered:x.recovered})),videos:report.videos.map(x=>({mode:x.mode,input:x.input,decodedWidth:x.decodedWidth,duration:x.duration,skipped:x.skipped}))}));
if(!report.passed)process.exitCode=1;
