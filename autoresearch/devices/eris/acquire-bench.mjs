// Cold acquisition of the whole WebGPU asset set (prefix + wasm + mapping + noise + the rest: ~190 MiB) through
// the product's own model-cache.mjs against the live origin, old module vs new module, interleaved.
// In-memory store that consumes the stream like Cache.put does, so network + both hashes + verification are
// measured and browser storage is not. Correctness gate: stored bytes must hash to the manifest sha256.
// Usage: node acquire-bench.mjs <manifest.json> <old-module.mjs> <new-module.mjs> [rounds] [no-whole-asset-hash-module.mjs]
// The optional fourth arm drops the second, whole-asset JS hash for chunked assets (chunks stay individually verified).
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [manifestPath, oldPath, newPath, rounds = '3', noWholePath] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(manifestPath));
const {createModelCache: oldCache} = await import(pathToFileURL(oldPath));
const {createModelCache: newCache} = await import(pathToFileURL(newPath));
const assets = [];
(function walk(o) {
  if (Array.isArray(o)) return o.forEach(walk);
  if (o && typeof o === 'object') { if (o.sha256 && o.size !== undefined && o.url) assets.push(o); else Object.values(o).forEach(walk); }
})([manifest.webgpu, manifest.mapping, manifest.average, manifest.noise]);
const unique = [...new Map(assets.map(a => [a.sha256, a])).values()];
const totalMiB = unique.reduce((n, a) => n + a.size, 0) / 1048576;
const {createModelCache: nwCache} = noWholePath ? await import(pathToFileURL(noWholePath)) : {};
const arms = {
  old:   () => oldCache,
  ra2:   () => options => newCache({...options, readAhead: 2}),
  ra4:   () => options => newCache({...options, readAhead: 4}),
  ...(noWholePath ? {ra4nw: () => options => nwCache({...options, readAhead: 4})} : {}),
};
async function run(name) {
  const entries = new Map();
  const store = {
    get: async hash => entries.has(hash) ? new Response(entries.get(hash)) : undefined,
    put: async (hash, response) => { entries.set(hash, new Uint8Array(await response.arrayBuffer())); },
    remove: async hash => entries.delete(hash)
  };
  const cache = arms[name]()({store, report: () => {}});
  const t = performance.now();
  await Promise.all(unique.map(a => cache.acquire(a)));
  const ms = performance.now() - t;
  for (const a of unique) if (createHash('sha256').update(entries.get(a.sha256)).digest('hex') !== a.sha256) throw new Error(`${name}: ${a.sha256} stored bytes do not match`);
  return ms;
}
const order = ['old', 'ra2', 'ra4', ...(noWholePath ? ['ra4nw'] : [])];
const results = Object.fromEntries(order.map(n => [n, []]));
await run('old'); // edge warm-up, discarded
for (let r = 0; r < Number(rounds); r++) {
  const sequence = r % 2 ? [...order].reverse() : order;
  for (const name of sequence) results[name].push(Math.round(await run(name)));
}
const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(JSON.stringify({node: process.version, assets: unique.length, totalMiB: Math.round(totalMiB),
  medianMs: Object.fromEntries(order.map(n => [n, med(results[n])])), raw: results, gate: 'every stored asset hashed to its manifest sha256'}));
