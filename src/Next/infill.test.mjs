import test from 'node:test';import assert from 'node:assert/strict';import {infillIndices} from './infill.mjs';
test('infill exposes endpoints then midpoints and quarters while covering every canonical index once',()=>{
 const order=[...infillIndices(32,16)];assert.deepEqual(order.slice(0,8),[0,16,8,24,4,12,20,28]);
 assert.deepEqual([...order].sort((a,b)=>a-b),Array.from({length:32},(_,i)=>i));
 for(const total of [16,26,64]){const values=[...infillIndices(total,8)];assert.equal(new Set(values).size,total);assert.equal(values.length,total);}
});
