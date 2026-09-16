import { Sha256 } from '/src/Next/Assets/sha256.mjs';
self.onmessage = ({data}) => {
  try { const hash=new Sha256();hash.update(new Uint8Array(data));postMessage({hash:hash.hex()}); }
  catch (error) { postMessage({error:String(error)}); }
};
