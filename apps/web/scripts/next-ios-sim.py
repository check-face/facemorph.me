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

# Pure observer, also exercised with the production acquisition budget in the lightweight tests.
# The budget lives for a worker's lifetime: sum latest worker counters, never progress messages or job IDs.
ACQUISITION_METRICS = r"""
function acquisitionMetrics() {
  const workers = new Map();
  let overflow = false;
  return {
    worker(url) {
      const id = workers.size + 1;
      if (workers.size >= 16) { overflow = true; return null; }
      workers.set(id, {id, url: String(url), expected: false, messages: 0,
        snapshots: [], latest: null, invalid: 0, regressions: 0,
        requestedProvider: null, actualProvider: null, completedFaces: 0});
      return id;
    },
    request(id, message) {
      const row = workers.get(id);
      if (!row) return;
      if (message?.type === 'initialize' && typeof message.provider === 'string') {
        row.expected = true;
        row.requestedProvider = message.provider;
      }
      if (['generate', 'synthesize', 'synthesize-frames', 'encode-aligned'].includes(message?.type))
        row.expected = true;
    },
    observe(id, data, operation) {
      const row = workers.get(id);
      if (!row) return;
      if (data?.type === 'complete' && operation === 'initialize')
        row.actualProvider = typeof data.result?.provider === 'string' ? data.result.provider : null;
      if (data?.type === 'complete' && ['generate', 'synthesize'].includes(operation))
        row.completedFaces++;
      if (data?.type !== 'progress' || data.stage !== 'asset-acquisition') return;
      row.expected = true;
      row.messages++;
      const snapshot = Object.fromEntries(['loaded', 'total', 'fetched', 'fetchedTotal']
        .map(key => [key, data[key]]));
      if (!Object.values(snapshot).every(value => Number.isSafeInteger(value) && value >= 0)
          || snapshot.loaded > snapshot.total || snapshot.fetched > snapshot.fetchedTotal
          || snapshot.fetched > snapshot.loaded || snapshot.fetchedTotal > snapshot.total) {
        row.invalid++;
        return;
      }
      // Retry progress can fall before completion. A maximum would count abandoned partial reads.
      if (row.latest && ['loaded', 'fetched'].some(key => snapshot[key] < row.latest[key]))
        row.regressions++;
      row.latest = snapshot;
      row.snapshots.push(snapshot);
      if (row.snapshots.length > 8) row.snapshots.shift();
    },
    report() {
      const rows = [...workers.values()].filter(row => row.expected);
      const observed = !overflow && rows.length > 0 && rows.every(row => row.invalid === 0
        && row.latest !== null);
      const complete = observed && rows.every(row => row.latest.loaded === row.latest.total
        && row.latest.fetched === row.latest.fetchedTotal);
      return {status: complete ? 'measured' : 'untested',
        reason: complete ? null : overflow ? 'worker observation limit exceeded'
          : rows.length === 0 ? 'no native acquisition counters observed'
          : 'missing, invalid or incomplete native acquisition counters',
        acquiredPayloadBytes: complete ? rows.reduce((sum, row) => sum + row.latest.fetched, 0) : null,
        fetchedBodyBytes: complete ? rows.reduce((sum, row) => sum + row.latest.fetched, 0) : null,
        observedPayloadBytes: observed ? rows.reduce((sum, row) => sum + row.latest.fetched, 0) : null,
        plannedPayloadBytes: observed ? rows.reduce((sum, row) => sum + row.latest.total, 0) : null,
        budgetComplete: complete,
        observationBoundary: 'first-face report; background qualification may still be active',
        measurement: 'native ort-worker asset-acquisition counters; latest snapshot per worker',
        byteMeaning: 'production accounted payload: SHA-deduplicated assets marked fetched by the acquisition budget; partial/cache/shared-worker accounting is not wire traffic or a universal transfer lower bound; excludes HTTP overhead and retry re-transfers',
        completeTransferBytes: null,
        completeTransferBytesReason: 'per-asset acquisition counters do not measure all wire transfers',
        workers: rows};
    }
  };
}
"""

