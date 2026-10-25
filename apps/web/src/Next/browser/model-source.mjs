import {createBrowserModelCache,acquireUncachedBytes} from '../Assets/model-cache.mjs';

// Download/permission/cancellation errors must keep their ordinary meaning. Only a native
// storage refusal permits this source to continue without durable model storage.
const storageFailure=error=>['QuotaExceededError','SecurityError','NotAllowedError',
 'NotReadableError','InvalidStateError','UnknownError'].includes(error?.name)||
 error?.message==='Persistent Cache Storage unavailable';

/** The execution worker's source. Uncached bytes belong to the current caller only:
 * no model map, synthetic local reader or persistent canary record is introduced. */
export async function createModelSource(options={},onUncached=()=>{}){
 let durable,uncached=false;
 const degrade=error=>{
  if(uncached)return;
  uncached=true;
  try{onUncached(error);}catch{/* progress observers cannot stop execution */}
 };
 try{durable=await createBrowserModelCache(options);}
 catch(error){if(!storageFailure(error))throw error;degrade(error);}
 return {
  get uncached(){return uncached;},
  has:asset=>uncached?Promise.resolve(false):durable.has(asset),
  records:{
   get:key=>uncached?Promise.resolve(undefined):durable.records.get(key),
   put:(key,value)=>uncached?Promise.resolve():durable.records.put(key,value),
   remove:key=>uncached?Promise.resolve():durable.records.remove(key)
  },
  // Background preparation has no consumer for transient bytes. It must stop rather
  // than downloading a route/encoder that cannot be saved or used by that operation.
  async acquire(asset,request){
   if(uncached)throw Error('Model storage is unavailable; background preparation stopped.');
   try{return await durable.acquire(asset,request);}
   catch(error){if(!request.signal?.aborted&&storageFailure(error))degrade(error);throw error;}
  },
  async bytes(asset,request,{allowUncached=true}={}){
   if(uncached&&!allowUncached)throw Error('Model storage is unavailable; background preparation stopped.');
   if(!uncached){
    try{return await (await durable.acquire(asset,request)).bytes();}
    catch(error){if(request.signal?.aborted||!storageFailure(error))throw error;degrade(error);if(!allowUncached)throw error;}
   }
   // The same grant pays for earlier failed writes and this explicit continuation.
   // The manager refuses if the remaining approved byte budget cannot cover it.
   return acquireUncachedBytes(asset,request,options);
  }
 };
}
