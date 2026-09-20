# Executed by browser-harness, which supplies js/cdp/new_tab/click_at_xy helpers.
# C-08 parity harness: one fixed latent runs through (a) the shipped bundle's synthesis on the
# CPU route — driven through the real product UI on the served built site — and (b) the bench,
# the pinned ORT runtime plus the manifest synthesis model loaded directly in a module worker on
# the same browser, same device, same served origin. The report emits benchMs, productMs and a
# per-stage decomposition; every difference row beyond noise must map to a named
# autoresearch/results.tsv entry (../autoresearch/results.tsv relative to facemorph.me) or the
# check fails. Scope: CPU engine only — CI has no GPU.
#
# The fixed latent is never assumed: the shipped bundle's own generate response carries the
# exact W+ values its synthesis consumed (worker protocol `complete.result.values`, [1,18,512]).
# The harness captures those bytes at the runtime boundary, digests them, and feeds the same
# bytes to the bench, which independently digests what it received. Equal digests are the proof
# that one fixed latent went through both.
import hashlib,json,os,sys,time
from pathlib import Path

out=Path('next-parity-evidence');out.mkdir(exist_ok=True)
# CI maps next.facemorph.me:443 to the local TLS server, so the page origin is the production
# one and every byte is served locally. On a developer Mac where Chrome ignores
# --host-resolver-rules, PARITY_ORIGIN=https://127.0.0.1:8443 runs the same harness against the
# same local UI bytes and the same pinned /runtime/ proxy; runtime asset URLs then resolve to
# the pinned public origin instead, which the product and the bench both verify by sha256.
ORIGIN=os.environ.get('PARITY_ORIGIN') or 'https://next.facemorph.me'
LEDGER=Path('../autoresearch/results.tsv')
result={'passed':False,'checks':{},'scope':'CPU engine only (pinned ORT wasm); CI has no GPU, so no webgpu/webgl row is claimed. Product side is the shipped bundle driven through the real UI (Processing mode cpu) on the exact served artifact; bench side is the same pinned ORT runtime and the same manifest synthesis model loaded directly in a module worker on the same browser and device. Parity here is timing decomposition of the synthesis pipeline; numerical correctness is separate canary evidence (C-01/C-03). Shared-runner timings are diagnostic.',
 'runtimeSha256':os.environ['RUNTIME_SHA']}
# Every decomposition row the harness knows how to interpret. A stage appearing in the product
# progress stream that is not listed here fails the check: a new product stage is a new
# overhead row, and an overhead with no ledger entry fails the gate.
# 'synthesis-inference' deliberately maps to nothing: it is the equality row. If the shipped
# synthesis drifts from the bench beyond noise, that is a regression no ledger entry may excuse.
LEDGER_MAP={
 'acquisition-and-boot':'parity-acquisition-overhead',
 'model-load-and-session':'parity-model-load-overhead',
 'canary-qualification':'parity-canary-qualification',
 'mapping-projection':'parity-mapping-projection',
 'synthesis-inference':None,
 'png-encode-and-delivery':'parity-png-encode',
}
STAGE_VOCABULARY={'asset-acquisition','runtime-loading','model-loading','model-loaded','mapping-loading','mapping','canary','synthesis','synthesis-complete'}
# CPU inference on shared runners is noisy; 20% with a 1 s floor bounds scheduler jitter without
# excusing a real regression. Fixed and honest: never widened to make a run green.
SYNTHESIS_NOISE_FLOOR_MS=1000.0;SYNTHESIS_NOISE_FRACTION=0.20

