// Independent candidate. No WebGPU, no WebGL im2col, no precision fallback.
const VS = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
const HEADER = `#version 300 es
precision highp float; precision highp int; precision highp sampler2DArray;
precision highp sampler2D; out vec4 color;
`;
const CONV0 = HEADER + `
uniform sampler2DArray features; uniform sampler2D weights;
uniform float styles[64]; uniform int group;
void main(){
  ivec2 p=ivec2(gl_FragCoord.xy); vec4 value=vec4(0.0);
  for(int ic=0;ic<64;ic++) for(int ky=0;ky<3;ky++) for(int kx=0;kx<3;kx++){
    ivec2 q=p-ivec2(kx,ky);
    if(q.x<0||q.y<0||(q.x&1)!=0||(q.y&1)!=0)continue;
    q=q/2;if(q.x>=512||q.y>=512)continue;
    vec4 t=texelFetch(features,ivec3(q,ic/4),0);
    float x=t[ic%4]*styles[ic];
    vec4 w=texelFetch(weights,ivec2(ic*9+ky*3+kx,group),0);
    value+=x*w;
  }
  color=value;
}`;
const FIR0 = HEADER + `
uniform sampler2D phase; uniform sampler2D noise;
uniform float filterWeights[16];uniform vec4 demod;uniform vec4 bias;
uniform float strength;uniform float gain;uniform float alpha;
void main(){
  ivec2 p=ivec2(gl_FragCoord.xy);vec4 value=vec4(0.0);
  for(int ky=0;ky<4;ky++)for(int kx=0;kx<4;kx++){
    ivec2 q=p+ivec2(kx-1,ky-1);
    if(q.x>=0&&q.y>=0&&q.x<1025&&q.y<1025)
      value+=texelFetch(phase,q,0)*filterWeights[ky*4+kx];
  }
  value=value*demod;float n=texelFetch(noise,p,0).r*strength;
  value=value+vec4(n);value=value+bias;
  color=mix(value*alpha,value,greaterThanEqual(value,vec4(0.0)))*gain;
}`;
const CONV1 = HEADER + `
uniform sampler2DArray features;uniform sampler2D weights;uniform sampler2D noise;
uniform float styles[32];uniform int group;uniform vec4 demod;uniform vec4 bias;
uniform float strength;uniform float gain;uniform float alpha;
void main(){
  ivec2 p=ivec2(gl_FragCoord.xy);vec4 value=vec4(0.0);
  for(int ic=0;ic<32;ic++)for(int ky=0;ky<3;ky++)for(int kx=0;kx<3;kx++){
    ivec2 q=p+ivec2(kx-1,ky-1);
    if(q.x<0||q.y<0||q.x>=1024||q.y>=1024)continue;
    vec4 t=texelFetch(features,ivec3(q,ic/4),0);
    float x=t[ic%4]*styles[ic];
    value+=x*texelFetch(weights,ivec2(ic*9+ky*3+kx,group),0);
  }
  value=value*demod;float n=texelFetch(noise,p,0).r*strength;
  value=value+vec4(n);value=value+bias;
  color=mix(value*alpha,value,greaterThanEqual(value,vec4(0.0)))*gain;
}`;
const RGB_ACCUM = HEADER + `
uniform sampler2D features;uniform sampler2D previous;uniform sampler2D weights;
uniform float styles[32];uniform int group;
void main(){
  ivec2 p=ivec2(gl_FragCoord.xy);vec4 v=texelFetch(features,p,0);
  vec3 sum=texelFetch(previous,p,0).rgb;
  for(int i=0;i<4;i++){
    int c=group*4+i;float x=v[i]*styles[c];
    sum+=x*texelFetch(weights,ivec2(c,0),0).rgb;
  }
  color=vec4(sum,0.0);
}`;
const RGB_FINAL = HEADER + `
uniform sampler2D previous;uniform sampler2D skip;
uniform float filterWeights[16];uniform vec3 bias;
void main(){
  ivec2 p=ivec2(gl_FragCoord.xy);vec3 value=vec3(0.0);
  for(int ky=0;ky<4;ky++)for(int kx=0;kx<4;kx++){
    ivec2 q=p+ivec2(kx-2,ky-2);
    if(q.x<0||q.y<0||q.x>=1024||q.y>=1024||(q.x&1)!=0||(q.y&1)!=0)continue;
    value+=texelFetch(skip,q/2,0).rgb*filterWeights[ky*4+kx];
  }
  vec3 rgb=texelFetch(previous,p,0).rgb+bias;
  color=vec4(value+rgb,0.0);
}`;

