import {readFile,writeFile}from'node:fs/promises';
import {fileURLToPath}from'node:url';
import {createHash}from'node:crypto';
import createPhotoModule from'./dist/photo-native.mjs';
import {inspectImage}from'./image-header.mjs';
const C=new URL('.',import.meta.url),R=new URL('../',C),path=p=>fileURLToPath(new URL(p,C));
const manifest=JSON.parse(await readFile(new URL('fixtures/manifest.json',C),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const m=await createPhotoModule({wasmBinary:await readFile(new URL('dist/photo-native.wasm',C))});
const check=result=>{if(result<0)throw Error(m.UTF8ToString(m._cf_error()));return result;};
const model=await readFile(new URL('experiment/hf/models/e4e/shape_predictor_68_face_landmarks.dat',R));
let p=m._malloc(model.length);if(!p)throw Error('model malloc');m.HEAPU8.set(model,p);check(m._cf_init_predictor(p,model.length));m._free(p);
const results=[];
for(const fixture of manifest.cases){
 const start=performance.now(),bytes=await readFile(new URL('fixtures/'+fixture.input,C));inspectImage(bytes);p=m._malloc(bytes.length);m.HEAPU8.set(bytes,p);check(m._cf_decode(p,bytes.length));m._free(p);
 const count=fixture.tryAlign?check(m._cf_detect()):0;
 let landmarkExact=true;
 if(fixture.tryAlign){if(count!==fixture.landmarks.length)landmarkExact=false;p=m._malloc(68*2*4);for(let i=0;i<count;i++){check(m._cf_landmarks(i,p));const actual=new Int32Array(m.HEAPU8.buffer,p,136);if(JSON.stringify([...actual])!==JSON.stringify(fixture.landmarks[i].flat()))landmarkExact=false;}m._free(p);}
 const aligned=Boolean(check(m._cf_prepare(fixture.tryAlign?1:0))),actual=m.HEAPU8.slice(m._cf_prepared(),m._cf_prepared()+196608),reference=await readFile(new URL('fixtures/'+fixture.prepared,C));
 let max=0,unequal=0;for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-reference[i]);max=Math.max(max,d);if(d)unequal++;}
 const tensor=new Float32Array(196608);for(let i=0;i<65536;i++)for(let c=0;c<3;c++){let f=Math.fround(actual[i*3+c]/255);f=Math.fround(f-.5);tensor[c*65536+i]=Math.fround(f/.5);}
 const tensorExact=sha(new Uint8Array(tensor.buffer))===fixture.tensorSha256;
 const row={id:fixture.id,landmarkExact,aligned,expectedAligned:fixture.didAlign,rgbMaxError:max,unequalRgb:unequal,tensorExact,ms:performance.now()-start,wasmCapacityBytes:m.HEAPU8.buffer.byteLength,passed:landmarkExact&&aligned===fixture.didAlign&&max===0&&tensorExact};
 results.push(row);await writeFile(path('verification.json'),JSON.stringify({environment:'Node executing actual unshared WASM; not browser/device qualification',cases:results,completed:false},null,2));
 console.log(JSON.stringify(row));
 await writeFile(path('fixtures/'+fixture.id+'.candidate.rgb'),actual);
}
m._cf_reset();const passed=results.every(r=>r.passed);await writeFile(path('verification.json'),JSON.stringify({environment:'Node executing actual unshared WASM; not browser/device qualification',cases:results,completed:true,passed,encoderExecuted:false},null,2));if(!passed)process.exitCode=1;
