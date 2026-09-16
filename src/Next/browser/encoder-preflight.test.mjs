import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifyEncoderReference} from './encoder-preflight.mjs';
const config={sourceEncoderSha256:'source',canaries:[{id:'seed-0-aligned',input:{size:786432},reference:{size:36864}}]};
const acquireBytes=async asset=>new Uint8Array(asset.size);
test('Encoder canary records the exact manifest and observed heap before user work',async()=>{let calls=0;const result=await qualifyEncoderReference({config,manifestSha256:'pinned',acquireBytes,execute:async tensor=>{calls++;assert.equal(tensor.length,196608);return {values:new Float32Array(9216),encoderStats:{wasmPeakBytes:98435072}};}});assert.equal(calls,1);assert.equal(result.passed,true);assert.equal(result.manifestSha256,'pinned');assert.equal(result.wasmPeakBytes,98435072);});
for(const bad of [NaN,Infinity,.001])test(`Encoder canary fails closed for ${bad}`,async()=>{let userEncoded=false;await assert.rejects(async()=>{await qualifyEncoderReference({config,manifestSha256:'pinned',acquireBytes,execute:async()=>{const values=new Float32Array(9216);values[421]=bad;return {values};}});userEncoded=true;},/correctness check failed/);assert.equal(userEncoded,false);});
test('Missing or malformed pinned inputs fail before any session',async()=>{let calls=0;for(const candidate of [{canaries:[]},config])await assert.rejects(qualifyEncoderReference({config:candidate,manifestSha256:'pinned',acquireBytes:async()=>new Uint8Array(4),execute:async()=>{calls++;}}));assert.equal(calls,0);});
