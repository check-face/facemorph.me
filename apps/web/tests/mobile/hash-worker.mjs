import { Sha256 } from '/packages/browser-model-manager/cache/sha256.js';
self.onmessage = ({data}) => {
  try { const hash=new Sha256();hash.update(new Uint8Array(data));postMessage({hash:hash.hex()}); }
  catch (error) { postMessage({error:String(error)}); }
};