def ledger_ids():
 # Canonical ledger is ../autoresearch/results.tsv relative to facemorph.me (local research
 # workspace). CI checks out only this repo, so a snapshot is vendored at
 # scripts/next-parity-ledger.tsv and must be regenerated whenever the canonical ledger gains
 # or changes a mapped entry. When both are readable they must agree on every mapped entry.
 env=os.environ.get('PARITY_LEDGER')
 candidates=[Path(env)] if env else [LEDGER,Path('scripts/next-parity-ledger.tsv')]
 present=[c for c in candidates if c.exists()]
 if not present:raise RuntimeError('No parity ledger found (looked at: %s)'%', '.join(map(str,candidates)))
 ids=set()
 for path in present:
  for line in path.read_text().splitlines()[1:]:
   if line.strip():ids.add(line.split('\t')[0])
 if len(present)>1:
  for path in present:
   for entry in {v for v in LEDGER_MAP.values() if v}:
    if entry not in {l.split('\t')[0] for l in path.read_text().splitlines()[1:] if l.strip()}:
     raise RuntimeError('Mapped ledger entry %s missing from %s; regenerate the snapshot from the canonical ledger'%(entry,path))
 result['ledgerFile']=str(present[0])
 return ids

def parity_check(rows,known_ledger):
 """Pure gate over decomposition rows: rows within noise pass; rows beyond noise must name a
 ledger entry that exists in autoresearch/results.tsv; unknown rows always fail. Returns the
 list of failure reasons (empty = pass). Exposed for --self-test."""
 failures=[]
 for row in rows:
  stage=row['stage']
  if stage not in LEDGER_MAP:
   failures.append(f"unrecognized decomposition row '{stage}' — add it to the parity vocabulary and map it to a ledger entry")
   continue
  if row.get('withinNoise'):continue
  entry=LEDGER_MAP[stage]
  if entry is None:
   failures.append(f"row '{stage}' differs beyond noise ({row['productMs']:.1f}ms product vs {row['benchMs']:.1f}ms bench) and no ledger entry may excuse it")
  elif entry not in known_ledger:
   failures.append(f"row '{stage}' maps to ledger entry '{entry}', which has no row in {LEDGER}")
 return failures

def inspect(expression):return json.loads(js('JSON.stringify('+expression+')'))
def wait(predicate,seconds=5400):
 deadline=time.monotonic()+seconds
 while time.monotonic()<deadline:
  error=js("document.querySelector('.next-error')?.innerText||''")
  if error:raise RuntimeError(error)
  value=predicate()
  if value:return value
  time.sleep(.5)
 raise TimeoutError('parity harness deadline exceeded')
