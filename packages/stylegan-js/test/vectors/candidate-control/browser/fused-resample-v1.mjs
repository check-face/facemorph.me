// Keep every possible tile read in bounds, including zero-padding positions.
export function boundaryCode(m,tail,variant='bounded',workgroup=256){
 if(!['bounded','unrolled'].includes(variant)||![64,256].includes(workgroup))throw Error('Invalid boundary candidate');
 const tap=(fy,fx)=>`{let qy=y+${fy};let qx=xx+${fx};let valid=qy>=1u&&qy<=1026u&&qx>=1u&&qx<=1026u;let iy=clamp(qy,1u,1026u)-1u;let ix=clamp(qx,1u,1026u)-1u;let offset=(((c%16u)*4u+(iy%2u)*2u+ix%2u)*513u+iy/2u)*513u+ix/2u;var sample:f32;if(c<16u){sample=x[offset];}else{sample=xb[offset];}let padded=select(0.0,sample,valid);v+=padded*fir[${fy}*4u+${fx}];}`;
 const sum=variant==='bounded'?`for(var fy=0u;fy<4u;fy++){for(var fx=0u;fx<4u;fx++)${tap('fy','fx')}}`:Array.from({length:16},(_,i)=>tap(`${Math.floor(i/4)}u`,`${i%4}u`)).join('\n');
 return ['x','d','noise','fir','bias','output','xb'].map((name,i)=>`@group(0) @binding(${i}) var<storage,${i===5?'read_write':'read'}> ${name}:array<f32>;`).join('\n')+`\n@compute @workgroup_size(${workgroup}) fn main(@builtin(global_invocation_id) id:vec3<u32>){let i=id.y*512u*${workgroup}u+id.x;if(i>=33554432u){return;}let c=i/1048576u;let p=i%1048576u;let y=p/1024u;let xx=p%1024u;var v:f32=0.0;${sum}`+(tail?`v=v*d[c];let ns=noise[p]*${m.strength};v=ns+v;v=v+bias[c];if(v<0.0){v=v*0.20000000298023224;}v=v*${m.gain};`:'')+'output[i]=v;}';
}
// Shader/pipeline are invariant; only bind groups follow recycled scratch buffers.
export async function createBoundaryPipeline(device,m,tail=false,workgroup=256,variant='bounded'){
 const module=device.createShaderModule({code:boundaryCode(m,tail,variant,workgroup)}),info=await module.getCompilationInfo();
 if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(x=>x.message).join('\n'));
 const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
 return {bind({phase,phaseB,demod,noise,filter,bias,output}){
  const used=tail?[[0,phase],[6,phaseB],[1,demod],[2,noise],[3,filter],[4,bias],[5,output]]:[[0,phase],[6,phaseB],[3,filter],[5,output]];
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:used.map(([binding,buffer])=>({binding,resource:{buffer}}))});
  return {encode(e){const p=e.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,group);p.dispatchWorkgroups(512,33554432/(512*workgroup));p.end();}};
 }};
}
