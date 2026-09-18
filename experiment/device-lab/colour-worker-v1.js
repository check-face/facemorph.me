import {conversion} from '../onnx/web/gpu-processing.js';
self.onmessage=async()=>{
 let device;const buffers=[];const row={kind:'colour-diagnostic',completed:false,checks:[],gpuErrors:[]};
 try{
  postMessage({progress:'Checking exact GPU colour conversion without the model…'});
  const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw Error('WebGPU unavailable');device=await adapter.requestDevice();
  device.addEventListener('uncapturederror',e=>row.gpuErrors.push(e.error.message));device.pushErrorScope('validation');
  const n=1048576,input=new Float32Array(n*3),ref=new Uint8ClampedArray(n*4);
  const values=[-3,-2,-1,-.999,-.5,-.001,0,.001,.5,.999,1,2,3];
  for(let i=0;i<n;i++){for(let c=0;c<3;c++){const v=values[(Math.floor(i/1024/32)+Math.floor((i%1024)/32)+c*4)%values.length];input[c*n+i]=v;ref[i*4+c]=Math.trunc(Math.max(0,Math.min(255,Math.fround(Math.fround(input[c*n+i]*127.5)+128))));}ref[i*4+3]=255;}
  const b=device.createBuffer({size:input.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});buffers.push(b);device.queue.writeBuffer(b,0,input);const convert=await conversion(device,b,true);buffers.push(convert.output);
  const read=device.createBuffer({size:ref.byteLength,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});buffers.push(read);
  const encoder=device.createCommandEncoder();convert.encode(encoder);encoder.copyBufferToBuffer(convert.output,0,read,0,ref.byteLength);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const actual=new Uint8ClampedArray(read.getMappedRange().slice(0));read.unmap();
  const err=await device.popErrorScope();if(err)row.gpuErrors.push(err.message);
  let maxRgb=0,unequal=0;for(let i=0;i<ref.length;i++){const delta=Math.abs(actual[i]-ref[i]);maxRgb=Math.max(maxRgb,delta);if(delta)unequal++;}
  const check={name:'synthetic RGB bands (not a face)',maxRgb,unequal,passed:maxRgb===0&&row.gpuErrors.length===0};row.checks.push(check);row.completed=check.passed;
  if(!check.passed)row.error='Exact colour conversion/readback failed';
  postMessage({checkpoint:row,preview:{name:check.name,passed:check.passed,maxRgb},rgba:actual.buffer,referenceRgba:ref.buffer},[actual.buffer,ref.buffer]);
 }catch(e){row.error=String(e);}
 finally{buffers.forEach(b=>b.destroy());device?.destroy();postMessage({done:true,row});}
};
