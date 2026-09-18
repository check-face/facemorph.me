// Conservative research allocation guard. Does not measure driver/physical memory
// or promise protection from OS termination. Installed before ORT initialization.
export function installBufferBudget(limitBytes){
 const create=GPUDevice.prototype.createBuffer,destroy=GPUBuffer.prototype.destroy;
 const sizes=new WeakMap();let live=0,peak=0,rejected=null;
 GPUDevice.prototype.createBuffer=function(desc){
  const size=Number(desc.size);
  if(live+size>limitBytes){rejected={requestedBytes:size,liveBytes:live,limitBytes};throw Error(`GPU buffer budget exceeded (${live} + ${size} > ${limitBytes}); stop this route before allocating more memory`);}
  const buffer=create.call(this,desc);sizes.set(buffer,size);live+=size;peak=Math.max(peak,live);return buffer;
 };
 GPUBuffer.prototype.destroy=function(){const size=sizes.get(this);if(size!==undefined){live-=size;sizes.delete(this);}return destroy.call(this);};
 return {snapshot:()=>({liveBytes:live,peakBytes:peak,limitBytes,rejected,scope:'Observed GPUBuffer allocation sizes including ORT pools; excludes driver, pending destruction and CPU memory'}),restore(){GPUDevice.prototype.createBuffer=create;GPUBuffer.prototype.destroy=destroy;}};
}
