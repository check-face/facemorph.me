// Generated from pinned scalar block-stream candidate; see generate.py.
// Isolated FP32 WebGL2 block stream. Pure variant imports no ONNX/WASM runtime.
const VS=`#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
const H=`#version 300 es
precision highp float;precision highp int;precision highp sampler2D;precision highp sampler2DArray;
out vec4 color;
`;
const styleAt=`float styleAt(int c){return texelFetch(styles,ivec2(c/4,0),0)[c%4];}`;
const conv0Source=cin=>H+`
uniform sampler2DArray features;uniform sampler2D weights;uniform sampler2D styles;
uniform int group;uniform int inputSize;
void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec4 value=vec4(0.0);
for(int cg=0;cg<${cin}/4;cg++){
  vec4 style=texelFetch(styles,ivec2(cg,0),0);vec4 inputs[9];bool valid[9];
  for(int k=0;k<9;k++){
    ivec2 q=p-ivec2(k%3,k/3);bool inside=q.x>=0&&q.y>=0&&(q.x&1)==0&&(q.y&1)==0;
    q=q/2;inside=inside&&q.x<inputSize&&q.y<inputSize;valid[k]=inside;
    inputs[k]=inside?texelFetch(features,ivec3(q,cg),0)*style:vec4(0.0);
  }
  // Preserve scalar source order: input channel, kernel Y, then kernel X.
  for(int component=0;component<4;component++)for(int k=0;k<9;k++)if(valid[k]){
    int ic=cg*4+component;value+=inputs[k][component]*texelFetch(weights,ivec2(ic*9+k,group),0);
  }
}color=value;}`;
const FIR=H+`
uniform sampler2D phase;uniform sampler2D noise;uniform sampler2D demods;
uniform float filterWeights[16];uniform vec4 bias;uniform float strength;uniform float gain;uniform float alpha;
uniform int group;uniform int outputSize;
void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec4 value=vec4(0.0);
for(int ky=0;ky<4;ky++)for(int kx=0;kx<4;kx++){ivec2 q=p+ivec2(kx-1,ky-1);
if(q.x>=0&&q.y>=0&&q.x<outputSize+1&&q.y<outputSize+1)value+=texelFetch(phase,q,0)*filterWeights[ky*4+kx];}
value=value*texelFetch(demods,ivec2(group,0),0);float n=texelFetch(noise,p,0).r*strength;
value=value+vec4(n);value=value+bias;color=mix(value*alpha,value,greaterThanEqual(value,vec4(0.0)))*gain;}`;
const conv1Source=cin=>H+`
uniform sampler2DArray features;uniform sampler2D weights;uniform sampler2D styles;uniform sampler2D noise;uniform sampler2D demods;
uniform int group;uniform int outputSize;uniform vec4 bias;uniform float strength;uniform float gain;uniform float alpha;
void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec4 value=vec4(0.0);
for(int cg=0;cg<${cin}/4;cg++){
  vec4 style=texelFetch(styles,ivec2(cg,0),0);vec4 inputs[9];bool valid[9];
  for(int k=0;k<9;k++){
    ivec2 q=p+ivec2(k%3-1,k/3-1);bool inside=q.x>=0&&q.y>=0&&q.x<outputSize&&q.y<outputSize;
    valid[k]=inside;inputs[k]=inside?texelFetch(features,ivec3(q,cg),0)*style:vec4(0.0);
  }
  // Cached RGBA reads reduce fetches without changing the reduction order.
  for(int component=0;component<4;component++)for(int k=0;k<9;k++)if(valid[k]){
    int ic=cg*4+component;value+=inputs[k][component]*texelFetch(weights,ivec2(ic*9+k,group),0);
  }
}
value=value*texelFetch(demods,ivec2(group,0),0);float n=texelFetch(noise,p,0).r*strength;
value=value+vec4(n);value=value+bias;color=mix(value*alpha,value,greaterThanEqual(value,vec4(0.0)))*gain;}`;
const accumSource=array=>H+`
uniform ${array?'sampler2DArray':'sampler2D'} features;uniform sampler2D previous;uniform sampler2D weights;uniform sampler2D styles;
uniform int group;${styleAt}
void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec4 v=texelFetch(features,${array?'ivec3(p,group)':'p'},0);
vec3 sum=texelFetch(previous,p,0).rgb;for(int i=0;i<4;i++){int c=group*4+i;float x=v[i]*styleAt(c);
sum+=x*texelFetch(weights,ivec2(c,0),0).rgb;}color=vec4(sum,0.0);}`;
const FINAL=H+`
uniform sampler2D previous;uniform sampler2D skip;uniform float filterWeights[16];uniform vec3 bias;
uniform int outputSize;uniform int hasSkip;
void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec3 value=vec3(0.0);
if(hasSkip==1)for(int ky=0;ky<4;ky++)for(int kx=0;kx<4;kx++){
ivec2 q=p+ivec2(kx-2,ky-2);if(q.x<0||q.y<0||q.x>=outputSize||q.y>=outputSize||(q.x&1)!=0||(q.y&1)!=0)continue;
value+=texelFetch(skip,q/2,0).rgb*filterWeights[ky*4+kx];}
vec3 rgb=texelFetch(previous,p,0).rgb+bias;color=vec4(value+rgb,0.0);}`;
const AFFINE=H+`
uniform sampler2D latent;uniform sampler2D weights;uniform sampler2D bias;uniform int wIndex;uniform float multiplier;
void main(){int g=int(gl_FragCoord.x);vec4 value=vec4(0.0);
for(int j=0;j<512;j++){float w=texelFetch(latent,ivec2(j/4,wIndex),0)[j%4];value+=w*texelFetch(weights,ivec2(j,g),0);}
color=(value+texelFetch(bias,ivec2(g,0),0))*multiplier;}`;
const demodSource=cin=>H+`
uniform sampler2D styles;uniform sampler2D energy;uniform float epsilon;uniform float numerator;
void main(){int g=int(gl_FragCoord.x);vec4 value=vec4(0.0);
for(int i=0;i<${cin};i++){float s=texelFetch(styles,ivec2(i/4,0),0)[i%4];float square=s*s;
value+=square*texelFetch(energy,ivec2(i,g),0);}
color=vec4(numerator)/sqrt(value+vec4(epsilon));}`;

export async function createHybridSession({assetBase,runtimeUrl,wasmPaths,variant='pure',vectorizedInputs=true,
checkpoint=async()=>{},canvasFactory,drawTimeoutMs=60000,gpuBudgetBytes=256*1024*1024,drawBatchSize=16,
managedBudgetBytes=384*1024*1024,browserHeadroomBytes=64*1024*1024}={}){
  variant=String(variant);if(vectorizedInputs!==true)throw Error('Vector module requires vectorizedInputs=true');
  if(!['pure','4','256','512'].includes(variant))throw Error('Unknown WebGL block-stream variant');
  if(!Number.isInteger(drawBatchSize)||drawBatchSize<1||drawBatchSize>32)throw Error('Invalid bounded draw batch');
  if(!Number.isSafeInteger(managedBudgetBytes)||managedBudgetBytes<=0||!Number.isSafeInteger(browserHeadroomBytes)||browserHeadroomBytes<0)throw Error('Invalid managed memory budget');
  const pure=variant==='pure';
  const stats={candidate:'iphone-webgl-vector-v1',vectorizedInputs:true,inputVectorization:'RGBA cached taps; scalar channel/kernel accumulation order',variant,cpuProvider:pure?null:'wasm-affine-or-prefix',gpuProvider:'webgl2',
    outputShape:[1,3,1024,1024],drawCalls:0,drawBatchSize,glLiveBytes:0,glPeakBytes:0,glPendingDeleteBytes:0,glPeakWithPendingBytes:0,
    jsTrackedLiveBytes:0,jsTrackedPeakBytes:0,externalInputBytes:0,ortRuntimeImported:false,ortSessionCount:0,wasmExpected:!pure,
    receivedAssetBytes:0,assetByteScope:'Decoded asset bodies read by this worker; may be HTTP-cache hits, not measured wire bytes',coefficientFetches:0,faces:0,stages:[],faceTimings:[],setupTimings:{},currentFaceTimings:null,webgpuUsed:false,cpuFallbackForSuffix:false,
    managedBudgetEnforced:pure,managedBudgetBytes,browserHeadroomBytes,managedPeakAccountedBytes:0,
    memoryScope:'Logical owned GL storage plus pending deletions; enumerated JS model/coefficient/packing/style/output/readback buffers and external inputs. Pure adds explicit browser reserve; excludes unobservable excess driver/browser/GC retention. Fences do not prove physical RAM reclamation.',
    cpuMemoryQualification:pure?'No ORT runtime or WASM memory instantiated by this module':'CPU runtime heap capacity requires external observation/admission; no whole-working-set bound claimed'};

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
    const apiStart=performance.now();
    const bytes=width*height*layers*channels*4;
    if(stats.glLiveBytes+stats.glPendingDeleteBytes+bytes>gpuBudgetBytes)throw Error('Tracked texture budget exceeded before allocation');
    checkManaged(bytes,0,'GPU texture');
    const handle=gl.createTexture(),target=array?gl.TEXTURE_2D_ARRAY:gl.TEXTURE_2D;
    const t={handle,target,width,height,layers,channels,bytes};textures.add(t);
    gl.bindTexture(target,handle);gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(target,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(target,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(target,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const internal=channels===1?gl.R32F:gl.RGBA32F,format=channels===1?gl.RED:gl.RGBA;
    if(array)gl.texStorage3D(target,1,internal,width,height,layers);
    else {gl.texStorage2D(target,1,internal,width,height);if(data)gl.texSubImage2D(target,0,0,0,width,height,format,gl.FLOAT,data);}
    stats.glLiveBytes+=bytes;stats.glPeakBytes=Math.max(stats.glPeakBytes,stats.glLiveBytes);stats.glPeakWithPendingBytes=Math.max(stats.glPeakWithPendingBytes,stats.glLiveBytes+stats.glPendingDeleteBytes);check('texture allocation');addTiming('textureApiMs',performance.now()-apiStart);return t;
  }
  function release(t){if(!t||!textures.delete(t))return;try{gl.deleteTexture(t.handle);}finally{stats.glLiveBytes-=t.bytes;stats.glPendingDeleteBytes+=t.bytes;}}
  function packedNchw(data,channels,size,array=true){
    const layers=Math.ceil(channels/4),t=texture(size,size,layers,4,null,array);
    const plane=size*size,scratchBytes=plane*16;jsAcquire(scratchBytes);try{const scratch=new Float32Array(plane*4);gl.bindTexture(t.target,t.handle);
    for(let layer=0;layer<layers;layer++){
      scratch.fill(0);for(let c=0;c<4&&layer*4+c<channels;c++)for(let i=0;i<plane;i++)scratch[i*4+c]=data[(layer*4+c)*plane+i];
      if(array)gl.texSubImage3D(t.target,0,0,0,layer,size,size,1,gl.RGBA,gl.FLOAT,scratch);
      else gl.texSubImage2D(t.target,0,0,0,size,size,gl.RGBA,gl.FLOAT,scratch);
    }
    check('NCHW upload');return t;}finally{jsRelease(scratchBytes);}
  }
  function program(source){
    const compileStart=performance.now();
    function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const log=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error('Shader compile: '+log);}return s;}
    let vs,fs,p;try{
      vs=shader(gl.VERTEX_SHADER,VS);fs=shader(gl.FRAGMENT_SHADER,source);p=gl.createProgram();
      gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('Shader link: '+gl.getProgramInfoLog(p));
      programs.add(p);return p;
    }catch(error){if(p)try{gl.deleteProgram(p);}catch{}throw error;}
    finally{if(vs)try{gl.deleteShader(vs);}catch{}if(fs)try{gl.deleteShader(fs);}catch{}addTiming('shaderCompileLinkMs',performance.now()-compileStart);}
  }
  async function completed(){
    const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();const started=performance.now();
    try{while(true){const result=gl.clientWaitSync(fence,0,0);
      if(result===gl.ALREADY_SIGNALED||result===gl.CONDITION_SATISFIED)return;
      if(result===gl.WAIT_FAILED)throw Error('WebGL fence wait failed');
      if(disposed||gl.isContextLost())throw Error('WebGL cancelled or context lost');
      if(performance.now()-started>drawTimeoutMs)throw Error('WebGL draw completion timeout');
      await new Promise(r=>setTimeout(r,1));
    }}finally{gl.deleteSync(fence);}
  }
  function target(t,layer=0){
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
    if(t.target===gl.TEXTURE_2D_ARRAY)gl.framebufferTextureLayer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,t.handle,0,layer);
    else gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.handle,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('FP32 framebuffer incomplete');
    gl.viewport(0,0,t.width,t.height);
  }
  function draw(p,out,{samplers={},floats={},vectors={},ints={}}={},layer=0){
    target(out,layer);gl.useProgram(p);let unit=0;
    for(const [name,t] of Object.entries(samplers)){if(t===out)throw Error('Texture feedback loop');gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(t.target,t.handle);gl.uniform1i(gl.getUniformLocation(p,name),unit++);}
    for(const [name,value] of Object.entries(floats)){const l=gl.getUniformLocation(p,name);if(typeof value==='number')gl.uniform1f(l,value);else gl.uniform1fv(l,value);}
    for(const [name,value] of Object.entries(vectors)){const l=gl.getUniformLocation(p,name);if(value.length===3)gl.uniform3fv(l,value);else gl.uniform4fv(l,value);}
    for(const [name,value] of Object.entries(ints))gl.uniform1i(gl.getUniformLocation(p,name),value);
    gl.drawArrays(gl.TRIANGLES,0,3);stats.drawCalls++;check('draw submission');
  }
  async function stage(name,fn){await checkpoint(name,'start',stats);const t=performance.now();const result=await fn();
    const row={name,ms:performance.now()-t,glLiveBytes:stats.glLiveBytes,glPeakBytes:stats.glPeakBytes,drawCalls:stats.drawCalls};
    const category=name.includes('coefficient upload')?'coefficientStageMs':name.endsWith(' styles')?'styleStageMs':name.includes('transposed convolution')?'conv0StageMs':name.includes('convolution and')?'conv1StageMs':name.includes('skip merge')?'rgbStageMs':name.includes('readback')?'readbackStageMs':null;if(category)addTiming(category,row.ms);
    stats.stages.push(row);if(stats.stages.length>80)stats.stages.shift();await checkpoint(name,'complete',stats);return result;}
  async function fetched(path,hash,expectedBytes){const started=performance.now();const response=await fetch(path,{signal:AbortSignal.timeout(60000)});addTiming('fetchHeadersMs',performance.now()-started);if(!response.ok)throw Error(path+' HTTP '+response.status);
    const length=response.headers.get('content-length');if(expectedBytes!==undefined&&length!==null&&Number(length)>expectedBytes){try{Promise.resolve(response.body?.cancel()).catch(()=>{});}catch{}throw Error('Asset Content-Length exceeds reserved bytes: '+path);}
    const bodyStart=performance.now();let data;
    if(expectedBytes!==undefined&&response.body?.getReader){const target=new Uint8Array(expectedBytes),reader=response.body.getReader();let offset=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;const bytes=value.byteLength;jsAcquire(bytes);try{if(offset+bytes>expectedBytes)throw Error('Asset stream exceeds reserved bytes: '+path);target.set(value,offset);offset+=bytes;stats.maxReceivedChunkBytes=Math.max(stats.maxReceivedChunkBytes||0,bytes);}finally{jsRelease(bytes);}}
        if(offset!==expectedBytes)throw Error('Asset stream truncated: '+path);data=target.buffer;
      }catch(error){try{Promise.resolve(reader.cancel(error)).catch(()=>{});}catch{}throw error;}
      // This one-shot reader leaves scope here. Explicit releaseLock triggered a
      // recorded Simulator WebKit GC/reader deadlock in the earlier .25 probe.
    }else{if(expectedBytes!==undefined)throw Error('Bounded streaming asset reader unavailable');data=await response.arrayBuffer();}
    addTiming('assetBodyReadMs',performance.now()-bodyStart);addTiming('assetBodyBytes',data.byteLength);
    if(hash){const hashStart=performance.now();const digest=await crypto.subtle.digest('SHA-256',data);addTiming('sha256Ms',performance.now()-hashStart);const hex=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');if(hex!==hash)throw Error('Asset checksum mismatch: '+path);}return data;}
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
    stats.disposed=true;stats.glPendingDeleteBytes=0;if(cleanupErrors.length)stats.cleanupErrors=cleanupErrors.slice();
  }

  let ort,manifest,selected,latentTexture;
  const progCache=new Map();
  function addTiming(name,value){const row=stats.currentFaceTimings||stats.setupTimings;row[name]=(row[name]||0)+value;}
  function cachedProgram(key,source){let p=progCache.get(key);if(!p){p=program(source);progCache.set(key,p);stats.programCount=progCache.size;}return p;}
  function checkManaged(extraGpu=0,extraJs=0,label='allocation'){
    const amount=stats.glLiveBytes+stats.glPendingDeleteBytes+stats.jsTrackedLiveBytes+stats.externalInputBytes+extraGpu+extraJs+browserHeadroomBytes;
    if(pure&&amount>managedBudgetBytes){stats.deniedAllocation={label,extraGpu,extraJs,accountedBytes:amount,budgetBytes:managedBudgetBytes};throw Error('Managed memory budget exceeded before '+label);}
    stats.managedPeakAccountedBytes=Math.max(stats.managedPeakAccountedBytes,amount);
  }
  function jsAcquire(n){checkManaged(0,n,'enumerated JS buffer');stats.jsTrackedLiveBytes+=n;stats.jsTrackedPeakBytes=Math.max(stats.jsTrackedPeakBytes,stats.jsTrackedLiveBytes);}
  function jsRelease(n){stats.jsTrackedLiveBytes-=n;}
  async function ownedFetch(path,hash,expectedBytes){if(!Number.isSafeInteger(expectedBytes)||expectedBytes<0)throw Error('Missing checked asset byte length');jsAcquire(expectedBytes);try{const data=await fetched(path,hash,expectedBytes);if(data.byteLength!==expectedBytes)throw Error('Asset length mismatch: '+path);stats.receivedAssetBytes+=data.byteLength;return data;}catch(error){jsRelease(expectedBytes);throw error;}}
  async function retire(){await completed();check('block completion');stats.glPendingDeleteBytes=0;}
  const progressBatch=async(group,count,label)=>{if((group+1)%Math.max(1,drawBatchSize/2)===0||group+1===count){await retire();await checkpoint(label+' groups '+(group+1)+'/'+count,'complete',stats);}};
  const vectorTexture=a=>texture(Math.ceil(a.length/4),1,1,4,a);
  async function blockCoefficients(block){
    let binary,smallBytes=0;const owned=[];try{
      binary=await ownedFetch(assetBase+block.coefficients.file,block.coefficients.sha256,block.coefficients.bytes);stats.coefficientFetches++;
      const arrays=Object.fromEntries(Object.entries(block.coefficients.arrays).map(([key,r])=>[key,new Float32Array(binary,r.offset,r.bytes/4)]));
      const weights={},small={};
      function upload(key){const r=block.coefficients.arrays[key];if(!r)return null;
        let width,height;if(r.shape.length===3){[height,width]=r.shape;}else {width=Math.ceil(arrays[key].length/4);height=1;}
        const t=texture(width,height,1,4,arrays[key]);owned.push(t);return t;
      }
      for(const key of ['weight0','weight1','weightRgb'])if(arrays[key])weights[key]=upload(key);
      if(pure)for(const key of ['affineWeight0','affineWeight1','affineWeightRgb','affineBias0','affineBias1','affineBiasRgb','energy0','energy1'])if(arrays[key])weights[key]=upload(key);
      for(const key of ['filter0','filterRgb','bias0','bias1','biasRgb'])if(arrays[key]){jsAcquire(arrays[key].byteLength);smallBytes+=arrays[key].byteLength;small[key]=arrays[key].slice();}
      return {weights,small,owned,smallBytes};
    }catch(error){const errors=[];for(const t of owned)try{release(t);}catch(e){errors.push(String(e));}try{await retire();}catch(e){errors.push(String(e));}if(smallBytes)jsRelease(smallBytes);if(errors.length)stats.cleanupErrors=[...(stats.cleanupErrors||[]),{name:'coefficient upload cleanup',errors}];throw error;
    }finally{if(binary)jsRelease(binary.byteLength);}
  }
  async function makeStyles(block,weights,cpuStyle,owned){
    const result={};
    if(!pure){for(const name of Object.keys(block.styles)){const t=vectorTexture(cpuStyle[block.id+'.'+name]);owned.push(t);result[name]=t;}return result;}
    for(const [layer,suffix] of [['conv0','0'],['conv1','1'],['torgb','Rgb']]){
      const plan=block.stylePlans[layer];if(!plan)continue;
      const key='style'+suffix,shape=block.styles[key].shape,cin=shape.reduce((a,b)=>a*b,1);
      const out=texture(cin/4,1);owned.push(out);result[key]=out;
      draw(cachedProgram('affine',AFFINE),out,{samplers:{latent:latentTexture,weights:weights['affineWeight'+suffix],bias:weights['affineBias'+suffix]},floats:{multiplier:plan.styleMultiplier},ints:{wIndex:plan.wIndex}});
      if(suffix!=='Rgb'){
        const count=block.styles['demod'+suffix].shape.reduce((a,b)=>a*b,1),demod=texture(count/4,1);owned.push(demod);result['demod'+suffix]=demod;
        draw(cachedProgram('demod-'+cin,demodSource(cin)),demod,{samplers:{styles:out,energy:weights['energy'+suffix]},floats:{epsilon:plan.demodulation.epsilon,numerator:plan.demodulation.numerator}});
      }
    }
    await retire();return result;
  }
  try{
    manifest=await stage('manifest',async()=>JSON.parse(new TextDecoder().decode(await fetched(assetBase+'manifest.json'))));
    selected=manifest.variants[variant];if(!selected)throw Error('Variant missing from manifest');
    if(stats.capabilities.maxTextureSize<selected.requiredMaxTextureSize||stats.capabilities.maxArrayTextureLayers<selected.requiredMaxArrayTextureLayers)throw Error('Block-stream tensor dimensions exceed WebGL limits');
    stats.sourceSha256=manifest.sourceSha256;stats.prefixSha256=selected.prefix?.sha256??null;
    const aggregate=new TextEncoder().encode(selected.gpuBlocks.map(id=>manifest.blocks.find(b=>b.id===id).coefficients.sha256).join('\n'));
    stats.coefficientsSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',aggregate)),v=>v.toString(16).padStart(2,'0')).join('');
    stats.firstGpuBlock=selected.firstGpuBlock;stats.gpuBlocks=selected.gpuBlocks;
    if(!pure){
      ort=await stage('CPU runtime import',()=>import(runtimeUrl));stats.ortRuntimeImported=true;stats.runtimeUrl=runtimeUrl;ort.env.wasm.numThreads=(typeof SharedArrayBuffer!=='undefined'&&typeof crossOriginIsolated!=='undefined'&&crossOriginIsolated)?Math.min(4,(typeof navigator!=='undefined'&&navigator.hardwareConcurrency||1)-1):1;if(wasmPaths)ort.env.wasm.wasmPaths=wasmPaths;
      await stage('CPU prefix session',async()=>{let bytes;try{bytes=await ownedFetch(assetBase+selected.prefix.file,selected.prefix.sha256,selected.prefix.bytes);
        cpu=await ort.InferenceSession.create(new Uint8Array(bytes),{executionProviders:['wasm'],graphOptimizationLevel:'disabled',enableCpuMemArena:false,enableMemPattern:false,extra:{session:{disable_prepacking:'1'}}});stats.ortSessionCount=1;return cpu;
      }finally{if(bytes)jsRelease(bytes.byteLength);}});
    }
    const responseManifest={...manifest,prefix:selected.prefix||{sha256:null,file:null,bytes:0},coefficients:{sha256:stats.coefficientsSha256},selectedVariant:variant};
    return {stats,manifest:responseManifest,
      async infer(w,noise){
        if(disposed)throw Error('Block-stream session disposed');if(active)throw Error('One active face required');active=true;
        const faceStarted=performance.now();stats.currentFaceTimings={ordinal:stats.faces+1,drawStart:stats.drawCalls,overlapNote:'Compile/hash/texture API fields are nested within stage fields; do not add overlapping totals'};
        let primaryError,outputs,features,skip,cpuStyleBytes=0,cpuOutputBytes=0;const transient=new Set(),feeds={};
        const own=t=>(transient.add(t),t),drop=t=>{transient.delete(t);release(t);};
        try{
          if(!(w instanceof Float32Array)||w.length!==9216)throw Error('W+ must be18×512 FP32');
          stats.externalInputBytes=w.byteLength+Object.values(noise).reduce((n,a)=>n+a.byteLength,0);
          checkManaged(0,0,'external input admission');
          const cpuStyles={};
          if(!pure){
            for(const [name,dims] of Object.entries(selected.prefix.inputs)){const data=name==='w'?w:noise[name];if(!(data instanceof Float32Array)||data.length!==dims.reduce((a,b)=>a*b,1))throw Error('Invalid input '+name);feeds[name]=new ort.Tensor('float32',data,dims);}
            await stage('CPU prefix inference',async()=>{outputs=await cpu.run(feeds);cpuOutputBytes=Object.values(outputs).reduce((n,t)=>n+t.data.byteLength,0);jsAcquire(cpuOutputBytes);return outputs;});
            for(const [name,meta] of Object.entries(selected.prefix.outputs))if(name!=='features'&&name!=='skip'){const data=outputs[meta.name].data;jsAcquire(data.byteLength);cpuStyleBytes+=data.byteLength;cpuStyles[name]=data.slice();}
            if(selected.prefix.outputs.features){const b=manifest.blocks.find(b=>b.id===selected.gpuBlocks[0]);features=own(packedNchw(outputs[selected.prefix.outputs.features.name].data,b.inChannels,b.inSize));skip=own(packedNchw(outputs[selected.prefix.outputs.skip.name].data,3,b.inSize,false));}
            for(const tensor of Object.values(outputs))tensor.dispose?.();outputs=null;jsRelease(cpuOutputBytes);cpuOutputBytes=0;
          }else {latentTexture=own(texture(128,18,1,4,w));}
          if(!features){let input;try{input=await ownedFetch(assetBase+manifest.learnedInput.file,manifest.learnedInput.sha256,manifest.learnedInput.bytes);features=own(packedNchw(new Float32Array(input),512,4));}finally{if(input)jsRelease(input.byteLength);}}
          const zero=own(texture(1,1,1,4,new Float32Array(4)));let readback;
          for(const id of selected.gpuBlocks){
            const block=manifest.blocks.find(b=>b.id===id),size=block.size,groups=block.outChannels/4;
            let blockOwned=[],weights,small,styles,activation,nextFeatures,rgbA,rgbB,channelTile,phase,n0,n1,smallBytes=0,blockError;
            try{
              await stage(id+' coefficient upload',async()=>{const resources=await blockCoefficients(block);({weights,small,smallBytes}=resources);blockOwned=resources.owned;for(const t of blockOwned)own(t);});
              styles=await stage(id+' styles',()=>makeStyles(block,weights,cpuStyles,blockOwned));for(const t of blockOwned)own(t);
              const k=block.constants;
              if(block.hasConv0){
                const a=noise[block.noise.conv0.name];if(!(a instanceof Float32Array)||a.length!==size*size)throw Error('Invalid '+block.noise.conv0.name);
                n0=own(texture(size,size,1,1,a));activation=own(texture(size,size,groups,4,null,true));phase=own(texture(size+1,size+1));
                await stage(id+' transposed convolution and FIR',async()=>{
                  const p=cachedProgram('conv0-'+block.inChannels,conv0Source(block.inChannels)),f=cachedProgram('fir',FIR);
                  for(let group=0;group<groups;group++){
                    draw(p,phase,{samplers:{features,weights:weights.weight0,styles:styles.style0},ints:{group,inputSize:block.inSize}});
                    draw(f,activation,{samplers:{phase,noise:n0,demods:styles.demod0},floats:{filterWeights:small.filter0,strength:k.noiseStrength0,gain:k.gain0,alpha:k.leakyAlpha0},vectors:{bias:small.bias0.subarray(group*4,group*4+4)},ints:{group,outputSize:size}},group);
                    await progressBatch(group,groups,id+' conv0');
                  }
                });
                drop(phase);drop(n0);drop(features);features=null;await retire();
              }else{activation=features;features=null;}
              const a=noise[block.noise.conv1.name];if(!(a instanceof Float32Array)||a.length!==size*size)throw Error('Invalid '+block.noise.conv1.name);
              n1=own(texture(size,size,1,1,a));const last=size===1024;
              if(last)channelTile=own(texture(size,size));else nextFeatures=own(texture(size,size,groups,4,null,true));
              rgbA=own(texture(size,size));rgbB=own(texture(size,size));target(rgbA);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
              await stage(id+' convolution and ToRGB',async()=>{
                const p=cachedProgram('conv1-'+block.outChannels,conv1Source(block.outChannels)),acc=cachedProgram('accum-'+(!last),accumSource(!last));
                for(let group=0;group<groups;group++){
                  draw(p,last?channelTile:nextFeatures,{samplers:{features:activation,weights:weights.weight1,styles:styles.style1,noise:n1,demods:styles.demod1},floats:{strength:k.noiseStrength1,gain:k.gain1,alpha:k.leakyAlpha1},vectors:{bias:small.bias1.subarray(group*4,group*4+4)},ints:{group,outputSize:size}},last?0:group);
                  draw(acc,rgbB,{samplers:{features:last?channelTile:nextFeatures,previous:rgbA,weights:weights.weightRgb,styles:styles.styleRgb},ints:{group}});[rgbA,rgbB]=[rgbB,rgbA];
                  await progressBatch(group,groups,id+' conv1');
                }
              });
              drop(activation);drop(n1);if(channelTile)drop(channelTile);await retire();
              await stage(id+' RGB skip merge',async()=>{draw(cachedProgram('final',FINAL),rgbB,{samplers:{previous:rgbA,skip:skip||zero},floats:{filterWeights:small.filterRgb||new Float32Array(16)},vectors:{bias:small.biasRgb},ints:{hasSkip:block.hasSkip?1:0,outputSize:size}});await retire();});
              drop(rgbA);if(skip)drop(skip);skip=rgbB;features=nextFeatures;
            }catch(error){blockError=error;throw error;}finally{const errors=[];for(const t of blockOwned)try{drop(t);}catch(error){errors.push(String(error));}try{await retire();}catch(error){errors.push(String(error));}if(smallBytes)jsRelease(smallBytes);if(errors.length){stats.cleanupErrors=[...(stats.cleanupErrors||[]),{name:id+' cleanup',errors}];if(!blockError)throw Error(id+' cleanup failed: '+errors.join('; '));}}
            if(size===1024){
              readback=await stage('1024 full float readback',async()=>{target(skip);jsAcquire(1048576*16);try{const rgba=new Float32Array(1048576*4);gl.readPixels(0,0,1024,1024,gl.RGBA,gl.FLOAT,rgba);check('float readback');jsAcquire(3145728*4);try{const raw=new Float32Array(3145728);for(let p=0;p<1048576;p++)for(let c=0;c<3;c++)raw[c*1048576+p]=rgba[p*4+c];stats.returnedOutputBytes=raw.byteLength;return raw;}finally{jsRelease(3145728*4);}}finally{jsRelease(1048576*16);}});
            }
          }
          stats.faces++;return readback;
        }catch(error){primaryError=error;throw error;}finally{
          const errors=[];const attempt=(name,fn)=>{try{fn();}catch(error){errors.push({name,error:String(error)});}};
          if(outputs)for(const t of Object.values(outputs))attempt('output tensor disposal',()=>t.dispose?.());for(const t of Object.values(feeds))attempt('input tensor disposal',()=>t.dispose?.());
          if(cpuOutputBytes)jsRelease(cpuOutputBytes);if(cpuStyleBytes)jsRelease(cpuStyleBytes);
          for(const t of transient)attempt('transient texture release',()=>release(t));latentTexture=null;active=false;
          try{await retire();}catch(error){errors.push({name:'final fence',error:String(error)});}
          stats.currentFaceTimings.wallIncludingCheckpointsMs=performance.now()-faceStarted;stats.currentFaceTimings.drawCalls=stats.drawCalls-stats.currentFaceTimings.drawStart;stats.currentFaceTimings.completed=!primaryError&&!errors.length;stats.faceTimings.push(stats.currentFaceTimings);if(stats.faceTimings.length>36)stats.faceTimings.shift();stats.currentFaceTimings=null;
          if(errors.length){stats.cleanupErrors=[...(stats.cleanupErrors||[]),...errors];if(primaryError){try{primaryError.cleanupErrors=errors;}catch{}}else throw Error('Block-stream cleanup: '+errors.map(e=>e.error).join('; '));}
        }
      },
      async dispose(){if(disposed)return;if(active)throw Error('Terminate owning worker to cancel active inference');await cleanupAll();if(cleanupErrors.length)throw Error('Block-stream cleanup: '+cleanupErrors.map(x=>x.error).join('; '));}
    };
  }catch(error){await cleanupAll();if(cleanupErrors.length)throw Error(String(error)+'; cleanup: '+cleanupErrors.map(x=>x.error).join('; '),{cause:error});throw error;}
}

