// Small mathematical GPU screen only: no face model or performance qualification.
export async function runWebGLProbe(row,checkpoint){
 const canvas=typeof document==='undefined'?new OffscreenCanvas(8,8):document.createElement('canvas');canvas.width=canvas.height=8;
 const gl=canvas.getContext('webgl2',{antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false});
 row.webgl2Available=!!gl;if(!gl){row.unsupported=true;row.reason='WebGL2 context unavailable';return;}
 const resources=[];let intentionalLoss=false,primaryError;canvas.addEventListener('webglcontextlost',()=>{if(!intentionalLoss)row.contextLost=true;});
 try{
  row.backend='WebGL2';row.scope='8×8 four-channel 3×3 float convolution, dynamic uniform repeat; not face qualification';
  row.extensions=gl.getSupportedExtensions();row.limits=Object.fromEntries(['MAX_TEXTURE_SIZE','MAX_RENDERBUFFER_SIZE','MAX_TEXTURE_IMAGE_UNITS','MAX_FRAGMENT_UNIFORM_VECTORS'].map(k=>[k,gl.getParameter(gl[k])]));
  const ext=gl.getExtension('WEBGL_debug_renderer_info');if(ext)row.renderer={vendor:gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)};
  const precision=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);row.fragmentHighFloat={rangeMin:precision.rangeMin,rangeMax:precision.rangeMax,precision:precision.precision};
  row.floatRenderable=!!gl.getExtension('EXT_color_buffer_float');await checkpoint('WebGL2 capabilities saved');
  if(!row.floatRenderable){row.unsupported=true;row.reason='EXT_color_buffer_float unavailable';return;}
  const shader=(kind,source)=>{const s=gl.createShader(kind);if(!s)throw Error('Shader allocation failed');resources.push(()=>gl.deleteShader(s));gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)||'Shader compilation failed');return s;};
  const vs=shader(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0,1);}');
  const fs=shader(gl.FRAGMENT_SHADER,`#version 300 es
precision highp float;precision highp int;
uniform highp sampler2D inputTex;uniform float factor;out vec4 colour;
void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec4 sum=vec4(0);for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){ivec2 q=p+ivec2(x,y);vec4 v=vec4(0);if(all(greaterThanEqual(q,ivec2(0)))&&all(lessThan(q,ivec2(8))))v=texelFetch(inputTex,q,0);float k=float((y+1)*3+x+2)/16.0;sum+=vec4(dot(v,vec4(.25,-.5,.125,1)),dot(v,vec4(-.25,.5,1,.125)),dot(v,vec4(1,.125,-.5,.25)),dot(v,vec4(.125,1,.25,-.5)))*k;}colour=sum*factor;}`);
  const program=gl.createProgram();if(!program)throw Error('Program allocation failed');resources.push(()=>gl.deleteProgram(program));gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)||'Program linking failed');
  const input=Float32Array.from({length:256},(_,i)=>{const c=i%4,p=Math.floor(i/4);return ((p%8+3*Math.floor(p/8)+5*c)%17-8)/8;});
  function texture(data){const t=gl.createTexture();if(!t)throw Error('Texture allocation failed');resources.push(()=>gl.deleteTexture(t));gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,8,8,0,gl.RGBA,gl.FLOAT,data);return t;}
  const source=texture(input),output=texture(null),fb=gl.createFramebuffer();if(!fb)throw Error('Framebuffer allocation failed');resources.push(()=>gl.deleteFramebuffer(fb));gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);row.framebufferStatus=gl.checkFramebufferStatus(gl.FRAMEBUFFER);if(row.framebufferStatus!==gl.FRAMEBUFFER_COMPLETE)throw Error('Float framebuffer incomplete');
  gl.useProgram(program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,source);gl.uniform1i(gl.getUniformLocation(program,'inputTex'),0);gl.viewport(0,0,8,8);gl.disable(gl.BLEND);gl.disable(gl.DITHER);const weights=[[.25,-.5,.125,1],[-.25,.5,1,.125],[1,.125,-.5,.25],[.125,1,.25,-.5]];row.checks=[];row.drawCalls=0;
  for(const factor of [1,.5]){
   await checkpoint('WebGL2 convolution '+factor);gl.uniform1f(gl.getUniformLocation(program,'factor'),factor);gl.drawArrays(gl.TRIANGLES,0,3);row.drawCalls++;const actual=new Float32Array(256);gl.readPixels(0,0,8,8,gl.RGBA,gl.FLOAT,actual);const error=gl.getError();if(error!==gl.NO_ERROR||gl.isContextLost())throw Error('WebGL execution error '+error);
   let maxError=0,finite=true;for(let y=0;y<8;y++)for(let x=0;x<8;x++)for(let c=0;c<4;c++){let sum=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const qx=x+dx,qy=y+dy;if(qx<0||qx>=8||qy<0||qy>=8)continue;let dot=0;for(let j=0;j<4;j++)dot+=input[(qy*8+qx)*4+j]*weights[c][j];sum+=dot*((dy+1)*3+dx+2)/16;}const a=actual[(y*8+x)*4+c];finite&&=Number.isFinite(a);maxError=Math.max(maxError,Math.abs(a-sum*factor));}
   const result={factor,values:256,finite,maxError,tolerance:1e-6,passed:finite&&maxError<=1e-6};row.checks.push(result);await checkpoint('WebGL2 convolution validated');if(row.contextLost||gl.isContextLost())throw Error('WebGL context lost during validation save');if(!result.passed)throw Error('WebGL convolution correctness failed');
  }
  row.computePassed=true;row.trackedTextureBytes=2*8*8*4*4;
 }catch(error){primaryError=error;throw error;}finally{
  const errors=[];for(const dispose of resources.reverse())try{dispose();}catch(e){errors.push(String(e));}intentionalLoss=true;try{gl.getExtension('WEBGL_lose_context')?.loseContext();}catch(e){errors.push(String(e));}if(errors.length){row.cleanupErrors=errors;throw Error([primaryError?String(primaryError):null,'WebGL resource cleanup failed: '+errors.join('; ')].filter(Boolean).join(' · '));}
 }
}
