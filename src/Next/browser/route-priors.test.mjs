// FALLBACK INVARIANT (operator direction, 19 September): a fallback must never select a
// route whose recorded per-face cost is higher than another route still available on the
// device. Every prior that carries measurements must therefore order its routes ascending
// by measured cost, and a prior without measurements must say why its order is justified.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTE_PRIORS, priorOrder, capabilities } from './route-priors.mjs';

test('every measured prior orders routes ascending by recorded per-face cost', () => {
 let measuredEntries = 0;
 for (const entry of ROUTE_PRIORS) {
  if (!entry.measured) continue;
  measuredEntries++;
  for (let i = 1; i < entry.order.length; i++) {
   const slower = entry.measured[entry.order[i - 1]];
   const faster = entry.measured[entry.order[i]];
   if (slower === undefined || faster === undefined) continue; // pairs with an unmeasured route are priors, not findings
   assert.ok(slower <= faster, `${entry.order.join('>')} ranks ${entry.order[i]} (${faster} ms) ahead of the faster ${entry.order[i - 1]} (${slower} ms)`);
  }
 }
 assert.ok(measuredEntries >= 2, 'the webgpu-first and android priors carry the S24/Mac measurements');
});

test('an unmeasured prior must justify its ordering in words', () => {
 for (const entry of ROUTE_PRIORS) {
  if (entry.measured) continue;
  assert.match(entry.because || '', /(not measured|unmeasured|avoids|no WebGPU adapter|memory)/i, 'unmeasured orderings need a stated reason');
 }
});

test('priorOrder keeps only supported routes and appends unranked ones last', () => {
 const caps = { ...capabilities({ navigator: { gpu: {} } }), webgpu: true, webgl: true };
 assert.deepEqual(priorOrder(caps, ['cpu', 'webgpu', 'webgl']), ['webgpu', 'cpu', 'webgl']);
 assert.deepEqual(priorOrder(caps, ['cpu']), ['cpu'], 'a device without GPU routes falls back to CPU alone');
 const androidCaps = { ...capabilities({ navigator: { userAgent: 'Android' } }), webgpu: false, webgl: true };
 assert.deepEqual(priorOrder(androidCaps, ['cpu', 'webgl']), ['cpu', 'webgl'], 'S24 fallback order: CPU before WebGL, never the reverse');
});
