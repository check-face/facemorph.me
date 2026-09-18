import {runStatus as baseStatus,paintRunStatus} from './run-status-v3.js';
export {paintRunStatus};
export function runStatus(options){
 const state=baseStatus(options);
 if(options.report?.unsupported&&options.report.finished)return {...state,kind:'warning',title:'GPU UNAVAILABLE — no face inference ran',detail:'Try CPU on the main lab. '+(options.saved?'Device diagnostics saved automatically.':'Keep this tab open while device diagnostics save.')};
 if(state.kind==='idle')return {...state,detail:'Tap Test GPU. Wait for the final result before closing this tab.'};
 return state;
}
