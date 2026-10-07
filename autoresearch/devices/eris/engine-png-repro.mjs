// Run the product's png.mjs variants in a real browser engine, in a Worker (as the product does): encode a 1024px
// frame, decode it back with the product's decoder, cross-decode old<->new output, hand the Blob to the page, store
// it in IndexedDB and decode it as an image. Reports any error with its name, which is how a Firefox-only
// "NetworkError" gets located.
// Usage: PW_ROOT=<dir with playwright> node engine-png-repro.mjs <engine> label=path ...
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const require = createRequire(resolve(process.env.PW_ROOT || '.', 'package.json'));
const playwright = require('playwright');
const [engine, ...variants] = process.argv.slice(2);
const specs = variants.map(v => { const [label, path] = v.split('='); return {label, path}; });
const files = {};
for (const spec of specs) files[`${spec.label}.mjs`] = await readFile(spec.path, 'utf8');
const browser = await playwright[engine].launch();
const context = await browser.newContext({ignoreHTTPSErrors: true});
await context.route('https://next.facemorph.me/__t/*', route => route.fulfill({status: 200, contentType: 'text/javascript', headers: {'Access-Control-Allow-Origin': '*'}, body: files[route.request().url().split('/').pop()]}));
const page = await context.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto('https://next.facemorph.me/runtime/manifest.json');
const workerSource = `
self.onmessage = async ({data: {labels}}) => {
  const out = {};
  try {
    const mods = {};
    for (const label of labels) mods[label] = await import('https://next.facemorph.me/__t/' + label + '.mjs');
    const w = 1024, h = 1024, rgba = new Uint8ClampedArray(w * h * 4);
    let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < rgba.length; i++) rgba[i] = i % 4 === 3 ? 255 : (rnd() * 255) | 0;
    const blobs = {};
    for (const label of labels) {
      const step = {};
      try { const t = performance.now(); blobs[label] = await mods[label].encodeRgbaPng(rgba); step.encodeMs = Math.round(performance.now() - t); step.bytes = blobs[label].size; }
      catch (error) { step.encodeError = error.name + ': ' + String(error.message).slice(0, 160); }
      out[label] = step;
    }
    for (const decoder of labels) for (const encoder of labels) {
      if (!blobs[encoder]) continue;
      try { const d = await mods[decoder].decodeReferencePng(await blobs[encoder].arrayBuffer()); let same = d.rgba.length === rgba.length; for (let i = 0; same && i < rgba.length; i++) if (d.rgba[i] !== rgba[i]) same = false; out[decoder]['decodes_' + encoder] = same; }
      catch (error) { out[decoder]['decodes_' + encoder] = error.name + ': ' + String(error.message).slice(0, 160); }
    }
    postMessage({out, blobs});
  } catch (error) { postMessage({fatal: error.name + ': ' + String(error.message).slice(0, 300)}); }
};`;
const result = await page.evaluate(({labels, source}) => new Promise(resolve => {
  const worker = new Worker(URL.createObjectURL(new Blob([source], {type: 'text/javascript'})));
  worker.onmessage = async ({data}) => {
    if (data.fatal) return resolve(data);
    const after = {};
    for (const [label, blob] of Object.entries(data.blobs)) {
      after[label] = {};
      try {
        const db = await new Promise((res, rej) => { const r = indexedDB.open('png-repro-' + label, 1); r.onupgradeneeded = () => r.result.createObjectStore('o'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        await new Promise((res, rej) => { const tx = db.transaction('o', 'readwrite'); tx.objectStore('o').put({blob}, 'k'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        after[label].idb = 'ok';
      } catch (error) { after[label].idb = error.name + ': ' + String(error.message).slice(0, 120); }
      try { const bmp = await createImageBitmap(blob); after[label].image = bmp.width + 'x' + bmp.height; } catch (error) { after[label].image = error.name + ': ' + String(error.message).slice(0, 120); }
    }
    resolve({out: data.out, after});
  };
  worker.onerror = e => resolve({workerError: String(e.message || e)});
  worker.postMessage({labels});
}), {labels: specs.map(s => s.label), source: workerSource});
console.log('PNGREPRO ' + JSON.stringify({engine, result}));
await browser.close();