def click(name):
 # Coordinate click re-resolved through the accessibility tree, as in next-e2e-browser.py.
 for attempt in range(5):
  nodes=cdp('Accessibility.getFullAXTree')['nodes'];n=next((n for n in nodes if n.get('role',{}).get('value')=='button' and n.get('name',{}).get('value')==name),None)
  if not n:time.sleep(.5);continue
  ident=n['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=ident)
  q=cdp('DOM.getBoxModel',backendNodeId=ident)['model']['content'];x,y=sum(q[0::2])/4,sum(q[1::2])/4
  if js("(()=>{const e=document.elementFromPoint(%f,%f),b=e&&e.closest('button');return !!(b&&(b.textContent===%s||b.getAttribute('aria-label')===%s));})()"%(x,y,json.dumps(name),json.dumps(name))):
   click_at_xy(x,y);return
  time.sleep(.5)
 raise RuntimeError('Could not place a click on '+name)
def idle():return js("!document.querySelector('.next-status progress') && [...document.querySelectorAll('button')].some(b=>b.textContent==='Generate faces'&&!b.disabled)")
def save_check(name,data):result['checks'][name]=data;(out/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps({'check':name,**data}),flush=True)

# --- injected instrumentation -------------------------------------------------------------
# Records every worker message that crosses the page boundary with a timestamp. These are the
# product's own progress events from its own worker protocol — the reporting pipeline read
# without consent and without any product change. progressOnly byte ticks are dropped.
OBSERVER_JS=r"""
window.__parityEvents=[];window.__parityLatent=null;window.__parityResumed=false;
(function(){
 const W=window.Worker;
 window.Worker=class extends W{
  constructor(...a){super(...a);
   const self=this;let handler=null;const proto=Object.getOwnPropertyDescriptor(W.prototype,'onmessage');
   Object.defineProperty(this,'onmessage',{get:()=>handler,set:v=>{handler=v;proto.set.call(this,ev=>{try{
    const d=ev.data;
    if(d&&typeof d==='object'&&!d.__parity){
     if(d.type==='progress'&&d.progressOnly)return;
     const rec={t:performance.now(),type:d.type,id:d.id};
     if(d.type==='progress'){rec.stage=d.stage;if(Number.isFinite(d.elapsedMs))rec.elapsedMs=d.elapsedMs;if(d.name)rec.name=d.name;}
     if(d.type==='complete'&&d.result){
      const v=d.result.values;
      if(v&&v.length===9216&&!window.__parityLatent){window.__parityLatent=new Float32Array(v);rec.hasLatent=true;}
      if(d.result.resumed)window.__parityResumed=true;
     }
     window.__parityEvents.push(rec);
    }
   }catch(e){} return v.call(self,ev);});}});
  }
 };
})();
"""
BENCH_WORKER_JS=r"""
// C-08 bench: the pinned ORT runtime and the manifest synthesis model, loaded exactly as the
// product loads them (same assets, same digest verification, same thread formula) but with no
// product pipeline around them. Same device, same browser, same served origin as the product run.
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const cpuThreads=()=>{if(typeof SharedArrayBuffer!=='function'||!globalThis.crossOriginIsolated)return 1;const cores=Number(globalThis.navigator?.hardwareConcurrency);if(!Number.isFinite(cores)||cores<2)return 1;return Math.max(1,Math.min(4,Math.floor(cores)-1));};
async function assetBytes(asset){
 const list=asset.chunks&&asset.chunks.length?asset.chunks:[asset];const parts=[];
 for(const c of list){const r=await fetch(c.url,{credentials:'omit'});if(!r.ok)throw Error('bench fetch '+c.url+' '+r.status);parts.push(await r.arrayBuffer());}
 const total=parts.reduce((a,b)=>a+b.byteLength,0);
 if(asset.size&&total!==asset.size)throw Error('bench size mismatch '+asset.url);
 const merged=new Uint8Array(total);let o=0;for(const p of parts){merged.set(new Uint8Array(p),o);o+=p.byteLength;}
 const digestHex=hex(await crypto.subtle.digest('SHA-256',merged));
 if(digestHex!==asset.sha256)throw Error('bench digest mismatch '+asset.url);
 return merged.buffer;
}
onmessage=async({data})=>{if(!data.latent)return;try{
 const latent=new Float32Array(data.latent);
 const latentSha=hex(await crypto.subtle.digest('SHA-256',latent.buffer.slice(0,latent.byteLength)));
 const boot0=performance.now();
 const manifest=await(await fetch(data.manifestUrl,{credentials:'omit'})).json();
 const bootMs=performance.now()-boot0;
 const assets=manifest.runtime.assets;
 const module_=assets.find(a=>a.url===manifest.runtime.moduleUrl);
 const factory=assets.find(a=>a.url.endsWith('/ort-wasm-simd-threaded.mjs'));
 const wasm=assets.find(a=>a.url.endsWith('/ort-wasm-simd-threaded.wasm'));
 if(!module_||!factory||!wasm)throw Error('bench: incomplete pinned runtime bundle');
 const bytes0=performance.now();
 const results=await Promise.all([assetBytes(module_),assetBytes(factory),assetBytes(wasm),assetBytes(manifest.synthesis),Promise.all(manifest.noise.map(n=>assetBytes(n)))]);
 const bytesMs=performance.now()-bytes0;
 const moduleUrl=URL.createObjectURL(new Blob([results[0]],{type:'text/javascript'}));
 const factoryUrl=URL.createObjectURL(new Blob([results[1]],{type:'text/javascript'}));
 const wasmUrl=URL.createObjectURL(new Blob([results[2]],{type:'application/wasm'}));
 let t=performance.now();const ort=await import(moduleUrl);const importMs=performance.now()-t;
 ort.env.wasm.numThreads=cpuThreads();ort.env.wasm.wasmPaths={mjs:factoryUrl,wasm:wasmUrl};
 t=performance.now();
 const session=await ort.InferenceSession.create(results[3],{executionProviders:['wasm']});
 const createMs=performance.now()-t;
 const feeds={w:new ort.Tensor('float32',latent,[1,18,512])};
 manifest.noise.forEach((n,i)=>feeds[n.name]=new ort.Tensor('float32',new Float32Array(results[4][i]),n.shape));
 t=performance.now();let out=await session.run(feeds);const warmupMs=performance.now()-t;out.image.dispose();
 const runs=[];for(let i=0;i<(data.runs||3);i++){const s=performance.now();out=await session.run(feeds);runs.push(performance.now()-s);out.image.dispose();}
 for(const tensor of Object.values(feeds))tensor.dispose();await session.release();
 const median=runs.slice().sort((a,b)=>a-b)[Math.floor(runs.length/2)];
 postMessage({done:true,result:{latentSha,provider:'wasm',threads:ort.env.wasm.numThreads,crossOriginIsolated,hardwareConcurrency:navigator.hardwareConcurrency,bundleVersion:manifest.bundleVersion,synthesisSha256:manifest.synthesis.sha256,bootMs,bytesMs,importMs,createMs,warmupMs,runs,medianMs:median}});
}catch(e){postMessage({done:true,error:String(e&&e.stack||e)});}};
"""
BOOTSTRAP_JS=r"""
window.__parityBench={run:(values,runs)=>new Promise((resolve,reject)=>{
 const worker=new Worker(URL.createObjectURL(new Blob([window.__PARITY_BENCH_SRC__],{type:'text/javascript'})),{type:'module'});
 worker.onmessage=({data})=>{worker.terminate();if(data&&data.done){if(data.error)reject(Error(data.error));else resolve(data.result);}else reject(Error('bench: unexpected message'));};
 worker.onerror=e=>{worker.terminate();reject(Error('bench worker error: '+(e.message||'unknown')));};
 worker.postMessage({latent:values,manifestUrl:location.origin+'/runtime/manifest.json',runs:runs||3});
 })};
"""

try:
 cdp('Page.enable')
 cdp('Page.addScriptToEvaluateOnNewDocument',source=OBSERVER_JS+"\nwindow.__PARITY_BENCH_SRC__="+json.dumps(BENCH_WORKER_JS)+";\n"+BOOTSTRAP_JS)
 new_tab(ORIGIN+'/');wait_for_load()
 try:ensure_real_tab()
 except NameError:pass
 assert js('location.origin')==ORIGIN,'Parity tab is on %s, expected %s — close stale tabs and retry'%(js('location.origin'),ORIGIN)
 # The initial registration belongs to the prior document; re-register on the actual tab if absent.
 js("if(window.__parityEvents===undefined){"+OBSERVER_JS+"};if(window.__PARITY_BENCH_SRC__===undefined){window.__PARITY_BENCH_SRC__="+json.dumps(BENCH_WORKER_JS)+";};if(window.__parityBench===undefined){"+BOOTSTRAP_JS+"}")
 wait(idle,60);assert js('crossOriginIsolated'),'Production isolation headers missing'
 result['agent']=inspect('navigator.userAgent')
 result['origin']=inspect('location.origin')
 js("window.__ciOrigin=null;fetch('/').then(r=>window.__ciOrigin=r.headers.get('X-Next-Artifact-Source')).catch(e=>window.__ciOrigin='error')")
 wait(lambda:js('window.__ciOrigin!==null'),60);assert js('window.__ciOrigin')==Path('next-site-source.txt').read_text().strip(),'Chrome did not reach exact local artifact origin'
 # CPU route through the product's own debug control, same interaction as next-e2e-browser.py.
 # The debug area (U-09) is always rendered; nothing needs expanding first.
 root=cdp('DOM.getDocument')['root']['nodeId']
 node=cdp('DOM.querySelector',nodeId=root,selector='select[aria-label="Processing mode"]')['nodeId'];cdp('DOM.focus',nodeId=node)
 for key,code in [('Home',36),('ArrowDown',40),('Enter',13),('Escape',27)]:
  cdp('Input.dispatchKeyEvent',type='keyDown',key=key,windowsVirtualKeyCode=code);cdp('Input.dispatchKeyEvent',type='keyUp',key=key)
 mode=js("document.querySelector('select[aria-label=\"Processing mode\"]').value")
 selection='keyboard' if mode=='cpu' else 'scripted'
 if mode!='cpu':
  js("(()=>{const s=document.querySelector('select[aria-label=\"Processing mode\"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'cpu');s.dispatchEvent(new Event('change',{bubbles:true}));})()")
  wait(lambda:js("document.querySelector('select[aria-label=\"Processing mode\"]').value")=='cpu',10)
 assert js("document.querySelector('select[aria-label=\"Processing mode\"]').value")=='cpu'
 result['processingSelection']=selection
 # Fixed input: the identity fixture text 'Alice'. The latent itself is captured from the
 # bundle's own generate response, so no assumption about latent derivation is baked in.
 typed=js("(()=>{const input=document.querySelector('.next-face .next-field input');if(!input)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'Alice');input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()")
 assert typed,'Face text field not found'
 result['fixedInput']='Alice (identity-fixtures.json text case); exact W+ latent captured from the bundle generate response'
 save_check('route',{'processingMode':'cpu','selection':selection})

 wait(idle,60)
 click('Generate faces')
 wait(lambda:js("!!document.querySelector('.next-status progress') || [...document.querySelectorAll('button')].some(b=>b.textContent==='Generate faces'&&b.disabled)"),60)
 wait(idle)
 # Background canary drain (C-03) must finish before the bench runs, or the two pipelines
 # contend for the same cores and both measurements lie.
 wait(lambda:js('window.__parityResumed'),1800)
 events=inspect('window.__parityEvents')
 latent=inspect('window.__parityLatent')
 assert latent and len(latent)==9216,'Shipped bundle did not report the synthesized latent values'
 product_latent_sha=hashlib.sha256(__import__('struct').pack('<%sf'%len(latent),*latent)).hexdigest()
 save_check('latent',{'floats':len(latent),'sha256':product_latent_sha,'note':'SHA256 over the exact float32 little-endian W+ values the shipped synthesis consumed'})

 # Bench: same fixed latent bytes, same device, no product pipeline.
 js("window.__parityBenchResult=null;window.__parityBench.run(new Float32Array(%s),3).then(r=>window.__parityBenchResult={ok:true,r:r}).catch(e=>window.__parityBenchResult={ok:false,error:String(e)});"%json.dumps(latent))
 wait(lambda:js('window.__parityBenchResult!==null'),1800)
 bench=inspect('window.__parityBenchResult')
 assert bench.get('ok'),bench.get('error','bench failed')

 # --- decomposition ------------------------------------------------------------------------
 assert bench['r']['latentSha']==product_latent_sha,'Bench did not receive the exact latent bytes the shipped bundle synthesized (%s vs %s)'%(product_latent_sha,bench['r']['latentSha'])
 ev=[e for e in events if 't' in e]
 gen_complete=next(e for e in ev if e['type']=='complete' and e.get('hasLatent'))
 stream=[e for e in ev if e['t']<=gen_complete['t']]
 t0=stream[0]['t']
 def first(stage):
  return next((e for e in stream if e.get('stage')==stage),None)
 model_loading=first('model-loading');model_loaded=first('model-loaded')
 mapping_loading=first('mapping-loading');synth_start=first('synthesis')
 synth_complete=[e for e in stream if e.get('stage')=='synthesis-complete']
 canaries=[e for e in stream if e.get('stage')=='canary']
 assert model_loaded and 'elapsedMs' in model_loaded,'model-loaded timing missing'
 assert synth_complete,'no synthesis-complete event'
 assert mapping_loading and synth_start,'mapping stages missing on the CPU generate path'
 boot_ms=model_loading['t']-t0
 model_load_ms=model_loaded['elapsedMs']
 canary_ms=mapping_loading['t']-model_loaded['t']
 mapping_ms=synth_start['t']-mapping_loading['t']
 synthesis_ms=synth_complete[0]['elapsedMs']
 png_ms=gen_complete['t']-synth_complete[0]['t']
 e2e_ms=gen_complete['t']-t0
 stages_seen={e.get('stage') for e in stream if e.get('stage')}
 unknown=stages_seen-STAGE_VOCABULARY-{'synthesis'}
 assert not unknown,'Product emitted stages outside the parity vocabulary: %s — extend the vocabulary and the ledger before this check can pass'%sorted(unknown)
 bench_r=bench['r']
 product={'bootMs':boot_ms,'modelLoadAndSessionMs':model_load_ms,'canaryQualificationMs':canary_ms,'canaryCount':len(canaries),'mappingProjectionMs':mapping_ms,'synthesisInferenceMs':synthesis_ms,'pngEncodeAndDeliveryMs':png_ms,'endToEndMs':e2e_ms,'threads':bench_r['threads'],'userAgent':result['agent']}
 bench_summary={'bootMs':bench_r['bootMs'],'bytesMs':bench_r['bytesMs'],'importMs':bench_r['importMs'],'createMs':bench_r['createMs'],'warmupMs':bench_r['warmupMs'],'runs':bench_r['runs'],'medianMs':bench_r['medianMs'],'threads':bench_r['threads'],'crossOriginIsolated':bench_r['crossOriginIsolated'],'synthesisSha256':bench_r['synthesisSha256'],'bundleVersion':bench_r['bundleVersion']}
 rows=[
  {'stage':'acquisition-and-boot','productMs':round(boot_ms,1),'benchMs':round(bench_r['bootMs']+bench_r['bytesMs'],1)},
  {'stage':'model-load-and-session','productMs':round(model_load_ms,1),'benchMs':round(bench_r['importMs']+bench_r['createMs'],1)},
  {'stage':'canary-qualification','productMs':round(canary_ms,1),'benchMs':0.0},
  {'stage':'mapping-projection','productMs':round(mapping_ms,1),'benchMs':0.0},
  {'stage':'synthesis-inference','productMs':round(synthesis_ms,1),'benchMs':round(bench_r['medianMs'],1)},
  {'stage':'png-encode-and-delivery','productMs':round(png_ms,1),'benchMs':0.0},
 ]
 for row in rows:
  row['deltaMs']=round(row['productMs']-row['benchMs'],1)
  row['withinNoise']=abs(row['deltaMs'])<=max(SYNTHESIS_NOISE_FLOOR_MS,SYNTHESIS_NOISE_FRACTION*max(row['benchMs'],row['productMs']))
 known=ledger_ids()
 for row in rows:row['ledgerEntry']=LEDGER_MAP.get(row['stage'])
 failures=parity_check(rows,known)
 # Negative probe on live data: drop one mapping and the gate must fail. Proves the check
 # actually bites; recorded, not asserted silent.
 negative=parity_check([{**r,'withinNoise':False} for r in rows if r['stage']=='png-encode-and-delivery'],known)
 negative_case={'ran':True,'droppedMapping':'png-encode-and-delivery','gateFailedAsExpected':bool(negative)}
 if not negative:failures.append('internal: negative probe did not fail — the gate is not wired to the mapping table')
 save_check('parity',{'product':product,'bench':bench_summary,'rows':rows,'productMs':round(synthesis_ms,1),'benchMs':round(bench_r['medianMs'],1),'decompositionSumMs':round(sum(r['productMs'] for r in rows),1),'endToEndMs':round(e2e_ms,1),'latentSha256':product_latent_sha,'ledgerEntries':sorted({v for v in LEDGER_MAP.values() if v}),'negativeCase':negative_case,'failures':failures})
 if failures:raise RuntimeError('Parity gate failed: '+'; '.join(failures))
 result['passed']=True
except Exception as error:
 result['error']=str(error)
 raise
finally:
 result['finishedAt']=time.time();(out/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
