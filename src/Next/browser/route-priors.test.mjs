// FALLBACK INVARIANT (operator direction, 19 September): a fallback must never select a
// route whose recorded per-face cost is higher than another route still available on the
// device. Every prior that carries measurements must therefore order its routes ascending
// by measured cost, and a prior without measurements must say why its order is justified.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTE_PRIORS, priorOrder, capabilities } from './route-priors.mjs';
import {rankedRoutes} from './route-selection.mjs';

test('reload never explores slower-prior WebGL just because the known route costs over 3 seconds',()=>{
 assert.deepEqual(rankedRoutes({android:true,webgpu:true},['webgpu','cpu','webgl'],{webgpu:3100,cpu:4100}),['webgpu','cpu','webgl']);
 assert.deepEqual(rankedRoutes({android:true,webgpu:false},['cpu','webgl'],{cpu:4100}),['cpu','webgl']);
 assert.deepEqual(rankedRoutes({android:true,webgpu:true},['webgpu','cpu','webgl'],{cpu:4100}),['webgpu','cpu','webgl'],'A newly available higher-priority route is still eligible');
 assert.deepEqual(rankedRoutes({android:true,webgpu:true},['webgpu','cpu','webgl'],{webgpu:18000,cpu:4100,webgl:1000}),['webgpu','cpu','webgl'],'Slow timings never demote a working route');
});

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

test('desktop without a usable WebGPU adapter tries CPU before WebGL', () => {
 // A Linux desktop whose navigator.gpu had no adapter ran every face on WebGL at 7.4 s (8 Oct
 // diagnostics). The operator ruling is WebGPU -> CPU -> WebGL until data shows otherwise.
 for (const userAgent of ['Mozilla/5.0 (X11; Linux x86_64) Chrome/154', 'Mozilla/5.0 (Windows NT 10.0) Chrome/153', 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/151']) {
  const desktop = { ...capabilities({ navigator: { userAgent } }), webgpu: false, webgl: true };
  assert.deepEqual(priorOrder(desktop, ['cpu', 'webgl']), ['cpu', 'webgl'], userAgent);
 }
});
