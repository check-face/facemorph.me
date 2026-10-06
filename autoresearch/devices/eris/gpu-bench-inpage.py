# Benchmark the WebGPU route on a real GPU, through the real product interface.
#
# Every per-face number in the ledger so far came from the device lab or from an operator's
# screen. Neither is repeatable on demand, so a regression in the GPU path could only be caught
# by someone noticing. This runs on the self-hosted TrueNAS runner (GTX 1050, Vulkan/ANGLE) and
# produces a comparable row per run: admitted route, cold first face, warm median per face.
#
# It fails closed. No adapter, a route that is not webgpu, or a face that never arrives is a
# failed run, never a quietly-recorded CPU number wearing a GPU label.
import json, os, statistics, time

EVIDENCE = os.environ.get('GPU_BENCH_EVIDENCE', 'next-gpu-evidence')
FACES = int(os.environ.get('GPU_BENCH_FACES', '6'))
S = {
    'processingMode': 'select[aria-label="Processing mode"]',
    'routeCaption': '.next-route-caption',
    'generate': 'GENERATE',
    # A job is finished when the status line stops showing a progress element. Reading the whole
    # page for the word "Generating" cannot work: the slow-device note says "Generating is slow on
    # this device." and stays on screen, so from the moment this runner earned that note the wait
    # below could never come true and every run burned its 900-second deadline on a face that had
    # already been produced. The status line is the thing that actually says whether work is
    # running, exactly as the e2e harness's idle() reads it.
    'busy': '.next-status progress',
}
os.makedirs(EVIDENCE, exist_ok=True)


def q(expression):
    return js('(%s)' % expression)


def dump(name):
    """Whatever the page can still tell us, written next to the run.

    A benchmark that fails with nothing but 'timed out' costs a whole cycle to learn anything
    from. The stage log, the status line and the cache state are what distinguish a slow cold
    download from a route that never started."""
    try:
        state = q("""(async()=>{const c=await caches.open('checkface-model-blobs-v1').catch(()=>null);
          const keys=c?await c.keys():[];let b=0;
          for(const r of keys){const m=await c.match(r);const l=m?.headers.get('Content-Length');if(l)b+=Number(l);}
          return {cachedAssets:keys.length,cachedMiB:Math.round(b/1048576),
            status:document.body.innerText.slice(0,1200),
            stages:window.__bench||[],
            routeCaption:document.querySelector('.next-route-caption')?.innerText||'',
            speeds:localStorage.getItem('facemorph-route-speed-v2')};})()""")
    except Exception as error:
        state = {'dumpFailed': str(error)}
    with open(os.path.join(EVIDENCE, name), 'w') as handle:
        json.dump(state, handle, indent=2)
    print(json.dumps({'diagnostic': name, 'cachedMiB': (state or {}).get('cachedMiB'),
                      'stages': (state or {}).get('stages')})[:1500])


def wait(check, seconds, what):
    deadline = time.time() + seconds
    while time.time() < deadline:
        # An error on the surface is an answer, not something to keep waiting through. The route
        # has failed on this runner since at least 21 September with "[Invalid CommandBuffer] is
        # invalid" out of Queue.Submit, and every run spent its full deadline before reporting a
        # timeout — which reads like a hang and named nothing. The product already puts the GPU's
        # own words on screen; the lane repeats them and stops.
        failure = q("document.querySelector('.next-error')?.innerText||''")
        if failure:
            dump('failure-state.json')
            raise AssertionError('The product reported an error while waiting for %s: %s'
                                 % (what, ' '.join(failure.split())[:300]))
        value = check()
        if value:
            return value
        time.sleep(1)
    dump('failure-state.json')
    raise AssertionError('Timed out waiting for ' + what)


