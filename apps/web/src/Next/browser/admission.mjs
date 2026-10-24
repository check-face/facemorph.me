// Per-operation route admission in the runtime (fm-lt2p): what this browser offers, read as values, handed to the
// pure policy in admission/route-admission.ts (fm-4umi). Nothing here reads labels, viewport or touch. The adapter
// facts come from the runtime's own requestAdapter() probe, taken before any GPU asset is acquired; the larger
// probes (how far one WebAssembly memory can grow, what VideoEncoder accepts) run only for the operation that needs
// them, once, so making a face never reserves the encoder's memory.
import {admit as decide,reasonFromError} from '../../admission/route-admission.ts';

const SIMD_PROBE=new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]);

/** WebGPU as the runtime's probe found it: 'absent' (no navigator.gpu), a null adapter, or its limits and facts. */
export function adapterFacts(gpu,adapter){
 if(!gpu)return 'absent';
 if(!adapter)return {adapter:null};
 return {adapter:{limits:{maxBufferSize:Number(adapter.limits?.maxBufferSize)||0,maxStorageBufferBindingSize:Number(adapter.limits?.maxStorageBufferBindingSize)||0},
  features:[...(adapter.features||[])].sort(),fallback:adapter.info?.isFallbackAdapter??adapter.isFallbackAdapter??null}};
}

let memoryBytes;
/** How far one WebAssembly memory grows, up to the e4e limit (64 KiB pages), measured once and released. */
export function wasmMemoryBytes(){
 if(memoryBytes!==undefined)return memoryBytes;
 memoryBytes=0;
 try{const m=new WebAssembly.Memory({initial:1,maximum:4096});for(const step of [255,768,1024,2048]){try{m.grow(step);}catch{break;}}memoryBytes=m.buffer.byteLength;}catch{}
 return memoryBytes;
}

let videoEncoder;
async function videoEncoderFacts(){
 if(videoEncoder)return videoEncoder;
 if(typeof globalThis.VideoEncoder!=='function')return videoEncoder='absent';
 const avc=async size=>{try{return (await VideoEncoder.isConfigSupported({codec:'avc1.42002A',width:size,height:size,bitrate:Math.round(size*size*16*.25/1000)*1000,framerate:16})).supported===true;}catch{return false;}};
 return videoEncoder={avc1024:await avc(1024),avc512:await avc(512)};
}

function threads(){
 try{return typeof SharedArrayBuffer==='function'&&new WebAssembly.Memory({initial:1,maximum:1,shared:true}).buffer instanceof SharedArrayBuffer;}catch{return false;}
}

/** The capability record for `operation`. maxMemoryBytes is measured only for photo-encode (the only reader). */
export async function capabilityRecord(operation,webgpu){
 const nav=globalThis.navigator;
 return {
  webgpu,
  wasm:{simd:WebAssembly.validate(SIMD_PROBE),threads:threads(),maxMemoryBytes:operation==='photo-encode'?wasmMemoryBytes():0},
  crossOriginIsolated:globalThis.crossOriginIsolated===true,
  deviceMemoryGiB:Number.isFinite(nav?.deviceMemory)?nav.deviceMemory:null,
  videoEncoder:operation==='morph'?await videoEncoderFacts():'absent',
 };
}

/** Qualified evidence: the manifest's identities and encoder scope, and what this session saw fail. */
export function admissionEvidence({manifest,manifestSha256,failedRoutes,deviceLost}){
 const stream=manifest?.encoderStream;
 return {
  modelIdentity:String(manifest?.modelSourceSha256||''),runtimeIdentity:String(manifestSha256||''),
  canary:{webgpu:failedRoutes.has('webgpu')?'failed':'not-run',cpu:failedRoutes.has('cpu')?'failed':'not-run'},
  deviceLost:deviceLost||null,
  encoderStream:stream?{phoneAdmitted:stream.phoneAdmitted===true,maxWasmBytes:Number(stream.maxWasmBytes)||268435456,scope:String(stream.scope||'release')}:null,
  ffmpegCodec:Boolean(manifest?.codec),
 };
}

/** One structured line per decision, so a failed lane run shows why a route was chosen. */
export function logAdmission(admission,webgpu,log=globalThis.console?.info?.bind(globalThis.console)){
 const e=admission.event;
 try{log?.('[facemorph-admission] '+JSON.stringify({operation:e.operation,requested:e.requestedProvider,
  adapter:typeof webgpu==='string'?webgpu:webgpu.adapter===null?'null adapter':{...webgpu.adapter.limits,fallback:webgpu.adapter.fallback},
  decision:admission.status,provider:e.provider,reasonKey:e.reasonKey,fallback:e.fallback?.stage??null}));}catch{}
}

/** A refused operation as an error the bridge shows as it is: the reason's sentence, with its key and Help anchor. */
export class AdmissionRefused extends Error{
 constructor(admission){super(admission.reason.text);this.name='AdmissionRefused';this.reasonKey=admission.reason.reasonKey;this.helpAnchor=admission.reason.helpAnchor;this.admission=admission.event;}
}

export {decide,reasonFromError};