export async function createHybridSession({assetBase, runtimeUrl, wasmPaths,
  checkpoint=async()=>{}, canvasFactory, drawTimeoutMs=60000, gpuBudgetBytes=256*1024*1024}={}) {
  const stats={candidate:'iphone-webgl-hybrid-v1',cpuProvider:'wasm',gpuProvider:'webgl2',
    outputShape:[1,3,1024,1024],drawCalls:0,glLiveBytes:0,glPeakBytes:0,
    memoryScope:'Tracked texture storage only; excludes WASM, JS, driver, pending deletion and browser process memory',
    stages:[],faces:0,webgpuUsed:false,cpuFallbackForSuffix:false};
  const canvas=canvasFactory?canvasFactory():typeof OffscreenCanvas!=='undefined'
    ?new OffscreenCanvas(1,1):globalThis.document?.createElement('canvas');
  if(!canvas)throw Error('OffscreenCanvas or an explicitly provided canvas required');
  const gl=canvas.getContext('webgl2',{alpha:false,depth:false,stencil:false,antialias:false,preserveDrawingBuffer:false});
  if(!gl)throw Error('WebGL2 context unavailable');
  const ext=gl.getExtension('EXT_color_buffer_float');
  const dbg=gl.getExtension('WEBGL_debug_renderer_info');
  stats.capabilities={floatRender:!!ext,maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxArrayTextureLayers:gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS),
    maxRenderbufferSize:gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    fragmentHighp:gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT)?.precision,
    renderer:dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
    offscreen:typeof OffscreenCanvas!=='undefined'&&canvas instanceof OffscreenCanvas};
  if(!ext||stats.capabilities.maxTextureSize<1025||stats.capabilities.maxArrayTextureLayers<16||
     stats.capabilities.maxRenderbufferSize<1025||!Number.isFinite(stats.capabilities.fragmentHighp)||stats.capabilities.fragmentHighp<23){
    try{gl.getExtension('WEBGL_lose_context')?.loseContext();}catch{}
    throw Error('Full FP32 WebGL2 suffix requirements unavailable');
  }
  let disposed=false,active=false,intentionalLoss=false,cpu;
  const textures=new Set(),programs=new Set(),buffers=[];
  const fbo=gl.createFramebuffer(),vao=gl.createVertexArray();gl.bindVertexArray(vao);
  gl.disable(gl.DITHER);gl.disable(gl.BLEND);
  canvas.addEventListener?.('webglcontextlost',e=>{e.preventDefault();if(!intentionalLoss)stats.contextLost=true;});
  function check(where){const code=gl.getError();if(code!==gl.NO_ERROR)throw Error(where+' GL error '+code);if(gl.isContextLost()||stats.contextLost)throw Error('WebGL context lost');}
  function texture(width,height,layers=1,channels=4,data=null,array=false){
    const bytes=width*height*layers*channels*4;
    if(stats.glLiveBytes+bytes>gpuBudgetBytes)throw Error('Tracked texture budget exceeded before allocation');
    const handle=gl.createTexture(),target=array?gl.TEXTURE_2D_ARRAY:gl.TEXTURE_2D;
    const t={handle,target,width,height,layers,channels,bytes};textures.add(t);
    gl.bindTexture(target,handle);gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(target,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(target,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(target,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const internal=channels===1?gl.R32F:gl.RGBA32F,format=channels===1?gl.RED:gl.RGBA;
    if(array)gl.texStorage3D(target,1,internal,width,height,layers);
    else {gl.texStorage2D(target,1,internal,width,height);if(data)gl.texSubImage2D(target,0,0,0,width,height,format,gl.FLOAT,data);}
    stats.glLiveBytes+=bytes;stats.glPeakBytes=Math.max(stats.glPeakBytes,stats.glLiveBytes);check('texture allocation');return t;
  }
  function release(t){if(!t||!textures.delete(t))return;try{gl.deleteTexture(t.handle);}finally{stats.glLiveBytes-=t.bytes;}}
  function packedNchw(data,channels,size,array=true){
    const layers=Math.ceil(channels/4),t=texture(size,size,layers,4,null,array);
    const plane=size*size,scratch=new Float32Array(plane*4);gl.bindTexture(t.target,t.handle);
    for(let layer=0;layer<layers;layer++){
      scratch.fill(0);for(let c=0;c<4&&layer*4+c<channels;c++)for(let i=0;i<plane;i++)scratch[i*4+c]=data[(layer*4+c)*plane+i];
      if(array)gl.texSubImage3D(t.target,0,0,0,layer,size,size,1,gl.RGBA,gl.FLOAT,scratch);
      else gl.texSubImage2D(t.target,0,0,0,size,size,gl.RGBA,gl.FLOAT,scratch);
    }
    check('NCHW upload');return t;
  }
  function program(source){
    function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const log=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error('Shader compile: '+log);}return s;}
    let vs,fs,p;try{
      vs=shader(gl.VERTEX_SHADER,VS);fs=shader(gl.FRAGMENT_SHADER,source);p=gl.createProgram();
      gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('Shader link: '+gl.getProgramInfoLog(p));
      programs.add(p);return p;
    }catch(error){if(p)try{gl.deleteProgram(p);}catch{}throw error;}
    finally{if(vs)try{gl.deleteShader(vs);}catch{}if(fs)try{gl.deleteShader(fs);}catch{}}
  }
  async function completed(){
    const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();const started=performance.now();
    try{while(true){const result=gl.clientWaitSync(fence,0,0);
      if(result===gl.ALREADY_SIGNALED||result===gl.CONDITION_SATISFIED)return;
      if(result===gl.WAIT_FAILED)throw Error('WebGL fence wait failed');
      if(disposed||gl.isContextLost())throw Error('WebGL cancelled or context lost');
      if(performance.now()-started>drawTimeoutMs)throw Error('WebGL draw completion timeout');
      await new Promise(r=>setTimeout(r,5));
    }}finally{gl.deleteSync(fence);}
  }
  function target(t,layer=0){
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
    if(t.target===gl.TEXTURE_2D_ARRAY)gl.framebufferTextureLayer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,t.handle,0,layer);
    else gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.handle,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('FP32 framebuffer incomplete');
    gl.viewport(0,0,t.width,t.height);
  }
  async function draw(p,out,{samplers={},floats={},vectors={},ints={}}={},layer=0){
    target(out,layer);gl.useProgram(p);let unit=0;
    for(const [name,t] of Object.entries(samplers)){if(t===out)throw Error('Texture feedback loop');gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(t.target,t.handle);gl.uniform1i(gl.getUniformLocation(p,name),unit++);}
    for(const [name,value] of Object.entries(floats)){const l=gl.getUniformLocation(p,name);if(typeof value==='number')gl.uniform1f(l,value);else gl.uniform1fv(l,value);}
    for(const [name,value] of Object.entries(vectors)){const l=gl.getUniformLocation(p,name);if(value.length===3)gl.uniform3fv(l,value);else gl.uniform4fv(l,value);}
    for(const [name,value] of Object.entries(ints))gl.uniform1i(gl.getUniformLocation(p,name),value);
    gl.drawArrays(gl.TRIANGLES,0,3);stats.drawCalls++;check('draw submission');await completed();check('draw completion');
  }
  async function stage(name,fn){await checkpoint(name,'start',stats);const t=performance.now();const result=await fn();
    const row={name,ms:performance.now()-t,glLiveBytes:stats.glLiveBytes,glPeakBytes:stats.glPeakBytes,drawCalls:stats.drawCalls};
    stats.stages.push(row);if(stats.stages.length>96)stats.stages.shift();await checkpoint(name,'complete',stats);return result;}
  async function fetched(path,hash){const response=await fetch(path);if(!response.ok)throw Error(path+' HTTP '+response.status);
    const data=await response.arrayBuffer();if(hash){const digest=await crypto.subtle.digest('SHA-256',data);const hex=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');if(hex!==hash)throw Error('Asset checksum mismatch: '+path);}return data;}
  const cleanupErrors=[];
  async function cleanupAll(){
    disposed=true;
    const attempt=async(name,fn)=>{try{await fn();}catch(error){cleanupErrors.push({name,error:String(error)});}};
    if(cpu){const session=cpu;cpu=null;await attempt('CPU session release',()=>session.release());}
    for(const t of [...textures])await attempt('texture release',()=>release(t));
    for(const p of [...programs]){programs.delete(p);await attempt('program release',()=>gl.deleteProgram(p));}
    for(const b of buffers.splice(0))await attempt('buffer release',()=>gl.deleteBuffer(b));
    await attempt('framebuffer release',()=>gl.deleteFramebuffer(fbo));
    await attempt('vertex array release',()=>gl.deleteVertexArray(vao));
    await attempt('context release',()=>{intentionalLoss=true;gl.getExtension('WEBGL_lose_context')?.loseContext();});
    stats.disposed=true;if(cleanupErrors.length)stats.cleanupErrors=cleanupErrors.slice();
  }
  try{
  const manifest=await stage('manifest',async()=>JSON.parse(new TextDecoder().decode(await fetched(assetBase+'manifest.json'))));
  stats.sourceSha256=manifest.sourceSha256;stats.prefixSha256=manifest.prefix.sha256;stats.coefficientsSha256=manifest.coefficients.sha256;
  const coefficients=await stage('coefficients',()=>fetched(assetBase+manifest.coefficients.file,manifest.coefficients.sha256));
  const arrays=Object.fromEntries(Object.entries(manifest.coefficients.arrays).map(([key,r])=>[key,new Float32Array(coefficients,r.offset,r.bytes/4)]));
  const ps=await stage('GLSL compilation',async()=>({conv0:program(CONV0),fir0:program(FIR0),conv1:program(CONV1),accum:program(RGB_ACCUM),final:program(RGB_FINAL)}));
  const weights={conv0:texture(576,8,1,4,arrays.weight0),conv1:texture(288,8,1,4,arrays.weight1),rgb:texture(32,1,1,4,arrays.weightRgb)};
  const ort=await stage('CPU runtime import',()=>import(runtimeUrl));ort.env.wasm.numThreads=1;
  if(wasmPaths)ort.env.wasm.wasmPaths=wasmPaths;
  await stage('CPU prefix session',async()=>{
    const bytes=await fetched(assetBase+manifest.prefix.file,manifest.prefix.sha256);
    cpu=await ort.InferenceSession.create(new Uint8Array(bytes),{executionProviders:['wasm'],graphOptimizationLevel:'disabled',
      enableCpuMemArena:false,enableMemPattern:false,extra:{session:{disable_prepacking:'1'}}});
    return cpu;
  });
  stats.cpuInputs=manifest.prefix.inputs;
  let inferenceCount=0;
  return {
    stats,manifest,
    async infer(w,noise){
      if(disposed)throw Error('Hybrid session disposed');if(active)throw Error('Only one active hybrid face is allowed');active=true;
      const transient=new Set(),feeds={};let outputs=null,primaryError;
      const own=t=>(transient.add(t),t);const drop=t=>{transient.delete(t);release(t);};
      try{
        if(!(w instanceof Float32Array)||w.length!==9216)throw Error('W+ must be 18 × 512 FP32 values');
        for(const [name,dims] of Object.entries(manifest.prefix.inputs)){
          const a=name==='w'?w:noise[name];if(!(a instanceof Float32Array)||a.length!==dims.reduce((x,y)=>x*y,1))throw Error('Invalid synthetic input '+name);
          feeds[name]=new ort.Tensor('float32',a,dims);
        }
        await stage('CPU prefix inference',async()=>{outputs=await cpu.run(feeds);return outputs;});
        const get=name=>outputs[manifest.prefix.outputs[name].name].data;
        const styles={style0:get('style0').slice(),style1:get('style1').slice(),styleRgb:get('styleRgb').slice(),demod0:get('demod0').slice(),demod1:get('demod1').slice()};
        let features=await stage('512 feature upload',async()=>own(packedNchw(get('features'),64,512)));
        const skip=own(packedNchw(get('skip'),3,512,false));
        for(const tensor of Object.values(outputs))tensor.dispose?.();outputs=null;
        const n0=noise.noise_15,n1=noise.noise_16;
        if(!(n0 instanceof Float32Array)||n0.length!==1048576||!(n1 instanceof Float32Array)||n1.length!==1048576)throw Error('1024 noise inputs required');
        const noise0=own(texture(1024,1024,1,1,n0)),activation=own(texture(1024,1024,8,4,null,true));
        const phase=own(texture(1025,1025));
        const k=manifest.constants;
        for(let group=0;group<8;group++){
          await stage('1024 transposed convolution group '+group,()=>draw(ps.conv0,phase,{samplers:{features,weights:weights.conv0},floats:{styles:styles.style0},ints:{group}}));
          await stage('1024 FIR and activation group '+group,()=>draw(ps.fir0,activation,{samplers:{phase,noise:noise0},floats:{filterWeights:arrays.filter0,strength:k.noiseStrength0,gain:k.gain,alpha:k.leakyAlpha},vectors:{demod:styles.demod0.subarray(group*4,group*4+4),bias:arrays.bias0.subarray(group*4,group*4+4)}},group));
        }
        drop(phase);drop(features);features=null;drop(noise0);
        const noise1=own(texture(1024,1024,1,1,n1)),channelTile=own(texture(1024,1024));
        let rgbA=own(texture(1024,1024)),rgbB=own(texture(1024,1024));
        target(rgbA);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);await completed();
        for(let group=0;group<8;group++){
          await stage('1024 convolution group '+group,()=>draw(ps.conv1,channelTile,{samplers:{features:activation,weights:weights.conv1,noise:noise1},floats:{styles:styles.style1,strength:k.noiseStrength1,gain:k.gain,alpha:k.leakyAlpha},vectors:{demod:styles.demod1.subarray(group*4,group*4+4),bias:arrays.bias1.subarray(group*4,group*4+4)},ints:{group}}));
          await draw(ps.accum,rgbB,{samplers:{features:channelTile,previous:rgbA,weights:weights.rgb},floats:{styles:styles.styleRgb},ints:{group}});
          [rgbA,rgbB]=[rgbB,rgbA];
        }
        drop(activation);drop(noise1);drop(channelTile);
        await stage('1024 final RGB and skip',()=>draw(ps.final,rgbB,{samplers:{previous:rgbA,skip},floats:{filterWeights:arrays.filterRgb},vectors:{bias:arrays.biasRgb}}));
        drop(rgbA);drop(skip);
        const result=await stage('1024 full float readback',async()=>{
          target(rgbB);const rgba=new Float32Array(1048576*4);gl.readPixels(0,0,1024,1024,gl.RGBA,gl.FLOAT,rgba);check('float readback');
          const raw=new Float32Array(1048576*3);for(let p=0;p<1048576;p++)for(let c=0;c<3;c++)raw[c*1048576+p]=rgba[p*4+c];return raw;
        });
        stats.faces=++inferenceCount;return result;
      }catch(error){primaryError=error;throw error;}finally{
        const errors=[];const attempt=(name,fn)=>{try{fn();}catch(error){errors.push({name,error:String(error)});}};
        if(outputs)for(const t of Object.values(outputs))attempt('output tensor disposal',()=>t.dispose?.());
        for(const t of Object.values(feeds))attempt('input tensor disposal',()=>t.dispose?.());
        for(const t of transient)attempt('transient texture release',()=>release(t));
        active=false;
        if(errors.length){stats.cleanupErrors=[...(stats.cleanupErrors||[]),...errors];
          if(primaryError){try{primaryError.cleanupErrors=errors;}catch{}}
          else throw Error('Hybrid inference cleanup failed: '+errors.map(x=>x.name+': '+x.error).join('; '));
        }
      }
    },
    async dispose(){if(disposed)return;if(active)throw Error('Cannot dispose during active inference; terminate the owning worker to cancel');await cleanupAll();if(cleanupErrors.length)throw Error('Hybrid cleanup failed: '+cleanupErrors.map(x=>x.name+': '+x.error).join('; '));},
  };
  }catch(error){await cleanupAll();if(cleanupErrors.length){const combined=new Error(String(error)+'; cleanup: '+cleanupErrors.map(x=>x.name+': '+x.error).join('; '),{cause:error});combined.cleanupErrors=cleanupErrors;throw combined;}throw error;}
}
