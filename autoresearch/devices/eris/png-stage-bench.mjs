// Times the worker's post-inference stages in isolation, with the product's own modules:
//   raw float32 CHW -> rgba1024 -> encodeRgbaPng (scanlines + CompressionStream deflate + CRC).
// The input is a smooth face-like field plus mild noise, so deflate sees realistic entropy.
// Usage: node png-stage-bench.mjs <repo-root> [repeats]
import {pathToFileURL} from 'node:url';
const root = process.argv[2], repeats = Number(process.argv[3] || 12);
const {encodeRgbaPng} = await import(pathToFileURL(root + '/src/Next/browser/png.mjs'));
const {rgba1024} = await import(pathToFileURL(root + '/src/Next/browser/identity.mjs'));
const raw = new Float32Array(3 * 1024 * 1024);
let seed = 1; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (let c = 0; c < 3; c++) for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++)
  raw[c * 1048576 + y * 1024 + x] = Math.sin(x / 90 + c) * Math.cos(y / 140) * 0.7 + (rnd() - 0.5) * 0.08;
const ms = f => { const t = performance.now(); return [f(), performance.now() - t]; };
const rows = [];
for (let i = 0; i < repeats; i++) {
  const [rgba, tRgba] = ms(() => rgba1024(raw));
  const t0 = performance.now();
  const blob = await encodeRgbaPng(rgba);
  rows.push({rgbaMs: tRgba, pngMs: performance.now() - t0, bytes: blob.size});
}
const med = k => rows.slice(2).map(r => r[k]).sort((a, b) => a - b)[Math.floor((rows.length - 2) / 2)];
console.log(JSON.stringify({node: process.version, repeats, medianRgbaMs: +med('rgbaMs').toFixed(1), medianPngMs: +med('pngMs').toFixed(1), pngBytes: rows[0].bytes}));
