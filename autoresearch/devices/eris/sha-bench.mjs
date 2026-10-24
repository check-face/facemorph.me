// Cost of verifying a model download, with the product's own incremental Sha256 and the platform digest.
// Feeds 150 MiB in 64 KiB pieces (what a network reader hands over), the shape verifiedStream sees.
// Usage: node sha-bench.mjs <repo-root> [rounds]
import {pathToFileURL} from 'node:url';
import {webcrypto} from 'node:crypto';
const root = process.argv[2], rounds = Number(process.argv[3] || 5);
const {Sha256} = await import(pathToFileURL(root + '/src/Next/Assets/sha256.mjs'));
const MiB = 1048576, total = 150 * MiB, piece = 65536;
const data = new Uint8Array(16 * MiB); for (let i = 0; i < data.length; i += 4096) data[i] = i >> 12;
const out = {js: [], subtle16: []};
for (let r = 0; r < rounds; r++) {
  let t = performance.now(); const h = new Sha256();
  for (let done = 0; done < total; done += piece) h.update(data.subarray(done % data.length, done % data.length + piece));
  h.hex(); out.js.push(performance.now() - t);
  t = performance.now();
  for (let done = 0; done < total; done += data.length) await webcrypto.subtle.digest('SHA-256', data);
  out.subtle16.push(performance.now() - t);
}
const med = a => a.slice(1).sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)];
console.log(JSON.stringify({node: process.version, mib: total / MiB, jsMsMedian: Math.round(med(out.js)), jsMBps: Math.round(150 / (med(out.js) / 1000)), subtleMsMedian: Math.round(med(out.subtle16)), raw: out}));
