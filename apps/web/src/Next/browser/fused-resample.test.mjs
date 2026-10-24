import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {boundaryCode,createBoundaryPipeline} from './fused-resample-v1.mjs';

const labKernel=new URL('../../../experiment/device-lab/fused-resample-boundary-v2.js',import.meta.url);

const sha=async url=>createHash('sha256').update(await readFile(url)).digest('hex');

test('Shipped fused-resample kernel is byte-identical to the mobile-boundary-bounded lab kernel',async()=>{
  assert.equal(await sha(new URL('./fused-resample-v1.mjs',import.meta.url)),await sha(labKernel));
});

test('WGSL tap loop has zero continue statements; tiles are clamped, not skipped',()=>{
  for(const tail of [false,true])for(const variant of ['bounded','unrolled'])for(const workgroup of [64,256]){
    const code=boundaryCode({strength:0,gain:1},tail,variant,workgroup);
    assert.ok(!code.includes('continue'),`${variant}/${workgroup}/tail=${tail} emits continue`);
    assert.ok(code.includes('clamp(qy,1u,1026u)')&&code.includes('clamp(qx,1u,1026u)'),`${variant}/${workgroup}/tail=${tail} does not clamp tile reads`);
    assert.ok(code.includes('select(0.0,sample,valid)'),`${variant}/${workgroup}/tail=${tail} does not mask padding to zero`);
  }
});

test('Invalid variant or workgroup is rejected',()=>{
  assert.throws(()=>boundaryCode({strength:0,gain:1},false,'signed',256));
  assert.throws(()=>boundaryCode({strength:0,gain:1},false,'bounded',128));
  assert.throws(()=>boundaryCode({strength:0,gain:1},false,'bounded',32));
});

test('Exported API shape matches the webgpu-engine caller',async()=>{
  assert.equal(typeof boundaryCode,'function');
  assert.equal(typeof createBoundaryPipeline,'function');
  const engine=await readFile(new URL('./webgpu-engine.mjs',import.meta.url),'utf8');
  // The verified kernel is loaded through the injectable importer.
  const imported=engine.match(/const\s+\{\s*(\w+)\s*\}\s*=\s*await\s+importModule\s*\(\s*kernelUrl\s*\)/);
  assert.ok(imported,'webgpu-engine.mjs destructures one kernel export');
  assert.equal(imported[1],'createBoundaryPipeline');
  const bindKeys=['phase','phaseB','demod','noise','filter','bias','output'];
  for(const key of bindKeys)assert.ok(engine.includes(`${key}:`),`webgpu-engine.mjs does not bind ${key}`);
  const kernel=await readFile(new URL('./fused-resample-v1.mjs',import.meta.url),'utf8');
  for(const key of bindKeys)assert.ok(kernel.includes(key),'kernel bind signature lacks '+key);
  for(const tile of ['__tile0','__tile1'])assert.ok(engine.includes(`meta.phase+'${tile}'`),`engine must bind the ${tile} prefix output`);
});

test('Manifest writer embeds kernel provenance for the promote.py keep-row gate',async()=>{
  const stage=await readFile(new URL('./stage-assets.py',import.meta.url),'utf8');
  assert.ok(stage.includes("'candidateId':'mobile-boundary-bounded-phone'"));
  assert.ok(stage.includes("'sourceHash':'82bc9dd8a3128bd25c422eb36447787d4c041c4da79e7cad94aedeea1989dbd1'"));
  assert.ok(stage.includes("fused-resample-boundary-v2.js"),'staging must refuse a kernel that diverges from the lab source');
});
