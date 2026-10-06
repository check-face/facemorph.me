// Run the product's model-cache.mjs variants inside a real browser engine, in a Worker (as the product does),
// against the live chunk URLs, to answer "does this build of the cache work in <engine>?" without the rest of
// the product. Variants: label=path[:readAhead][:nosubtle]  (nosubtle hides crypto.subtle to force the old path).
// Usage: PW_ROOT=<dir with playwright installed> node engine-cache-repro.mjs <engine> <sha256.mjs> variant ...
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require = createRequire((process.env.PW_ROOT || '.') + '/package.json');
const playwright = require('playwright');
const [engine, shaPath, ...variants] = process.argv.slice(2);
const specs = variants.map(v => { const [label, rest] = v.split('='); const [path, ra, flag] = rest.split(':'); return {label, path, readAhead: ra && ra !== '-' ? Number(ra) : undefined, nosubtle: flag === 'nosubtle'}; });
const files = {'sha256.mjs': await readFile(shaPath, 'utf8')};
for (const spec of specs) {
  let text = await readFile(spec.path, 'utf8');
  if (spec.nosubtle) text = text.replaceAll('globalThis.crypto?.subtle', 'false');
  files[`${spec.label}.mjs`] = text;
}
const browser = await playwright[engine].launch();
const context = await browser.newContext({ignoreHTTPSErrors: true});
await context.route('https://next.facemorph.me/__t/*', route => {
  const name = route.request().url().split('/').pop();
  route.fulfill({status: 200, contentType: 'text/javascript', headers: {'Access-Control-Allow-Origin': '*'}, body: files[name]});
});
const page = await context.newPage();
await page.goto('https://next.facemorph.me/runtime/manifest.json');
const workerSource = `
self.onmessage = async ({data: {label, readAhead, asset}}) => {
  try {
    const {createModelCache} = await import('https://next.facemorph.me/__t/' + label + '.mjs');
    const entries = new Map(), events = [], pieces = [];
    const store = {get: async h => entries.has(h) ? new Response(entries.get(h)) : undefined,
      put: async (h, r) => { const reader = r.body.getReader(), got = []; for (;;) { const {value, done} = await reader.read(); if (done) break; pieces.push(value.byteLength); got.push(value); }
        let n = 0; for (const g of got) n += g.byteLength; const out = new Uint8Array(n); let at = 0; for (const g of got) { out.set(g, at); at += g.byteLength; } entries.set(h, out); },
      remove: async h => entries.delete(h)};
    const cache = createModelCache({store, report: e => events.push(e.status), ...(readAhead ? {readAhead} : {})});
    const t = performance.now();
    try { const handle = await cache.acquire(asset); await handle.open(); postMessage({label, ok: true, ms: Math.round(performance.now() - t), maxPiece: Math.max(...pieces), pieces: pieces.length}); }
    catch (error) { postMessage({label, ok: false, ms: Math.round(performance.now() - t), name: error.name, message: String(error.message).slice(0, 200), stack: String(error.stack).slice(0, 500), events: events.slice(-6)}); }
  } catch (error) { postMessage({label, ok: false, setup: true, name: error.name, message: String(error.message).slice(0, 300)}); }
};`;
const results = [];
for (const spec of specs) {
  results.push(await page.evaluate(({label, readAhead, source}) => new Promise(async resolve => {
    const manifest = await (await fetch('/runtime/manifest.json')).json();
    const worker = new Worker(URL.createObjectURL(new Blob([source], {type: 'text/javascript'})));
    worker.onmessage = e => { resolve(e.data); worker.terminate(); };
    worker.onerror = e => { resolve({label, ok: false, workerError: String(e.message || e)}); };
    worker.postMessage({label, readAhead, asset: manifest.webgpu.prefix});
  }), {label: spec.label, readAhead: spec.readAhead, source: workerSource}));
}
console.log('REPRO ' + JSON.stringify({engine, results}));
await browser.close();