CAMPAIGN = """
<script>
(async () => {
  const COLD = __COLD__;
  __ACQUISITION_METRICS__
  const acquisition = acquisitionMetrics();
  const inferenceEvents=[];
  // Passive instrumentation: every worker, message and return value remains native and real.
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker {
    constructor(...args){super(...args);this.ops=new Map();this.metricId=acquisition.worker(args[0]);this.addEventListener('message',({data})=>{
      const op=this.ops.get(data?.id);
      acquisition.observe(this.metricId,data,op);
      if(op&&['complete','frame','error'].includes(data?.type))inferenceEvents.push({op,reply:data.type});
    });}
    postMessage(message,...rest){acquisition.request(this.metricId,message);if(message?.id!=null&&['initialize','generate','synthesize','encode-aligned','synthesize-frames'].includes(message.type))this.ops.set(message.id,message.type);return super.postMessage(message,...rest);}
  };
  const report = {stages: [], errors: [], inferenceEvents, startedAt: Date.now(),secureContext:isSecureContext};
  const say = (k, v) => { report[k] = v; };
  const storageEstimate = async phase => {
    const measuredAt = new Date().toISOString();
    try {
      const estimate = await navigator.storage.estimate();
      const known = [estimate.quota, estimate.usage].every(value => Number.isSafeInteger(value) && value >= 0);
      return {phase, measuredAt, status: known ? 'measured' : 'untested',
        quota: estimate.quota ?? null, usage: estimate.usage ?? null,
        reason: known ? null : 'browser did not report both quota and usage'};
    } catch (error) {
      return {phase, measuredAt, status: 'untested', quota: null, usage: null, reason: String(error)};
    }
  };
  addEventListener('error', e => report.errors.push(String(e.message || e)));
  addEventListener('unhandledrejection', e => report.errors.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));
  const post = async done => {
    report.completed = !!done;
    report.measuredAt = new Date().toISOString();
    report.elapsedMs = Date.now() - report.startedAt;
    report.acquisition = acquisition.report();
    report.routeFacts = {requested: 'auto', actual: report.acquisition.workers.some(worker =>
      worker.actualProvider === 'wasm' && worker.completedFaces > 0) ? 'cpu' : null,
      nativeProviders: [...new Set(report.acquisition.workers.map(worker => worker.actualProvider).filter(Boolean))]};
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
    say('platform', navigator.platform);
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
    say('storageBeforeFace', await storageEstimate('before-generate'));
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
    const afterStorage = await storageEstimate(made ? 'after-face' : 'after-face-attempt');
    say('storageAfterFace', afterStorage);
    if (afterStorage.status === 'measured') say('storage', {quota: afterStorage.quota, usage: afterStorage.usage});
    await post(made);
  } catch (error) {
    report.errors.push('campaign: ' + (error && error.message || String(error)));
    await post(false);
  }
})();
</script>
"""
CAMPAIGN = CAMPAIGN.replace('__ACQUISITION_METRICS__', ACQUISITION_METRICS)


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
    report['storageIsolation'] = {'kind': 'newly-created-simulator', 'device': a.device,
                                  'udid': udid, 'runtime': runtime}
    (a.evidence / 'report.json').write_text(json.dumps(report, indent=2))
    summary = {k: report.get(k) for k in
               ('completed', 'faceProduced', 'firstFaceMs', 'route', 'webgpu', 'cpuFallbackShown',
                'memoryAfterFace', 'cache', 'storage', 'storageBeforeFace', 'storageAfterFace',
                'acquisition', 'routeFacts', 'agent')}
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
    verdict['acquisitionMetrics'] = report.get('acquisition', {'status': 'untested',
        'acquiredPayloadBytes': None, 'fetchedBodyBytes': None, 'observedPayloadBytes': None,
        'plannedPayloadBytes': None, 'budgetComplete': False, 'reason': 'no browser acquisition report'})
    (a.evidence/'verdict.json').write_text(json.dumps(verdict,indent=2))
    if not verdict['passed']:
        print('iOS product failed CPU inference, isolation, layout or error checks.',file=sys.stderr);sys.exit(1)


if __name__ == '__main__':
    main()
