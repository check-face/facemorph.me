// Same bounded payload contract as hosting/next/server.py; never serialize request metadata.
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const stages=new Set('asset-acquisition runtime-loading model-loading model-loaded mapping-loading mapping canary canary-invalidated synthesis synthesis-complete alignment alignment-complete encoder-loading encoder-loaded encoder-correctness-check encoder-correctness-complete encoding encoding-complete mapping-complete original-cache-hit original-cached original-cache-invalid cache-unavailable fallback-cpu codec-loading face morph export route-admitted'.split(' '));
const fields=new Set('schemaVersion session run event action platform language build stage elapsedMs stageMs errorCode browser provider device browserMajor bundle gpu routeOutcome cores memoryGb isolated errorStage errorKind'.split(' '));
// gpu and routeOutcome answer why a device ended up on the path it did: whether the browser
// offered WebGPU at all, and whether a route was admitted, refused or never attempted. Both are
// closed vocabularies carrying no device detail beyond what provider/platform already say.
const enums={event:['start','stage','completed','cancelled','failed','interrupted'],action:['faces','morph','project'],errorCode:['cancelled','operation_failed'],platform:['ios','android','macos','windows','linux','other'],browser:['safari','chromium','firefox','other'],provider:['cpu','webgl','webgpu','native-cpu','native-gpu','auto'],gpu:['webgpu','webgl-only','none'],routeOutcome:['admitted','canary-failed','unsupported','start-failed','superseded'],errorKind:['aborted','memory','integrity','network','unsupported','timeout','storage','decode','unknown']};
export function checkedEvent(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1||Object.keys(value).some(k=>!fields.has(k)))throw Error('fields');
 for(const key of ['session','run',...('device'in value?['device']:[])])if(typeof value[key]!=='string'||!UUID.test(value[key]))throw Error('identity');
 if(!('event'in value))throw Error('event');
 for(const [key,choices]of Object.entries(enums))if(key in value&&!choices.includes(value[key]))throw Error('enum');
 if('stage'in value&&!stages.has(value.stage))throw Error('stage');
 for(const key of ['elapsedMs','stageMs'])if(key in value&&(!Number.isInteger(value[key])||value[key]<0||value[key]>86400000))throw Error('timing');
 if('browserMajor'in value&&(!Number.isInteger(value.browserMajor)||value.browserMajor<1||value.browserMajor>9999))throw Error('version');
 if('cores'in value&&(!Number.isInteger(value.cores)||value.cores<1||value.cores>256))throw Error('cores');
 if('memoryGb'in value&&(!Number.isInteger(value.memoryGb)||value.memoryGb<1||value.memoryGb>1024))throw Error('memory');
 if('isolated'in value&&typeof value.isolated!=='boolean')throw Error('isolated');
 if('errorStage'in value&&!stages.has(value.errorStage))throw Error('errorStage');
 if('language'in value&&(typeof value.language!=='string'||! /^[A-Za-z-]{2,20}$/.test(value.language)))throw Error('language');
 if('bundle'in value&&(typeof value.bundle!=='string'||! /^[a-f0-9]{64}$/.test(value.bundle)))throw Error('bundle');
 if('build'in value&&(typeof value.build!=='string'||! /^[A-Za-z0-9._-]{1,80}$/.test(value.build)))throw Error('build');
 return {...value};
}
