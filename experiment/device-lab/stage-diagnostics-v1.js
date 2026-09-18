// Sample on GPU so diagnostics never allocate another 128 MiB readback buffer.
export async function sampleStage(device,buffer,ref){
 const count=ref.indices.length,owned=[];
 const make=(size,usage)=>{const b=device.createBuffer({size,usage});owned.push(b);return b;};
 try{
 const indices=make(count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),output=make(count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),staging=make(count*4,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
 device.queue.writeBuffer(indices,0,new Uint32Array(ref.indices));
 const module=device.createShaderModule({code:`@group(0) @binding(0) var<storage,read> input:array<f32>; @group(0) @binding(1) var<storage,read> indices:array<u32>; @group(0) @binding(2) var<storage,read_write> output:array<f32>; @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<${count}u){output[id.x]=input[indices[id.x]];}}`});
 const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}}),group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[buffer,indices,output].map((buffer,binding)=>({binding,resource:{buffer}}))});
 const e=device.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,group);p.dispatchWorkgroups(Math.ceil(count/64));p.end();e.copyBufferToBuffer(output,0,staging,0,count*4);device.queue.submit([e.finish()]);await staging.mapAsync(GPUMapMode.READ);const actual=new Float32Array(staging.getMappedRange());let maxAbs=0,nonFinite=0,worst=null,aboveTolerance=0;
 for(let i=0;i<count;i++){const value=actual[i],delta=Math.abs(value-ref.values[i]);if(!Number.isFinite(value)){nonFinite++;continue;}if(delta>.002)aboveTolerance++;if(delta>maxAbs){maxAbs=delta;worst={index:ref.indices[i],actual:value,expected:ref.values[i]};}}
 staging.unmap();return {name:ref.name,shape:ref.shape,sampleCount:count,maxAbs,nonFinite,aboveTolerance,worst,passed:nonFinite===0&&maxAbs<=.002,tolerance:.002};
 }finally{owned.forEach(b=>b.destroy());}
}
export function pixelErrors(raw,rgba){
 const histogram=[0,0,0,0,0],worst=[];let boundaryErrors=0,interiorErrors=0;
 for(let p=0;p<1048576;p++)for(let c=0;c<3;c++){const value=Math.trunc(Math.max(0,Math.min(255,Math.fround(Math.fround(raw[c*1048576+p]*127.5)+128)))),expected=rgba[p*4+c],delta=Math.abs(value-expected);histogram[delta===0?0:delta===1?1:delta<=8?2:delta<=32?3:4]++;if(delta>1){const x=p%1024,y=Math.floor(p/1024);if(x<4||y<4||x>=1020||y>=1020)boundaryErrors++;else interiorErrors++;if(worst.length<12||delta>worst[worst.length-1].delta){worst.push({x,y,channel:'RGB'[c],actual:value,expected,delta});worst.sort((a,b)=>b.delta-a.delta);worst.length=Math.min(12,worst.length);}}}
 return {bins:['0','1','2–8','9–32','33–255'],histogram,boundaryWidth:4,boundaryErrors,interiorErrors,worst};
}