new_tab('about:blank')
cdp('Page.enable')
cdp('Page.addScriptToEvaluateOnNewDocument', source="""(()=>{const W=window.Worker;window.__wlog=[];
window.Worker=function(...a){const w=new W(...a);const o=w.postMessage.bind(w);
w.postMessage=(m,...r)=>{window.__wlog.push([performance.now(),'>',m&&m.type,'',m&&m.id]);return o(m,...r)};
w.addEventListener('message',e=>{const d=e.data||{};window.__wlog.push([performance.now(),'<',d.type,d.stage||'',d.id,d.elapsedMs])});return w};
window.Worker.prototype=W.prototype;
const L=(...a)=>window.__wlog.push([performance.now(),...a]);
const dg=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=(...a)=>{L('*','digest>','',a[1]&&a[1].byteLength);return dg(...a).then(r=>{L('*','digest<');return r;});};
const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){L('*','idb.put');this.transaction.addEventListener('complete',()=>L('*','idb.complete'));return put.apply(this,a);};
const st0=window.setTimeout.bind(window);window.setTimeout=(f,d,...r)=>{if(d>=100)L('*','setTimeout',String(d),String(f).slice(0,60));return st0(f,d,...r);};
const ft=window.fetch.bind(window);window.fetch=(u,...r)=>{L('*','fetch>',String(u&&u.url||u).slice(0,70));return ft(u,...r).finally(()=>L('*','fetch<',String(u&&u.url||u).slice(0,40)));};
try{new PerformanceObserver(l=>{for(const e of l.getEntries())L('*','longtask',String(Math.round(e.duration)),'');}).observe({entryTypes:['longtask']});}catch(e){}
const mo=new MutationObserver(ms=>{for(const m of ms){if(m.type==='attributes'&&m.target.tagName==='IMG')L('*','img.'+m.attributeName,'',String(m.target.src).slice(-12));}});
document.addEventListener('DOMContentLoaded',()=>mo.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['src']}));
const cou=URL.createObjectURL.bind(URL);URL.createObjectURL=b=>{L('*','createObjectURL','',b&&b.size);return cou(b);};
})()""")
goto_url(os.environ.get('GPU_BENCH_URL', 'https://next.facemorph.me/'))
wait_for_load()
# Close the trial-phase reporting toast without answering it.
time.sleep(1)
js('(()=>{const b=document.querySelector(\'.next-consent-toast button[aria-label="Ask me later"]\');if(b)b.click();return !!b;})()')
js("if(!window.__ciGate){window.__ciGate=0;setInterval(()=>{const b=document.querySelector('.next-download-dialog .next-download-accept');if(b){window.__ciGate++;b.click();}},250);}")

# 1. The adapter must exist and clear the route's binding floor before anything else is claimed.
adapter = q("""(async()=>{const a=await navigator.gpu?.requestAdapter();return a?{
  maxStorageBufferBindingSize:a.limits.maxStorageBufferBindingSize,
  maxBufferSize:a.limits.maxBufferSize,
  info:a.info?{vendor:a.info.vendor,architecture:a.info.architecture,device:a.info.device,description:a.info.description}:null
}:null;})()""")
assert adapter, 'No WebGPU adapter on this runner: the lane cannot benchmark the GPU route'
required = 134217728
assert adapter['maxStorageBufferBindingSize'] >= required and adapter['maxBufferSize'] >= required, \
    'Adapter below the route binding floor: %r' % adapter

# A software rasteriser satisfies every limit and answers every call, so limits alone cannot tell
# a GPU from a CPU pretending to be one. TrueNAS ships the NVIDIA driver without its Vulkan ICD,
# which left llvmpipe as the only Vulkan device on the box: the lane would have run, passed, and
# recorded software timings in the ledger under a GPU heading. Chrome still enumerates llvmpipe
# alongside a real adapter, so the name is checked on every run, not just on that machine.
SOFTWARE = ('llvmpipe', 'swiftshader', 'softwarerasterizer', 'lavapipe', 'microsoft basic')
identity = ' '.join(str(v) for v in (adapter.get('info') or {}).values()).lower()
assert not any(name in identity for name in SOFTWARE), \
    'This is a software adapter, not a GPU: %r. Check the Vulkan ICD.' % (adapter.get('info'),)

