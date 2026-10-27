// One worker's boundary between verified reads and heavyweight execution. Reads can overlap, while init,
// session creation and inference wait for every read and for the host's actual compute permit.
export function createExecutionGate({acquire=async()=>{},release=async()=>{}}={}){
 const queue=[],active=new Set(),idle=new Set(),controller=new AbortController();let mode=null,admission=null,admitted=false,releasing=false,closed=null;
 const notifyIdle=()=>{if(!active.size&&!queue.length&&!releasing){for(const resolve of idle)resolve();idle.clear();}};
 function pump(){
  if(closed||releasing||!queue.length)return;
  if(mode&&queue[0].kind!==mode)return;
  if(!mode){mode=queue[0].kind;if(mode==='compute')admission=Promise.resolve().then(acquire).then(()=>{admitted=true;});}
  do{
   const task=queue.shift();active.add(task);
   (async()=>{
    let result,error,failed=false;
    try{
     if(task.kind==='compute')await admission;
     if(closed)throw closed;
     task.started=true;
     result=await task.work();
    }catch(cause){error=cause;failed=true;}
    active.delete(task);
    if(!active.size){
     releasing=true;
     try{if(admitted)await release();}catch(cause){if(!failed)error=cause;failed=true;}
     finally{admitted=false;admission=null;mode=null;releasing=false;}
    }
    if(failed)task.reject(error);else task.resolve(result);
    pump();
    notifyIdle();
   })();
  }while(queue.length&&queue[0].kind===mode);
 }
 const run=(kind,work)=>closed?Promise.reject(closed):new Promise((resolve,reject)=>{queue.push({kind,work,resolve,reject});pump();});
 return Object.freeze({
  read:work=>run('read',work),compute:work=>run('compute',work),signal:controller.signal,
  async drain(){
   for(;;){
    if(active.size||queue.length||releasing)await new Promise(resolve=>idle.add(resolve));
    else{
     // Promise continuations can schedule another read or compute section after a section settles.
     await new Promise(resolve=>setTimeout(resolve,0));
     if(!active.size&&!queue.length&&!releasing)return;
    }
   }
  },
  close(reason=new DOMException('Execution cancelled','AbortError')){
   if(closed)return;closed=reason;controller.abort(reason);
   // An admitted callback may create an owned session. Let its result reach its owner so it can
   // retain/dispose that resource; rejecting its promise here would discard a late-created session.
   for(const task of [...queue.splice(0),...active])if(!task.started)task.reject(reason);
   notifyIdle();
  }
 });
}
