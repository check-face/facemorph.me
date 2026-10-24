import {run} from './suite.mjs';
run().then(r=>postMessage(r),e=>postMessage({ok:false,error:String(e&&e.stack||e)}));
