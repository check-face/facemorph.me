// A tiny, early-listening entry keeps import failures distinct from inference failures.
const implementation = './compat-worker-memory-v1.js';
let started = false, ended = false, delegate = null, pending = [], timer;
const startedAt = performance.now();
function fail(error, stage) {
  if (ended) return;
  ended = true; clearTimeout(timer); pending = [];
  try { postMessage({done:true,completed:false,error:`CPU worker ${stage}: ${String(error)}`,meta:{workerStartup:{stage,implementation,elapsedMs:performance.now()-startedAt}}}); }
  finally { close(); }
}
function dispatch(event) {
  try { Promise.resolve(delegate(event)).catch(error => fail(error,'execution')); }
  catch (error) { fail(error,'execution'); }
}
function receive(event) {
  if (ended) return;
  if (started && event.data?.stop !== true) { fail('Duplicate or unsupported start message','protocol'); return; }
  if (delegate) { dispatch(event); return; }
  if (started) { if (pending.length < 16) pending.push(event); else fail('Too many startup messages','queue'); return; }
  started = true;
  postMessage({progress:'CPU worker ready; loading implementation',meta:{workerStartup:{stage:'listener-ready',implementation,elapsedMs:performance.now()-startedAt}}});
  timer = setTimeout(() => fail('Import deadline reached after 30 seconds','import'),30000);
  import(implementation).then(() => {
    if (ended) { close(); return; }
    const handler = self.onmessage;
    if (typeof handler !== 'function' || handler === receive) throw Error('Implementation did not install a handler');
    delegate = handler; self.onmessage = receive; clearTimeout(timer);
    postMessage({meta:{workerStartup:{stage:'implementation-ready',implementation,elapsedMs:performance.now()-startedAt}}});
    dispatch(event);
    for (const queued of pending.splice(0)) dispatch(queued);
  }).catch(error => fail(error,'import'));
}
self.onmessage = receive;
