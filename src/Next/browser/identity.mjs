// NumPy RandomState legacy MT19937 + polar Gaussian (not default_rng).
export function randomState(seed) {
  const mt = new Uint32Array(624); let index = 624, spare;
  const init = value => { mt[0] = value >>> 0; for (let i=1;i<624;i++) mt[i]=(Math.imul(1812433253,mt[i-1]^(mt[i-1]>>>30))+i)>>>0; };
  if (typeof seed === 'number') init(seed);
  else {
    init(19650218); let i=1,j=0;
    for(let k=Math.max(624,seed.length);k;k--){ mt[i]=((mt[i]^Math.imul(mt[i-1]^(mt[i-1]>>>30),1664525))+seed[j]+j)>>>0; if(++i>=624){mt[0]=mt[623];i=1;}if(++j>=seed.length)j=0; }
    for(let k=623;k;k--){ mt[i]=((mt[i]^Math.imul(mt[i-1]^(mt[i-1]>>>30),1566083941))-i)>>>0;if(++i>=624){mt[0]=mt[623];i=1;} } mt[0]=0x80000000;
  }
  function uint(){if(index>=624){for(let i=0;i<624;i++){const y=(mt[i]&0x80000000)|(mt[(i+1)%624]&0x7fffffff);mt[i]=mt[(i+397)%624]^(y>>>1)^((y&1)?0x9908b0df:0);}index=0;}let y=mt[index++];y^=y>>>11;y^=(y<<7)&0x9d2c5680;y^=(y<<15)&0xefc60000;y^=y>>>18;return y>>>0;}
  const uniform=()=>((uint()>>>5)*67108864+(uint()>>>6))/9007199254740992;
  return {normal(){if(spare!==undefined){const v=spare;spare=undefined;return v;}let x,y,r;do{x=2*uniform()-1;y=2*uniform()-1;r=x*x+y*y;}while(r>=1||r===0);const f=Math.sqrt(-2*Math.log(r)/r);spare=f*x;return f*y;}};
}
export async function inputLatent(mode,value) {
  if(typeof value!=='string'||new TextEncoder().encode(value).length>512)throw new TypeError('Use at most 512 bytes of text.');
  let seed,identity;
  if(mode==='seed') {if(!/^[0-9]+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>4294967295)throw new TypeError('Seed must be a whole number from 0 to 4294967295.');seed=Number(value);identity={seed};}
  else if(mode==='text'){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));const view=new DataView(hash);seed=Array.from({length:8},(_,i)=>view.getUint32(i*4,true));identity={sha256:Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('')};}
  else throw new TypeError('Choose seed or text.');
  const rng=randomState(seed);return {identity,values:Float32Array.from({length:512},()=>rng.normal()),shape:[1,512],space:'z'};
}
export function truncate(w,average,psi=.7,cutoff=8){if(w.length!==9216||average.length!==512||!Number.isFinite(psi)||psi<0||psi>1||!Number.isInteger(cutoff)||cutoff<0||cutoff>18)throw Error('Invalid truncation');const result=new Float32Array(w);for(let l=0;l<cutoff;l++)for(let i=0;i<512;i++){const k=l*512+i;result[k]=Math.fround(average[i]+Math.fround(Math.fround(w[k]-average[i])*Math.fround(psi)));}return result;}
export function requireLatent(values){if(!(values instanceof Float32Array)||values.length!==9216||!values.every(Number.isFinite))throw new TypeError('Expected finite float32 W+ [1,18,512].');return values;}
export function rgba1024(raw){if(raw.length!==3*1024*1024)throw Error('Synthesis output shape mismatch');const rgba=new Uint8ClampedArray(4*1024*1024);for(let p=0;p<1048576;p++){for(let c=0;c<3;c++){const v=raw[c*1048576+p];if(!Number.isFinite(v))throw Error('Nonfinite synthesis output');rgba[p*4+c]=Math.trunc(Math.max(0,Math.min(255,Math.fround(Math.fround(v*127.5)+128))));}rgba[p*4+3]=255;}return rgba;}
// Transport locations, canary selection and release labels do not change a face.
export function generationIdentity(manifest,kind){return {schema:'canonical-face-v1',synthesis:manifest.synthesis.sha256,mapping:kind==='seed'?manifest.mapping.sha256:null,average:kind==='seed'?manifest.average.sha256:null,encoder:kind==='photo'?(manifest.encoderStream?.sourceEncoderSha256||manifest.encoder?.sha256):null,...(kind==='photo'&&manifest.encoderStream?{encoderStream:manifest.encoderStream.sha256}:{}),alignment:kind==='photo'?manifest.alignmentSha256:null,noise:manifest.noise.map(n=>({name:n.name,shape:n.shape,sha256:n.sha256})),truncation:kind==='seed'?{psi:.7,cutoff:8}:null,outputPipeline:'nchw-f32-mul127.5-add128-trunc-rgba8-raw-png-v1'};}
