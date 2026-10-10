// Operator, 10 October: only availability/failure changes automatic route preference.
import test from 'node:test';import assert from 'node:assert/strict';
import {rankedRoutes} from './browser/route-selection.mjs';

test('stored slow timings cannot demote successful routes across reloads',()=>{
 for(const costs of [{webgpu:3300},{webgpu:3300,cpu:4100},{webgpu:3300,cpu:4100,webgl:18000},{webgpu:20000,cpu:1000,webgl:500}]){
  assert.deepEqual(rankedRoutes({webgpu:true,android:true},['webgpu','cpu','webgl'],costs),['webgpu','cpu','webgl']);
  assert.deepEqual(rankedRoutes({webgpu:true,android:true},['webgpu','cpu','webgl'],costs,new Set(['webgpu'])),['cpu','webgl']);
 }
});

test('the operator route preference applies equally to Android and iOS',async()=>{
 const {capabilities,priorOrder}=await import('./browser/route-priors.mjs');
 const supported=['cpu','webgl'];
 const android=capabilities({navigator:{userAgent:'Mozilla/5.0 (Linux; Android 14; SM-S928B) Chrome/153'}});
 const ios=capabilities({navigator:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0) Version/26.0 Safari'}});
 // The S24 measured CPU at roughly half WebGL, so Android leads with CPU.
 assert.deepEqual(priorOrder(android,supported),['cpu','webgl']);
 assert.deepEqual(priorOrder(ios,supported),['cpu','webgl']);
 // Wherever WebGPU is offered it leads, on either platform.
 const iosGpu=capabilities({navigator:{userAgent:'iPhone Version/26.0 Safari',gpu:{}}});
 assert.equal(priorOrder(iosGpu,['cpu','webgl','webgpu'])[0],'webgpu');
 const androidGpu=capabilities({navigator:{userAgent:'Android Chrome/153',gpu:{}}});
 assert.equal(priorOrder(androidGpu,['cpu','webgl','webgpu'])[0],'webgpu');
 // A supported route is never dropped, only reordered.
 assert.equal(priorOrder(ios,supported).length,supported.length);
});
