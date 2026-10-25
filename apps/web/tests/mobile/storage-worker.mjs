import {runNativeManagerMatrix} from './manager-matrix.mjs';
self.onmessage=async({data})=>{
 try{self.postMessage(await runNativeManagerMatrix(data.runId));}
 catch(error){self.postMessage({error:String(error.stack||error)});}
};
