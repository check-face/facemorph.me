import {parseModelManifest} from '../../../../../packages/browser-model-manager/src/contracts/manifest.ts';

/** A catalogue refusal is data the caller can distinguish from device or network failure. */
export class RuntimeManifestRefused extends Error{
 constructor({code,path,message}){
  super('The model files are incompatible. Reload the page before continuing.');
  this.name='RuntimeManifestRefused';this.code='manifest-rejected';this.reason=code;
  this.path=path;this.detail=message;this.reload=true;
 }
}
const refuse=(path,message)=>{throw new RuntimeManifestRefused({code:'invalid-field',path,message});};

/** Admit the whole candidate before a runtime, worker or deployment identity uses any part. */
export function admitRuntimeManifest(candidate){
 const parsed=parseModelManifest(candidate);
 if(!parsed.ok)throw new RuntimeManifestRefused(parsed.error);
 const manifest=parsed.value;
 if(!Array.isArray(manifest.canaries)||manifest.canaries.length<2)refuse('$.canaries','at least two runtime canaries');
 const stream=manifest.encoderStream;
 if(stream&&manifest.encoder&&stream.sourceEncoderSha256!==manifest.encoder.sha256)
  refuse('$.encoderStream.sourceEncoderSha256','encoder stream and encoder source identities differ');
 if(stream&&manifest.alignmentSha256&&stream.preprocessingSha256!==manifest.alignmentSha256)
  refuse('$.encoderStream.preprocessingSha256','encoder stream and photo preprocessing identities differ');
 return manifest;
}
