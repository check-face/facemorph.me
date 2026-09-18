import assert from 'node:assert/strict';
import {boundaryCode} from './fused-resample-boundary-v1.js';
import {planSuite} from './suite-policy-v1.js';
import fs from 'node:fs';
for(let c=0;c<32;c++)for(const y of [0,1,2,511,512,1022,1023])for(const x of [0,1,2,511,512,1022,1023])for(let fy=0;fy<4;fy++)for(let fx=0;fx<4;fx++){
 const sy=y+fy-1,sx=x+fx-1,valid=sy>=0&&sy<1026&&sx>=0&&sx<1026;
 const iy=Math.max(1,Math.min(1026,y+fy))-1,ix=Math.max(1,Math.min(1026,x+fx))-1;
 const local=(((c%16)*4+(iy%2)*2+ix%2)*513+Math.floor(iy/2))*513+Math.floor(ix/2);
 assert(local>=0&&local<16842816);
 if(valid){const original=((c*4+(sy%2)*2+sx%2)*513+Math.floor(sy/2))*513+Math.floor(sx/2);assert.equal(local+(c>=16?16842816:0),original);}
}
for(const v of ['bounded','unrolled']){const s=boundaryCode({strength:.01,gain:1.414},true,v);assert(!s.includes('continue'));assert(!s.includes('i32('));assert.equal((s.match(/let padded=/g)||[]).length,v==='unrolled'?16:1);}
const cfg=JSON.parse(fs.readFileSync(new URL('./experiments-v16.json',import.meta.url)));const p=planSuite(cfg,{gpu:{limits:{maxStorageBufferBindingSize:134217728}}},{crossOriginIsolated:true,hardwareConcurrency:5});for(const id of ['mobile-boundary-bounded','mobile-boundary-unrolled','cpu-4'])assert.equal(p.decisions.find(d=>d.id===id).status,'selected');for(const id of ['mobile-stage-256','mobile-stage-64','cpu-weight-4'])assert.equal(p.decisions.find(d=>d.id===id).status,'skipped');console.log('Boundary address equivalence, valid reads, shader variants and phone suite routing pass');
