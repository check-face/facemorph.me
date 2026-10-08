# browser-harness script (opfs-shard-cache-v1 copy of morph-frame-pipeline-v1): BENCH_URL, BENCH_PLAN = json list of steps: ["qualify"], ["faces",n], ["morph",mode,n]
import json, os, time
def call(expr, limit=1500):
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
print(json.dumps({'adapter':call("navigator.gpu.requestAdapter().then(a=>a.info.vendor+' '+a.info.architecture)"),'visibility':js('document.visibilityState')}))
for step in json.loads(os.environ['BENCH_PLAN']):
    if step[0]=='qualify': print(json.dumps({'step':'qualify','result':call('bench.qualify()')}))
    elif step[0]=='faces': print(json.dumps({'step':'faces','result':call('bench.faces(%d)'%step[1])}))
    elif step[0]=='photo': print(json.dumps({'step':'photo','result':call('bench.photo(%d)'%step[1])}))
    elif step[0] in ('photo',): print(json.dumps({'step':step[0],'result':call('bench.photo(%d)'%step[1])}))
    elif step[0] in ('storage','corrupt','statuses'): print(json.dumps({'step':step[0],'result':call('bench.%s()'%step[0])}))
    elif step[0]=='events': print(json.dumps({'step':'events','result':js('JSON.stringify(bench.events.slice(-%d))'%step[1])}))
    else: print(json.dumps({'step':'morph','mode':step[1],'result':call('bench.morph(%s,%d)'%(json.dumps(step[1]),step[2]))}))
