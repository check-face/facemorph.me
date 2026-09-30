// Instrumented diagnostics only: splitting dispatches changes performance.
// The normal latency/throughput loops must run with trace.active=false.
export function installGpuTrace(){
 const shaders=new WeakMap(),pipelines=new WeakMap(),programs=[],dispatches=[],copies=[];let active=false,device,query;
 let allocated=0,peak=0;const allocations=new WeakMap(),originals=[];
 function replace(proto,name,fn){const old=proto[name];originals.push(()=>proto[name]=old);proto[name]=fn(old);}
 replace(GPUDevice.prototype,'createShaderModule',old=>function(d){const m=old.call(this,d);const id=programs.length;programs.push({id,label:d.label||'',code:d.code});shaders.set(m,id);return m;});
 for(const method of ['createComputePipeline','createComputePipelineAsync'])replace(GPUDevice.prototype,method,old=>function(d){const meta={shader:shaders.get(d.compute.module),entry:d.compute.entryPoint,label:d.label||'',constants:d.compute.constants};const p=old.call(this,d);if(p?.then)return p.then(v=>{pipelines.set(v,meta);return v;});pipelines.set(p,meta);return p;});
 replace(GPUDevice.prototype,'createBuffer',old=>function(d){const b=old.call(this,d);allocations.set(b,d.size);allocated+=d.size;peak=Math.max(peak,allocated);return b;});
 replace(GPUBuffer.prototype,'destroy',old=>function(){const n=allocations.get(this);if(n){allocated-=n;allocations.delete(this);}return old.call(this);});
 replace(GPUCommandEncoder.prototype,'copyBufferToBuffer',old=>function(...a){if(active)copies.push({kind:'copyBufferToBuffer',bytes:a[4]});return old.apply(this,a);});
 replace(GPUQueue.prototype,'writeBuffer',old=>function(...a){if(active)copies.push({kind:'writeBuffer',bytes:a[4]??a[2].byteLength});return old.apply(this,a);});
 replace(GPUCommandEncoder.prototype,'beginComputePass',old=>function(desc){
  if(!active)return old.call(this,desc);
  const encoder=this,bindings=new Map();let pass=null,pipeline;
  function ensure(){if(pass)return;const i=dispatches.length;if(i>=2048)throw Error('Trace query capacity exceeded');pass=old.call(encoder,{...desc,timestampWrites:{querySet:query,beginningOfPassWriteIndex:2*i,endOfPassWriteIndex:2*i+1}});if(pipeline)pass.setPipeline(pipeline);for(const [n,args] of bindings)pass.setBindGroup(n,...args);}
  return {setPipeline(p){pipeline=p;if(pass)pass.setPipeline(p);},setBindGroup(n,...a){bindings.set(n,a);if(pass)pass.setBindGroup(n,...a);},dispatchWorkgroups(...a){ensure();pass.dispatchWorkgroups(...a);pass.end();pass=null;dispatches.push({index:dispatches.length,...pipelines.get(pipeline),groups:a});},dispatchWorkgroupsIndirect(...a){throw Error('Indirect dispatch profiling not implemented');},end(){if(pass){pass.end();pass=null;}},pushDebugGroup(){},popDebugGroup(){},insertDebugMarker(){}};
 });
 return {programs,dispatches,copies,get memory(){return {observedLiveBufferBytes:allocated,observedPeakBufferBytes:peak,note:'Sum of observed GPUBuffer sizes, not driver/physical peak; includes pooled allocations.'};},begin(d){device=d;query=d.createQuerySet({type:'timestamp',count:4096});active=true;},async end(){active=false;await device.queue.onSubmittedWorkDone();const count=dispatches.length*2,size=count*8;const r=device.createBuffer({size,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),s=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),e=device.createCommandEncoder();e.resolveQuerySet(query,0,count,r,0);e.copyBufferToBuffer(r,0,s,0,size);device.queue.submit([e.finish()]);await s.mapAsync(GPUMapMode.READ);const t=new BigUint64Array(s.getMappedRange());dispatches.forEach((v,i)=>v.ms=Number(t[i*2+1]-t[i*2])/1e6);s.unmap();s.destroy();r.destroy();query.destroy();return {programs,dispatches,copies,memory:this.memory};},restore(){active=false;for(const f of originals.reverse())f();}};
}