# 2. Ask for WebGPU explicitly. Automatic selection is exercised by the CPU lane; here the point
#    is to measure the GPU path, so a silent fallback must fail the run rather than be timed.
js("""(()=>{const s=document.querySelector('%s');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'webgpu');
  s.dispatchEvent(new Event('change',{bubbles:true}));})()""" % S['processingMode'])
wait(lambda: q("document.querySelector('%s').value" % S['processingMode']) == 'webgpu', 30,
     'the processing mode to become webgpu')

js("""(()=>{window.__bench=[];window.__t0=performance.now();
 new MutationObserver(()=>{const t=document.body.innerText;
   for(const re of [/Done — ready to save or share/,/Generating…/,/Loading the graphics model[^\\n]*/,/Model ready/,/Downloading model files/,/Loading model files from this device/,/[^\\n]*much slower[^\\n]*/,/[^\\n]*rejected a graphics route[^\\n]*/]){
     const m=t.match(re); if(m&&!window.__bench.some(e=>e.line===m[0]))
       window.__bench.push({ms:Math.round(performance.now()-window.__t0),line:m[0]});}
 }).observe(document.body,{subtree:true,childList:true,characterData:true});})()""")

# 3. One face at a time, each a fresh seed so nothing is served from the original cache.
faces, cold = [], None
inpage_ms = []
shown_ms = []
painted_ms = []
timelines = []
for index in range(FACES):
    profiling = os.environ.get('PROFILE') == '1' and index == FACES - 1
    if profiling:
        cdp('Profiler.enable'); cdp('Profiler.setSamplingInterval', interval=200); cdp('Profiler.start')
    started = time.time()
    js("""(()=>{const i=[...document.querySelectorAll('input[type=text]')].find(x=>x.placeholder==='Just type anything');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'%s');
      i.dispatchEvent(new Event('input',{bubbles:true}));
      // MUI uppercases button labels in CSS, so textContent reads 'Generate' while the rendered
      // label reads 'GENERATE'. Match case-insensitively rather than on either spelling.
      const want='%s'.toLowerCase();
      const srcs=()=>[...document.querySelectorAll('img[src^="blob:"]')].map(x=>x.src).join('|');
      window.__pre=srcs();window.__done=null;window.__t0f=performance.now();window.__tl=[];window.__last='';const st=setInterval(()=>{const e=document.querySelector('.next-status');const t=(e?e.innerText:'').replace(/\\s+/g,' ').slice(0,80)+(document.querySelector('.next-status progress')?' [progress]':'');if(t!==window.__last){window.__last=t;window.__tl.push([Math.round(performance.now()-window.__t0f),t]);}if(window.__done!==null)clearInterval(st);},2);
      window.__shown=null;const before=new Set(window.__pre.split('|'));
      const tick=setInterval(()=>{const imgs=[...document.querySelectorAll('img[src^="blob:"]')];
        const fresh=imgs.find(x=>!before.has(x.src)&&x.complete&&x.naturalWidth===1024);
        if(fresh&&window.__shown===null){window.__shown=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__painted=performance.now();}));}
        if(srcs()!==window.__pre&&!document.querySelector('.next-status progress')&&window.__shown!==null){window.__done=performance.now();clearInterval(tick);}},2);window.__painted=null;
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim().toLowerCase()===want).click();})()"""
       % ('gpu-bench-parity' if index == FACES - 1 else 'gpu-bench-%d-%d' % (index, int(time.time())), S['generate']))
    wait(lambda: q("document.querySelectorAll('img[src^=\"blob:\"]').length") > 0
         and q("document.querySelector('%s')===null" % S['busy']), 900, 'face %d' % index)
    elapsed = (time.time() - started) * 1000
    inpage = q('window.__done===null?null:window.__done-window.__t0f')
    shown_ms.append(q('window.__shown===null?null:window.__shown-window.__t0f'))
    painted_ms.append(q('window.__painted===null?null:window.__painted-window.__t0f'))
    inpage_ms.append(inpage)
    timelines.append(q("(window.__wlog||[]).filter(e=>e[0]>=window.__t0f).map(e=>[Math.round(e[0]-window.__t0f),...e.slice(1)])"))
    if profiling:
        prof = cdp('Profiler.stop')['profile']
        with open(os.path.join(EVIDENCE, 'main-thread.cpuprofile'), 'w') as handle:
            json.dump(prof, handle)
    if index == 0:
        cold = elapsed
    else:
        faces.append(elapsed)

