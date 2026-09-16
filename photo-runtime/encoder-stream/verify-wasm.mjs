import {readFile,writeFile}from'node:fs/promises';
import {pathToFileURL,fileURLToPath}from'node:url';
import {resolve}from'node:path';
import {createHash}from'node:crypto';
import {executeEncoderStream}from'./execute.mjs';
const root=pathToFileURL(resolve(process.argv[2]||'/private/tmp/checkface-next-runtime/runtime/encoder-stream')+'/'),manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
const wrapper=new URL('./observed-factory.work.mjs',import.meta.url);
await writeFile(wrapper,`import factory from ${JSON.stringify(new URL('ort-wasm-simd.mjs',root).href)};export default async function(config){const m=await factory(config);globalThis.__encoderHeap= new WeakRef(m);return m;}`);
const ort=await import(new URL('ort.wasm.min.mjs',root));ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths={mjs:wrapper.href,wasm:new URL('ort-wasm-simd-256m.wasm',root).href};
const snapshotMemory=()=>{const buffer=globalThis.__encoderHeap?.deref()?.HEAPU8?.buffer;return{available:Boolean(buffer),shared:buffer instanceof SharedArrayBuffer,currentBytes:buffer?.byteLength};};
async function bytes(asset){const buffer=await readFile(new URL(asset.file||new URL(asset.url).pathname.split('/').pop(),root));if(buffer.length!==asset.size||createHash('sha256').update(buffer).digest('hex')!==asset.sha256)throw Error('Asset changed');return new Uint8Array(buffer.buffer,buffer.byteOffset,buffer.length);}
const results=[];
for(const c of manifest.canaries){const input=await bytes(c.input),reference=await bytes(c.reference),tensor=new Float32Array(input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength)),expected=new Float32Array(reference.buffer.slice(reference.byteOffset,reference.byteOffset+reference.byteLength));const start=performance.now();
 const result=await executeEncoderStream({ort,manifest,tensor,acquireBytes:bytes,snapshotMemory,onProgress:e=>{if(e.loaded%12===0)console.log(c.id,e.stage,e.loaded,'heap',snapshotMemory().currentBytes);}});
 let max=0;for(let i=0;i<9216;i++)max=Math.max(max,Math.abs(result.values[i]-expected[i]));const row={id:c.id,maxWError:max,passed:max<=.0001,ms:performance.now()-start,stats:result.encoderStats};results.push(row);console.log(JSON.stringify({id:c.id,maxWError:max,passed:row.passed,ms:row.ms,wasmPeakBytes:row.stats.wasmPeakBytes,managedPeakEstimateBytes:row.stats.managedPeakEstimateBytes}));
 await writeFile(new URL('qualification/wasm-report.json',import.meta.url),JSON.stringify({environment:'Node running actual browser ORT Web unshared WASM with256MiB hard heap maximum; not browser/device qualification',runtime:manifest.runtime,cases:results,completed:false},null,2));if(!row.passed)throw Error('W+ correctness failed');
}
await writeFile(new URL('qualification/wasm-report.json',import.meta.url),JSON.stringify({environment:'Node running actual browser ORT Web unshared WASM with256MiB hard heap maximum; not browser/device qualification',runtime:manifest.runtime,cases:results,completed:true,passed:true},null,2));
