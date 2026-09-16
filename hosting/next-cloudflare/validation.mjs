// Same bounded payload contract as hosting/next/server.py; never serialize request metadata.
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const stages=new Set('asset-acquisition runtime-loading model-loading model-loaded mapping-loading mapping canary synthesis synthesis-complete alignment alignment-complete encoder-loading encoder-loaded encoder-correctness-check encoder-correctness-complete encoding encoding-complete mapping-complete original-cache-hit original-cached cache-unavailable codec-loading face morph export'.split(' '));
const fields=new Set('schemaVersion session run event action platform language build stage elapsedMs stageMs errorCode browser provider device browserMajor bundle'.split(' '));
const enums={event:['start','stage','completed','cancelled','failed'],action:['faces','morph','project'],errorCode:['cancelled','operation_failed'],platform:['ios','android','macos','windows','linux','other'],browser:['safari','chromium','firefox','other'],provider:['cpu','webgl','webgpu','native-cpu','native-gpu','auto']};
export function checkedEvent(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1||Object.keys(value).some(k=>!fields.has(k)))throw Error('fields');
 for(const key of ['session','run',...('device'in value?['device']:[])])if(typeof value[key]!=='string'||!UUID.test(value[key]))throw Error('identity');
 if(!('event'in value))throw Error('event');
 for(const [key,choices]of Object.entries(enums))if(key in value&&!choices.includes(value[key]))throw Error('enum');
 if('stage'in value&&!stages.has(value.stage))throw Error('stage');
 for(const key of ['elapsedMs','stageMs'])if(key in value&&(!Number.isInteger(value[key])||value[key]<0||value[key]>86400000))throw Error('timing');
 if('browserMajor'in value&&(!Number.isInteger(value.browserMajor)||value.browserMajor<1||value.browserMajor>9999))throw Error('version');
 if('language'in value&&(typeof value.language!=='string'||! /^[A-Za-z-]{2,20}$/.test(value.language)))throw Error('language');
 if('bundle'in value&&(typeof value.bundle!=='string'||! /^[a-f0-9]{64}$/.test(value.bundle)))throw Error('bundle');
 if('build'in value&&(typeof value.build!=='string'||! /^[A-Za-z0-9._-]{1,80}$/.test(value.build)))throw Error('build');
 return {...value};
}