# Parity: the last face is a fixed name, so every arm generates the same face. Hash its decoded pixels (not the PNG
# bytes: the container may legitimately differ between builds) so a change is checked against production on the GPU.
pixel_sha = q("""(async()=>{const img=[...document.querySelectorAll('img[src^="blob:"]')].pop();const b=await (await fetch(img.src)).blob();
  const bmp=await createImageBitmap(b,{colorSpaceConversion:'none',premultiplyAlpha:'none'});const c=new OffscreenCanvas(bmp.width,bmp.height);
  const g=c.getContext('2d',{colorSpace:'srgb'});g.drawImage(bmp,0,0);const px=g.getImageData(0,0,bmp.width,bmp.height).data;
  const h=await crypto.subtle.digest('SHA-256',px);return {w:bmp.width,h:bmp.height,pngBytes:b.size,sha:Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,'0')).join('')};})()""")
caption = q("document.querySelector('%s')?.innerText||''" % S['routeCaption'])
assert 'webgpu' in caption, 'The product did not run on webgpu: %r' % caption
assert 'much slower' not in q("document.body.innerText"), 'The CPU-fallback notice appeared'

# The runtime's own warm measurement is the comparable number: it excludes acquisition, session
# creation and shader compilation, which the wall-clock figures above still contain.
speeds = q("JSON.parse(localStorage.getItem('facemorph-route-speed-v2')||'null')")
warm = (speeds or {}).get('routes', {}).get('webgpu')
assert warm, 'No warm webgpu measurement was recorded'

report = {
    'lane': 'browser-gpu-selfhosted',
    'route': 'webgpu',
    'adapter': adapter,
    'warmMsPerFace': warm,
    'wallClockFirstFaceMs': round(cold),
    'wallClockSubsequentMedianMs': round(statistics.median(faces)) if faces else None,
    'parityFace': pixel_sha,
    'inPageClickToFaceMs': inpage_ms,
    'imageDecodedMs': shown_ms,
    'imagePaintedMs': painted_ms,
    'timelines': timelines,
    'inPageClickToFaceMedianMs': (round(statistics.median([m for m in inpage_ms[1:] if m]), 1) if [m for m in inpage_ms[1:] if m] else None),
    'faces': FACES,
    'routeCaption': caption,
    'manifestSha256': q("(window.__FACEMORPH_BUNDLE||'')") or os.environ.get('RUNTIME_SHA', ''),
    'stages': q('window.__bench'),
    # The browser's adapter block is deliberately vague (Chrome redacts vendor and device on
    # many platforms), so the host's own view of the GPU travels with the row. A ledger entry
    # that cannot name the hardware is not comparable to anything.
    'hostGpu': os.environ.get('GPU_BENCH_HOST_GPU', '').strip(),
    'runner': os.environ.get('RUNNER_NAME', ''),
    'scope': 'Self-hosted runner, headless Chrome with a real GPU, through the product UI. '
             'Not a physical-phone measurement and not a 31-case correctness qualification.',
    'finishedAt': time.time(),
}
with open(os.path.join(EVIDENCE, 'gpu-benchmark.json'), 'w') as handle:
    json.dump(report, handle, indent=2)
print(json.dumps({k: report[k] for k in
                  ('route', 'warmMsPerFace', 'wallClockFirstFaceMs', 'wallClockSubsequentMedianMs', 'parityFace', 'inPageClickToFaceMs', 'imageDecodedMs', 'imagePaintedMs', 'inPageClickToFaceMedianMs')}))
