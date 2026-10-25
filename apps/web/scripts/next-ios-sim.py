#!/usr/bin/env python3
"""Run the built product in a real iOS Simulator and record what the constrained tier does.

Every iPhone number on record is from a Simulator, and the Simulator exposes no WebGPU adapter,
so this lane cannot rank the fast path and never claims to. What it *can* answer is the question
that actually drives the architecture: what does the memory-constrained tier do with a change —
which route it admits, whether a face appears at all, and how much memory it takes to get there.
That is the tier with no physical evidence and the one every memory decision is made for, so it
runs per change rather than once a release.

Safari in a Simulator cannot be driven over CDP, so the page reports on itself: the harness serves
the real built artifact with a campaign script injected at serve time, and the page POSTs its
findings back. Nothing in `deploy-next` is modified; the injection exists only in this server's
response, so the bytes under test are the bytes that shipped apart from one appended script tag.

    python3 scripts/next-ios-sim.py --device 'iPhone 17 Pro' --evidence next-ios-evidence
"""
import argparse, json, subprocess, sys, threading, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'tools/device-lab'))
from hosted import ArtifactServer
sys.path.insert(0, str(ROOT/'scripts/ci/intercept'))
import intercept
ORIGIN = 'https://next.facemorph.me'

CAMPAIGN = """
<script>
(async () => {
  const COLD = __COLD__;
  const inferenceEvents=[];
  // Passive instrumentation: every worker, message and return value remains native and real.
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker {
    constructor(...args){super(...args);this.ops=new Map();this.addEventListener('message',({data})=>{
      const op=this.ops.get(data?.id);
      if(op&&['complete','frame','error'].includes(data?.type))inferenceEvents.push({op,reply:data.type});
    });}
    postMessage(message,...rest){if(message?.id!=null&&['generate','synthesize','encode-aligned','synthesize-frames'].includes(message.type))this.ops.set(message.id,message.type);return super.postMessage(message,...rest);}
  };
  const report = {stages: [], errors: [], inferenceEvents, startedAt: Date.now(),secureContext:isSecureContext};
  const say = (k, v) => { report[k] = v; };
  addEventListener('error', e => report.errors.push(String(e.message || e)));
  addEventListener('unhandledrejection', e => report.errors.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));
  const post = async done => {
    report.completed = !!done;
    report.elapsedMs = Date.now() - report.startedAt;
    report.resources=performance.getEntriesByType('resource').map(e=>({url:e.name,bytes:e.transferSize,duration:e.duration}));
    try { await fetch('/__lane', {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify(report)}); } catch (e) {}
  };
  try {
    // A cold run clears this origin's storage from inside the page. Erasing the Simulator device
    // instead leaves it unusable for minutes and the campaign never loads.
    if (COLD) {
      try {
        for (const k of await caches.keys()) await caches.delete(k);
        localStorage.clear(); sessionStorage.clear();
        report.startedCold = true;
      } catch (e) { report.errors.push('cold reset: ' + e.message); }
    }
    const adapter = await navigator.gpu?.requestAdapter?.().catch(() => null);
    say('webgpu', adapter ? {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize} : null);
    say('agent', navigator.userAgent);
    say('crossOriginIsolated', crossOriginIsolated);
    say('deviceMemory', navigator.deviceMemory ?? null);
    say('hardwareConcurrency', navigator.hardwareConcurrency ?? null);
    const mem = () => performance.memory ? {used: performance.memory.usedJSHeapSize,
      limit: performance.memory.jsHeapSizeLimit} : null;
    say('memoryAtStart', mem());

    new MutationObserver(() => {
      const t = document.body.innerText;
      for (const re of [/Using the \\w+ route[^\\n]*/, /Getting the photo encoder ready[^\\n]*/,
                        /Downloading model files[^\\n]*/, /Loading model files from this device[^\\n]*/,
                        /Generating[^\\n]*/, /Face generated[^\\n]*/,
                        /[^\\n]*much slower[^\\n]*/, /[^\\n]*rejected a graphics route[^\\n]*/]) {
        const m = t.match(re);
        if (m && !report.stages.includes(m[0])) report.stages.push(m[0]);
      }
    }).observe(document.body, {subtree: true, childList: true, characterData: true});

    // One face is the whole product path: acquisition, route admission, a canary and synthesis.
    const wait = async (check, ms, what) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const error = document.querySelector('.next-error');
        if (error) throw Error(error.innerText);
        if (check()) return true;
        await new Promise(r => setTimeout(r, 500));
      }
      report.errors.push('timed out waiting for ' + what);
      return false;
    };
    await wait(() => [...document.querySelectorAll('button')]
      .some(b => b.textContent.trim().toLowerCase() === 'generate'), 60000, 'the interface');
    const began = Date.now();
    if(!window.__ciGate){window.__ciGate=0;setInterval(()=>{const b=document.querySelector('.next-download-dialog .next-download-accept');if(b){window.__ciGate++;b.click();}},250);}
    [...document.querySelectorAll('button')].find(b => b.textContent.trim().toLowerCase() === 'generate').click();
    const made = await wait(() => {
      const tile = document.querySelector('[data-next-face="face-1"]');
      const image = tile?.querySelector('.next-face-image img:not([data-public-preview])');
      const canvas = tile?.querySelector('.next-face-image canvas[data-face-drawn="true"]');
      return ((image?.complete && image.naturalWidth === 1024 && image.naturalHeight === 1024)
        || (canvas?.width === 1024 && canvas.height === 1024))
        && !document.querySelector('.next-status progress') && !document.querySelector('.next-face-active');
    }, 900000, 'the full1024 decoded/drawn generated first face');
    say('firstFaceBoundary', 'Generate click to full1024 decoded image or drawn canvas and idle; 500ms polling, not compositor paint');
    say('faceSurface', document.querySelector('[data-next-face="face-1"] canvas[data-face-drawn="true"]') ? 'rgba-canvas' : made ? 'decoded-image' : null);
    say('firstFaceMs', made ? Date.now() - began : null);
    say('faceProduced', made);
    const surface = document.querySelector('[data-next-face="face-1"] .next-face-image canvas[data-face-drawn="true"], [data-next-face="face-1"] .next-face-image img:not([data-public-preview])');
    const rendered = surface?.getBoundingClientRect(), tileBounds = surface?.closest('.next-face-image').getBoundingClientRect();
    const faceFitsTile = !!rendered && rendered.width > 0 && rendered.height > 0 && Math.abs(rendered.width - tileBounds.width) <= 1 && Math.abs(rendered.height - tileBounds.height) <= 1 && Math.abs(rendered.left - tileBounds.left) <= 1 && Math.abs(rendered.top - tileBounds.top) <= 1;
    say('faceLayout', rendered ? {width: rendered.width, height: rendered.height, tileWidth: tileBounds.width, tileHeight: tileBounds.height, fitsTile: faceFitsTile, fitsViewport: rendered.left>=-1 && rendered.right<=innerWidth+1} : null);
    say('memoryAfterFace', mem());
    say('route', (document.querySelector('.next-route-caption')?.innerText || '').trim());
    say('speeds', localStorage.getItem('facemorph-route-speed-v2'));
    say('cpuFallbackShown', document.body.innerText.includes('much slower'));
    let cached = null;
    try {
      const c = await caches.open('checkface-model-blobs-v1');
      const keys = await c.keys(); let bytes = 0;
      for (const r of keys) { const m = await c.match(r); const l = m?.headers.get('Content-Length'); if (l) bytes += Number(l); }
      cached = {entries: keys.length, bytes};
    } catch (e) { report.errors.push('cache read: ' + e.message); }
    say('cache', cached);
    try { const est = await navigator.storage.estimate(); say('storage', {quota: est.quota, usage: est.usage}); } catch (e) {}
    await post(made);
  } catch (error) {
    report.errors.push('campaign: ' + (error && error.message || String(error)));
    await post(false);
  }
})();
</script>
"""


