import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {admitRuntimeManifest,RuntimeManifestRefused} from './runtime-manifest.mjs';
import {createBrowserRuntime} from './runtime.mjs';

const pin=n=>String(n).repeat(64),asset=(n,size=4)=>({url:`https://model.example/asset-${n}`,sha256:pin(n),size});
const manifest=()=>({schemaVersion:1,bundleVersion:'atomic-admission-test',modelSourceSha256:pin(1),noiseSha256:pin(2),
 mapping:asset(3),synthesis:asset(4),noise:[{...asset(5),name:'noise_0',shape:[1]}],canaries:[{},{}],
 encoder:asset(6),alignmentSha256:pin(7),encoderStream:{...asset(8),sourceEncoderSha256:pin(6),preprocessingSha256:pin(7),phoneAdmitted:true,maxWasmBytes:268435456}});
const refused=(reason,path)=>error=>error instanceof RuntimeManifestRefused&&error.code==='manifest-rejected'&&error.reason===reason&&error.path===path&&error.reload===true;

test('runtime admission accepts a complete compatible manifest without changing it',()=>{
 const candidate=manifest(),before=structuredClone(candidate);
 assert.equal(admitRuntimeManifest(candidate),candidate);
 assert.deepEqual(candidate,before);
 // A missing optional counterpart is a separate operation-admission question.
 delete candidate.encoder;delete candidate.alignmentSha256;
 assert.equal(admitRuntimeManifest(candidate),candidate);
});
test('runtime admission rejects newer, structurally mixed and cross-linked incompatible catalogues as typed data',()=>{
 const cases=[
  [{...manifest(),schemaVersion:2},'newer-major','$.schemaVersion'],
  [{...manifest(),synthesis:{...asset(4,8),chunks:[asset(3,4)]}},'invalid-asset','$.synthesis.chunks'],
  [{...manifest(),encoderStream:{...manifest().encoderStream,sourceEncoderSha256:pin(9)}},'invalid-field','$.encoderStream.sourceEncoderSha256'],
  [{...manifest(),encoderStream:{...manifest().encoderStream,preprocessingSha256:pin(9)}},'invalid-field','$.encoderStream.preprocessingSha256'],
  [{...manifest(),canaries:[{}]},'invalid-field','$.canaries']
 ];
 for(const[candidate,reason,path]of cases)assert.throws(()=>admitRuntimeManifest(candidate),refused(reason,path));
});

test('bad pointer then valid pointer retries atomically with zero workers or asset side effects',async t=>{
 const oldFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=oldFetch;});
 const good=manifest(),bad={...good,encoderStream:{...good.encoderStream,preprocessingSha256:pin(9)}};
 const requests=[];let workers=0,alignments=0,encoders=0;
 globalThis.fetch=async url=>{requests.push(url);return new Response(JSON.stringify(requests.length===1?bad:good));};
 const runtime=createBrowserRuntime({manifestUrl:'https://app.example/runtime/manifest.json',preferredRoute:'cpu',
  workerFactory:()=>{workers++;throw Error('planning must not start a worker');},
  alignPhoto:async()=>{alignments++;throw Error('planning must not align');},
  imageEncoderFactory:()=>{encoders++;throw Error('planning must not encode');}});
 t.after(()=>runtime.dispose());
 await assert.rejects(runtime.plan(),refused('invalid-field','$.encoderStream.preprocessingSha256'));
 assert.deepEqual([workers,alignments,encoders],[0,0,0]);
 assert.equal(runtime.status().deviceValidated,false);
 const accepted=await runtime.plan();
 assert.deepEqual(accepted.manifest,good,'no part of the rejected catalogue remains active');
 assert.equal((await runtime.plan()).manifest,accepted.manifest,'an admitted runtime keeps its pinned manifest');
 assert.deepEqual(requests,['https://app.example/runtime/manifest.json','https://app.example/runtime/manifest.json']);
 assert.deepEqual([workers,alignments,encoders],[0,0,0],'only the manifest pointers were read');
});

test('supplied manifest admission also refuses incompatible identities before any request or allocation',async t=>{
 const oldFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=oldFetch;});
 let effects=0;globalThis.fetch=async()=>{effects++;throw Error('unexpected fetch');};
 const bad={...manifest(),encoderStream:{...manifest().encoderStream,sourceEncoderSha256:pin(9)}};
 const runtime=createBrowserRuntime({manifest:bad,manifestSha256:pin(0),workerFactory:()=>{effects++;throw Error('unexpected worker');}});
 t.after(()=>runtime.dispose());
 await assert.rejects(runtime.plan(),refused('invalid-field','$.encoderStream.sourceEncoderSha256'));
 assert.equal(effects,0);
 const valid=createBrowserRuntime({manifest:manifest(),manifestSha256:pin(0),workerFactory:()=>{effects++;throw Error('unexpected worker');}});
 t.after(()=>valid.dispose());
 assert.equal((await valid.plan()).manifest.bundleVersion,'atomic-admission-test');
 assert.equal(effects,0);
});

test('concurrent callers share one rejected pointer and a later call can retry valid JSON',async t=>{
 const oldFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=oldFetch;});
 let requests=0;
 globalThis.fetch=async()=>new Response(++requests===1?'malformed JSON':JSON.stringify(manifest()));
 const runtime=createBrowserRuntime({preferredRoute:'cpu',workerFactory:()=>{throw Error('unexpected worker');}});
 t.after(()=>runtime.dispose());
 const rejected=await Promise.allSettled([runtime.plan(),runtime.plan()]);
 assert.equal(requests,1);
 assert.ok(rejected.every(result=>result.status==='rejected'&&refused('invalid-field','$')(result.reason)));
 assert.equal((await runtime.plan()).manifest.bundleVersion,'atomic-admission-test');
 assert.equal(requests,2);
});

const productionPath=join(process.env.FACEMORPH_RUNTIME_CACHE??join(homedir(),'.cache/facemorph-runtime'),'manifest.json');
test('the acquired production descriptor passes the same runtime admission',{skip:!existsSync(productionPath)?'untested: qualified runtime manifest is not acquired':false},()=>{
 const candidate=JSON.parse(readFileSync(productionPath,'utf8'));
 assert.equal(admitRuntimeManifest(candidate),candidate);
});
