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
}
os.makedirs(EVIDENCE, exist_ok=True)


def q(expression):
    return js('(%s)' % expression)


def wait(check, seconds, what):
    deadline = time.time() + seconds
    while time.time() < deadline:
        value = check()
        if value:
            return value
        time.sleep(1)
    raise AssertionError('Timed out waiting for ' + what)


new_tab(os.environ.get('GPU_BENCH_URL', 'https://next.facemorph.me/'))
wait_for_load()

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
   for(const re of [/Face generated[^\\n]*/,/Generating…/,/Loading the graphics model[^\\n]*/,/Model ready[^\\n]*/,/[^\\n]*much slower[^\\n]*/,/[^\\n]*rejected a graphics route[^\\n]*/]){
     const m=t.match(re); if(m&&!window.__bench.some(e=>e.line===m[0]))
       window.__bench.push({ms:Math.round(performance.now()-window.__t0),line:m[0]});}
 }).observe(document.body,{subtree:true,childList:true,characterData:true});})()""")

# 3. One face at a time, each a fresh seed so nothing is served from the original cache.
faces, cold = [], None
for index in range(FACES):
    started = time.time()
    js("""(()=>{const i=[...document.querySelectorAll('input[type=text]')].find(x=>x.placeholder==='Just type anything');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'gpu-bench-%d-%d');
      i.dispatchEvent(new Event('input',{bubbles:true}));
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='%s').click();})()"""
       % (index, int(time.time()), S['generate']))
    wait(lambda: q("document.querySelectorAll('img[src^=\"blob:\"]').length") > 0
         and not q("document.body.innerText.includes('Generating')"), 900, 'face %d' % index)
    elapsed = (time.time() - started) * 1000
    if index == 0:
        cold = elapsed
    else:
        faces.append(elapsed)

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
                  ('route', 'warmMsPerFace', 'wallClockFirstFaceMs', 'wallClockSubsequentMedianMs')}))