def assess(report):
    return (isinstance(report,dict) and report.get('completed') is True
            and report.get('faceProduced') is True and not report.get('errors')
            and report.get('secureContext') is True and report.get('crossOriginIsolated') is True
            and 'cpu' in str(report.get('route','')).lower()
            and report.get('faceLayout',{}).get('fitsTile') is True
            and report.get('faceLayout',{}).get('fitsViewport') is True
            and any(e.get('op') in ('generate','synthesize') and e.get('reply')=='complete'
                    for e in report.get('inferenceEvents',[])))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--device', default='iPhone 16 Pro')
    p.add_argument('--artifact', type=Path, default=ROOT / 'deploy-next')
    p.add_argument('--evidence', type=Path, default=ROOT / 'next-ios-evidence')
    p.add_argument('--port', type=int, default=8543)
    p.add_argument('--timeout', type=int, default=1200)
    p.add_argument('--runtime-sha', required=True)
    p.add_argument('--cold', action='store_true', help="Clear this origin's storage before measuring")
    a = p.parse_args()
    artifact = a.artifact.resolve()
    assert (artifact / 'index.html').exists(), f'No built artifact at {artifact}'
    a.evidence.mkdir(parents=True, exist_ok=True)

    # Plain HTTP on localhost, deliberately. `localhost` is a secure context in Safari, so
    # cross-origin isolation, workers and the Cache API all behave exactly as they do in
    # production — and it avoids `simctl keychain add-root-cert`, which hangs indefinitely
    # against a freshly booted device and is the only thing TLS would have bought here.

    received = {}
    ready = threading.Event()
    def on_post(report):
        received.update(report)
        (a.evidence/'report.json').write_text(json.dumps(received,indent=2))
        if report.get('completed') is not None: ready.set()
    def inject(html):
        return html.replace('</body>',CAMPAIGN.replace('__COLD__','true' if a.cold else 'false')+'</body>')
    server = ArtifactServer(artifact,a.runtime_sha,a.port,ROOT/'.cache/mobile-runtime'/a.runtime_sha,inject,on_post)
    url=server.url

    def sim(*args, timeout=180):
        return subprocess.run(['xcrun', 'simctl', *args], capture_output=True, text=True, timeout=timeout)

    # A launch or openurl that outlasts its window on a cold runner is slowness, not failure: the
    # retry loop below is what decides whether Safari ever came up. 22 September `simctl launch`
    # spent more than 180 seconds warming CoreSimulator and the exception ended the lane before
    # its own first retry. A timeout here now returns nothing and lets the loop do its job.
    def patiently(*args, timeout=300):
        try:
            return sim(*args, timeout=timeout)
        except subprocess.TimeoutExpired:
            return None

    devices = json.loads(sim('list', 'devices', 'available', '--json').stdout)['devices']
    match = next((d for group in devices.values() for d in group if d['name'] == a.device), None)
    assert match, f'No available Simulator named {a.device!r}'
    runtime=next(k for k,group in devices.items() if match in group)
    created=sim('create','FaceMorph-product-CI',match['deviceTypeIdentifier'],runtime)
    assert created.returncode==0,created.stderr
    udid=created.stdout.strip()
    server.__enter__()
    try:
        boot = sim('boot', udid); assert boot.returncode == 0, boot.stderr
        assert sim('bootstatus', udid, '-b').returncode == 0
        # A freshly booted or erased device accepts `openurl` only once Safari and its URL
        # handlers are actually up; before that it times out with NSPOSIXErrorDomain 60. Launching
        # Safari first and retrying is the difference between a flaky lane and a usable one.
        patiently('launch', udid, 'com.apple.mobilesafari')
        launch = None
        for attempt in range(6):
            launch = patiently('openurl', udid, url)
            if launch is not None and launch.returncode == 0:
                break
            time.sleep(10)
            patiently('launch', udid, 'com.apple.mobilesafari')
        assert launch is not None and launch.returncode == 0, (launch.stderr if launch else 'Safari never accepted the URL within six attempts')
        print(json.dumps({'device': a.device, 'udid': udid, 'url': url}), flush=True)
        ready.wait(timeout=a.timeout)
        sim('io', udid, 'screenshot', str(a.evidence / 'screen.png'))
    finally:
        sim('shutdown',udid);sim('delete',udid)
        server.__exit__(None,None,None)

    report = received
    (a.evidence / 'report.json').write_text(json.dumps(report, indent=2))
    summary = {k: report.get(k) for k in
               ('completed', 'faceProduced', 'firstFaceMs', 'route', 'webgpu', 'cpuFallbackShown',
                'memoryAfterFace', 'cache', 'storage', 'agent')}
    summary['errors'] = report.get('errors', [])[:4]
    summary['device'] = a.device
    print(json.dumps(summary, indent=2), flush=True)
    network = intercept.new_record('Safari Resource Timing (window only)',intercept.DEFAULT_HOST_MAP,
        ['worker requests','cache hit status','complete transfer bytes','JS heap/RSS','trusted input'])
    host_map=intercept.bindOrigins(intercept.DEFAULT_HOST_MAP,{'app':[url]})
    intercept.step(network,'product')
    for entry in report.get('resources',[]):
        request=intercept.add_request(network,host_map,entry['url'],'GET','window Resource Timing')
        request['bytes']=None  # transferSize=0 can mean TAO-restricted, not zero traffic.
    (a.evidence/'network.json').write_text(json.dumps(network,indent=2))
    verdict={'passed':assess(report),'evidence':'Simulator evidence, not physical iPhone',
        'untested':network['unobservable'],'timingReferenceMs':{'firstFace':25287,'warmSynthesis':4741.2},
        'timingsArePassFail':False}
    (a.evidence/'verdict.json').write_text(json.dumps(verdict,indent=2))
    if not verdict['passed']:
        print('iOS product failed CPU inference, isolation, layout or error checks.',file=sys.stderr);sys.exit(1)


if __name__ == '__main__':
    main()
