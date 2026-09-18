import assert from 'node:assert/strict';
import fs from 'node:fs';
import {planSuite,applyInterruptedRoutes} from './suite-policy-v2.js';
import {installBufferBudget} from './gpu-memory-budget-v1.js';
const config=JSON.parse(fs.readFileSync(new URL('./experiments-v21.json',import.meta.url)));
const plan=(platform,maxTouchPoints=0,binding=1073741824)=>planSuite(config,{platform,maxTouchPoints,gpu:{limits:{maxStorageBufferBindingSize:binding}}},{crossOriginIsolated:true,hardwareConcurrency:4});
for(const p of [plan('iPhone',5),plan('iPad',5),plan('MacIntel',5)]){
 assert.equal(p.facts.ios,true);assert.deepEqual(p.decisions.filter(d=>d.status!=='skipped').map(d=>d.id),['colour','ffmpeg','iphone-memory','cpu-1','cpu-4']);
 applyInterruptedRoutes(p,[{version:config.version,id:'iphone-memory'}],config.version);
 assert.equal(p.decisions.find(d=>d.id==='iphone-memory').status,'skipped');assert.equal(p.decisions.find(d=>d.id==='cpu-1').status,'selected');
}
assert.equal(plan('MacIntel').decisions.find(d=>d.id==='best').status,'selected');
assert.equal(plan('Linux armv8l',5,134217728).decisions.find(d=>d.id==='mobile-boundary-bounded').status,'selected');
const fresh=plan('iPhone');applyInterruptedRoutes(fresh,[{version:'old',id:'iphone-memory'}],config.version);assert.equal(fresh.decisions.find(d=>d.id==='iphone-memory').status,'selected');
globalThis.GPUBuffer=class{destroy(){this.destroyed=true;}};globalThis.GPUDevice=class{createBuffer(d){return Object.assign(new GPUBuffer(),d);}};
const original=GPUDevice.prototype.createBuffer,budget=installBufferBudget(100),device=new GPUDevice(),a=device.createBuffer({size:60});assert.throws(()=>device.createBuffer({size:50}),/budget exceeded/);assert.equal(budget.snapshot().peakBytes,60);a.destroy();a.destroy();assert.equal(budget.snapshot().liveBytes,0);device.createBuffer({size:90});assert.equal(budget.snapshot().peakBytes,90);budget.restore();assert.equal(GPUDevice.prototype.createBuffer,original);
console.log('iOS selection, interrupted-route recovery and allocation guard passed');
