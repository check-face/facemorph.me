import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createLatentPath, GEOMETRY_VERSION } from './latent-path.mjs';
const norm = v => Math.hypot(...v);
const sub = (a, b) => a.map((x, d) => x - b[d]);
const near = (a, b, tolerance = 1e-8) => assert(norm(sub(a, b)) < tolerance, `difference ${norm(sub(a, b))} >= ${tolerance}`);
function project(points, kind = 'full-smooth-figure8', options = {}) {
  const { layers = 1, ...rest } = options;
  return { algorithmVersion: GEOMETRY_VERSION, kind, closed: true, width: .2, pinchCenter: false, framesPerSegment: 4, framesPerSecond: 24,
    controls: points.map((p, i) => ({ visitId: `visit-${i}`, latent: { space: layers === 1 ? 'w' : 'w-plus', shape: layers === 1 ? [512] : [18, 512], values: Array.from({ length: layers * 512 }, (_, d) => d % 512 === 0 ? p[0] * (1 + Math.floor(d / 512) / 20) : d % 512 === 256 ? p[1] * (1 + Math.floor(d / 512) / 20) : 0) } })), ...rest };
}
const ring = n => Array.from({ length: n }, (_, i) => [Math.cos(i * 2 * Math.PI / n) * (1 + i / 10), Math.sin(i * 2 * Math.PI / n)]);
const shared = [[0, 0], [2, 0], [0, 0], [0, 2]];
const html = fs.readFileSync(new URL('./reference/shape-explorer.html', import.meta.url), 'utf8');
const context = vm.createContext({ document: {} });
vm.runInContext(html.split('<script>')[1].split('const canvas=')[0], context);
let referenceCases = 0;
// Independently executed reviewed spike: planar fixtures make its surrogate J exactly
// the true512D rotation, so no copied implementation is used as the reference oracle.
for (const points of [ring(2), ring(3), ring(5), shared]) for (const mode of ['ellipse', 'figure8']) for (const pinchCenter of [false, true]) for (const width of [.2, 1.2]) {
  const m = project(points, `full-smooth-${mode}`, { pinchCenter, width });
  const path = createLatentPath(m);
  context.pointsInput = points.map(p => [...p, 0]); context.modeInput = mode; context.pinchInput = pinchCenter; context.widthInput = width;
  vm.runInContext('Object.assign(state,{points:pointsInput,mode:modeInput,pinch:pinchInput,amplitude:widthInput});geom=build()', context);
  for (let i = 0; i < points.length; i++) for (const u of [0, .1, .26, .499, .5, .501, .74, .9, 1]) {
    context.iInput = i; context.uInput = u;
    const reference = vm.runInContext('curve(iInput,uInput)', context), actual = path.sample(i, u);
    near([actual[0], actual[256], 0], Array.from(reference));
  }
  referenceCases++;
}
function jets(fn, x, sign) {
  const h = .0001, samples = [0, 1, 2, 3, 4].map(j => fn(x + sign * j * h));
  const weighted = weights => samples[0].map((_, d) => weights.reduce((s, c, j) => s + c * samples[j][d], 0));
  return { v: weighted([-25, 48, -36, 16, -3]).map(x => x * sign / (12 * h)), a: weighted([35, -104, 114, -56, 11]).map(x => x / (12 * h * h)) };
}
let invariantCases = 0;
for (const layers of [1, 18]) for (const points of [ring(2), ring(3), ring(5), shared]) for (const mode of ['ellipse', 'figure8']) for (const pinchCenter of [false, true]) {
  const m = project(points, `full-smooth-${mode}`, { layers, pinchCenter }), path = createLatentPath(m);
  for (let i = 0; i < points.length; i++) {
    assert.deepEqual(Array.from(path.sample(i, 0)), m.controls[i].latent.values);
    assert.deepEqual(Array.from(path.sample(i, 1)), m.controls[(i + 1) % points.length].latent.values);
    const left = jets(u => path.sample((i + points.length - 1) % points.length, u), 1, -1), right = jets(u => path.sample(i, u), 0, 1);
    near(left.v, right.v, 1e-6); near(left.a, right.a, .002);
    if (mode === 'figure8' || pinchCenter) {
      const a = m.controls[i].latent.values, b = m.controls[(i + 1) % points.length].latent.values;
      near(path.sample(i, .5), a.map((x, d) => (x + b[d]) / 2));
    }
    const lmid = jets(u => path.sample(i, u), .5, -1), rmid = jets(u => path.sample(i, u), .5, 1);
    near(lmid.v, rmid.v, 1e-5); near(lmid.a, rmid.a, .004);
    if (pinchCenter) {
      const chord = sub(m.controls[(i + 1) % points.length].latent.values, m.controls[i].latent.values);
      const scale = lmid.v.reduce((s, x, d) => s + x * chord[d], 0) / chord.reduce((s, x) => s + x * x, 0);
      assert(scale > 0); near(lmid.v, chord.map(x => x * scale), 1e-5);
    }
  }
  // Actual layer transforms preserve the per-layer scale (no mixing layer halves).
  if (layers === 18) { const value = path.sample(0, .23); for (let l = 1; l < 18; l++) for (let d = 0; d < 512; d++) assert(Math.abs(value[l * 512 + d] - value[d] * (1 + l / 20)) < 1e-8); }
  invariantCases++;
}
// Dense, distinct data in every coordinate/layer catches fixed-three-component or
// flattened-half implementations that planar oracle comparisons cannot detect.
for (const layers of [1, 18]) {
  const dense = project(ring(5), 'full-smooth-figure8', { layers, pinchCenter: true });
  dense.controls.forEach((control, i) => { control.latent.values = control.latent.values.map((_, d) => Math.sin((i + 1) * (d + 1) * .017) + Math.cos((i + 3) * (d + 1) * .011)); });
  const path = createLatentPath(dense);
  for (let i = 0; i < 5; i++) {
    const before = jets(u => path.sample((i + 4) % 5, u), 1, -1), after = jets(u => path.sample(i, u), 0, 1);
    near(before.v, after.v, .0001); near(before.a, after.a, .02);
    assert.deepEqual(Array.from(path.sample(i, 0)), dense.controls[i].latent.values);
    assert(path.sample(i, .237).every(Number.isFinite));
  }
  // Independent pair ellipse formula checks J on every layer, not just planar slots.
  const pair = createLatentPath({ ...dense, kind: 'pairwise-ellipse', pinchCenter: false });
  const sample = pair.sample(0, .5), a = dense.controls[0].latent.values, b = dense.controls[1].latent.values;
  for (let d = 0; d < sample.length; d++) {
    const local = d % 512, rotatedIndex = d - local + (local + 256) % 512;
    const rotated = (local < 256 ? -1 : 1) * (a[rotatedIndex] - b[rotatedIndex]) / 2;
    assert(Math.abs(sample[d] - ((a[d] + b[d]) / 2 + dense.width * rotated)) < 1e-12);
  }
}
const largest = createLatentPath(project(ring(64))); assert.equal(largest.segments, 64); assert(largest.sample(63, .3).every(Number.isFinite));
// Independent closed-form pair ellipse and half-return orientation fixture.
const pair = project([[1, 0], [-1, 0]], 'pairwise-ellipse', { width: .4 });
const ellipse = createLatentPath(pair);
near([ellipse.sample(0, .5)[0], ellipse.sample(0, .5)[256]], [0, .4]);
near([ellipse.sample(1, .5)[0], ellipse.sample(1, .5)[256]], [0, -.4]);
for (const u of [.1, .3, .9]) near([ellipse.sample(0, u)[0], ellipse.sample(0, u)[256]], [Math.cos(Math.PI * u), .4 * Math.sin(Math.PI * u)]);
const eight = createLatentPath({ ...pair, kind: 'pairwise-figure8' });
assert(eight.sample(0, .1)[256] > 0 && eight.sample(1, .1)[256] > 0);
// Width zero must not lose repaired tangents on repeated visits.
const zeroWidth = createLatentPath(project(shared, 'full-smooth-figure8', { width: 0 }));
assert(zeroWidth.repairedTangents > 0);
for (let i = 0; i < 4; i++) assert(norm(jets(u => zeroWidth.sample(i, u), 0, 1).v) > .1);
// Visit identity, frame enumeration, input/output isolation and explicit spaces.
const m = project(shared), path = createLatentPath(m), frames = [...path.frames()];
assert.equal(frames.length, 16); assert.deepEqual(frames.filter(f => f.visitId).map(f => f.visitId), ['visit-0', 'visit-1', 'visit-2', 'visit-3']);
const endpoint = path.sample(1, 0); m.controls[1].latent.values[0] = 99; endpoint[0] = 100; assert.equal(path.sample(1, 0)[0], 2);
const open = createLatentPath(project(ring(3), 'linear', { closed: false })); assert.equal(open.totalFrames, 9); assert.equal([...open.frames()].at(-1).visitId, 'visit-2');
for (const patch of [{ algorithmVersion: 'future' }, { width: Infinity }, { width: 1.21 }, { framesPerSegment: 3 }, { framesPerSegment: 100000 }, { closed: false }, { controls: [] }]) assert.throws(() => createLatentPath({ ...project(ring(3)), ...patch }), RangeError);
for (const mutate of [m => { m.controls[0].latent.space = 'z'; }, m => { m.controls[0].latent.values[0] = NaN; }, m => { m.controls[0].visitId = m.controls[1].visitId; }, m => { m.controls[1].latent.values = m.controls[0].latent.values.slice(); }, m => { m.controls[0].latent.shape = [9216]; }]) { const invalid = project(ring(3)); mutate(invalid); assert.throws(() => createLatentPath(invalid), RangeError); }
assert.throws(() => path.sample(0, -1), RangeError); assert.throws(() => path.sample(4, 0), RangeError);
console.log(JSON.stringify({ status: 'passed', referenceCases, invariantCases, dimensions: [512, 9216], note: 'Geometry only; generated-face qualification remains required.' }));
