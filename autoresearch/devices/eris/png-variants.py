# Executed by browser-harness (see gpu-bench.sh). H2: the in-worker canonical PNG encode is the largest
# post-inference term on the warm path. Compares, inside a real Chromium dedicated worker and on the
# product's own png.mjs source:
#   control   : encodeRgbaPng as shipped (scanlines + CompressionStream('deflate') + CRC)
#   stored    : same module with the deflate step replaced by its own storedDeflate() fallback
#   filtered  : same, plus PNG Sub filtering before deflate (smaller output; costs a pass)
# Gate before any timing: each variant must decode back to the identical RGBA via the product's
# decodeReferencePng. ABBA-interleaved, 12 repeats, first 2 dropped. Source hash is recorded.
import json, os, hashlib
src = open('src/Next/browser/png.mjs').read()
control = src
stored = src.replace("typeof CompressionStream==='function'?", "false?")
assert stored != src
new_src = open(os.environ['PNG_NEW']).read() if os.environ.get('PNG_NEW') else src
filtered = src.replace("scan.set(rgba.subarray(y*width*4,(y+1)*width*4),y*(width*4+1)+1);",
    "{const o=y*(width*4+1);scan[o]=1;const r=y*width*4;for(let x=0;x<width*4;x++)scan[o+1+x]=(rgba[r+x]-(x>=4?rgba[r+x-4]:0))&255;}")
assert filtered != src
port = os.environ['BU_CDP_URL'].rsplit(':', 1)[1]
new_tab('http://localhost:%s/json/version' % port)
wait_for_load()
variants = {'control': control, 'stored': stored, 'new': new_src}
worker_code = r"""
self.onmessage = async ({data}) => {
  const mods = {};
  for (const [name, text] of Object.entries(data.variants)) mods[name] = await import(URL.createObjectURL(new Blob([text], {type: 'text/javascript'})));
  const w = 1024, h = 1024, rgba = new Uint8ClampedArray(w * h * 4);
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4;
    rgba[o] = 128 + 100 * Math.sin(x / 90) * Math.cos(y / 140) + (rnd() - .5) * 10; rgba[o+1] = 110 + 80 * Math.sin(x / 70 + 1) + (rnd() - .5) * 10;
    rgba[o+2] = 100 + 90 * Math.cos(y / 110) + (rnd() - .5) * 10; rgba[o+3] = 255; }
  const gate = {};
  for (const [name, mod] of Object.entries(mods)) {
    const blob = await mod.encodeRgbaPng(rgba); const back = await mods.control.decodeReferencePng(await blob.arrayBuffer());
    let same = back.rgba.length === rgba.length; for (let i = 0; same && i < rgba.length; i++) if (back.rgba[i] !== rgba[i]) same = false;
    gate[name] = {identical: same, bytes: blob.size, sha: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('')};
  }
  const times = {control: [], stored: [], new: []};
  for (let r = 0; r < 12; r++) { const order = r % 2 ? ['new', 'stored', 'control'] : ['control', 'stored', 'new'];
    for (const n of order) { const t = performance.now(); await mods[n].encodeRgbaPng(rgba); times[n].push(performance.now() - t); } }
  const med = a => { const s = a.slice(2).sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1); };
  postMessage({gate, medianMs: {control: med(times.control), stored: med(times.stored), new: med(times.new)}, raw: times});
};"""
js_code = "window.__png=null;(()=>{const w=new Worker(URL.createObjectURL(new Blob([%s],{type:'text/javascript'})),{type:'module'});" \
          "w.onmessage=e=>{window.__png=e.data};w.onerror=e=>{window.__png={error:String(e.message||e)}};w.postMessage({variants:%s});return 1;})()" \
          % (json.dumps(worker_code), json.dumps(variants))
js(js_code)
import time
result = None
for _ in range(240):
    result = js("window.__png")
    if result: break
    time.sleep(1)
assert result and 'error' not in result, result
result['sourceSha256'] = hashlib.sha256(src.encode()).hexdigest()
print(json.dumps(result))
