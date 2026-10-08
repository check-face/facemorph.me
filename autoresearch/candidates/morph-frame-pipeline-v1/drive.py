# Run through browser-harness: BENCH_URL, BENCH_ENGINE, BENCH_PLAN (json list of [label, frames, opts])
import json, os, time
def call(expr, limit=900):
    js("window.__r=undefined;Promise.resolve(%s).then(v=>window.__r={ok:v},e=>window.__r={err:String(e&&e.stack||e)});0"%expr)
    end=time.time()+limit
    while time.time()<end:
        r=js("window.__r")
        if r is not None:
            if 'err' in r: raise RuntimeError(r['err'])
            return r.get('ok')
        time.sleep(0.5)
    raise RuntimeError('timeout '+expr)
new_tab('about:blank'); goto_url(os.environ['BENCH_URL']); wait_for_load()
for _ in range(30):
    if js("document.getElementById('out')?.textContent")=='loaded': break
    time.sleep(0.5)
print(json.dumps({'adapter':call("navigator.gpu.requestAdapter().then(a=>a.info.vendor+' '+a.info.architecture+' '+a.info.description)")}))
print(json.dumps({'initMs':call("bench.init(%s,%s"%(json.dumps(os.environ['BENCH_ENGINE']),'true' if os.environ.get('BENCH_PROFILE') else 'false')+','+json.dumps(os.environ.get('BENCH_ORT',''))+')')}))
for label, method, n, opts in json.loads(os.environ['BENCH_PLAN']):
    rows=call("bench.%s(%d,%s)"%(method,n,json.dumps(opts)))
    print(json.dumps({'label':label,'rows':rows}))
