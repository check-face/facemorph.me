// Private operator tool. Never creates a raw-report export, prints credentials or opens a public read route.
import {UUID} from './validation.mjs';
import {pathToFileURL} from 'node:url';
export async function deleteRun({run,account,namespace,token,fetchImpl=fetch}){
 if(!UUID.test(run||'')||! /^[a-f0-9]{32}$/.test(account||'')||! /^[a-f0-9]{32}$/.test(namespace||'')||!token)throw Error('Expected run UUID, account ID, namespace ID and scoped API token');
 const base=`https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespace}`,prefix='runs/'+run+'/';let cursor='',keys=[];const cursors=new Set();
 do{const url=new URL(base+'/keys');url.searchParams.set('prefix',prefix);url.searchParams.set('limit','1000');if(cursor)url.searchParams.set('cursor',cursor);
  const r=await fetchImpl(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Private KV listing failed');const data=await r.json();if(!data.success||!Array.isArray(data.result))throw Error('Invalid KV listing');
  for(const item of data.result){if(typeof item.name!=='string'||!item.name.startsWith(prefix))throw Error('Unexpected key outside requested run');keys.push(item.name);}
  if(keys.length>900)throw Error('Run exceeds one deletion allowance; use the private dashboard within remaining Free quotas');cursor=data.result_info?.cursor||'';if(cursor){if(cursors.has(cursor)||cursors.size>=20)throw Error('Invalid or excessive KV pagination');cursors.add(cursor);}
 }while(cursor);
 if(keys.length){const r=await fetchImpl(base+'/bulk',{method:'DELETE',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(keys),signal:AbortSignal.timeout(15000)});if(!r.ok||(await r.json()).success!==true)throw Error('Private KV deletion failed');}
 return {deleted:keys.length,run};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const result=await deleteRun({run:process.argv[2],account:process.env.CLOUDFLARE_ACCOUNT_ID,namespace:process.env.DIAGNOSTICS_NAMESPACE_ID,token:process.env.CLOUDFLARE_API_TOKEN});console.log(JSON.stringify(result));}catch(error){console.error(error.message);process.exitCode=1;}
}
