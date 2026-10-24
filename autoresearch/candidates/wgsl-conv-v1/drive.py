# browser-harness: BENCH_URL, BENCH_ARGS (json passed to window.benchMain)
import json, os, time
new_tab('about:blank'); goto_url(os.environ['BENCH_URL']); wait_for_load()
for _ in range(60):
    if js('document.title')=='ready': break
    time.sleep(0.5)
js("window.__r=undefined;benchMain(%s).then(v=>window.__r={ok:v},e=>window.__r={err:String(e&&e.stack||e)});0"%os.environ['BENCH_ARGS'])
end=time.time()+600
while time.time()<end:
    r=js('window.__r')
    if r is not None: print(json.dumps(r)); break
    time.sleep(1)
