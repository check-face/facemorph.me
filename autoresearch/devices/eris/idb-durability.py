# Executed by browser-harness (see gpu-bench.sh). Times the product's original-cache write shape
# (a ~2.8 MB PNG Blob plus a W+ Float32Array(9216) in one readwrite transaction, awaiting
# tx.oncomplete exactly as originals.mjs does) under each IndexedDB durability hint, interleaved
# so drift hits every arm equally. The page is the DevTools endpoint's own localhost origin: a
# secure context, empty profile, same storage backend the product uses.
import json, os
port = os.environ['BU_CDP_URL'].rsplit(':', 1)[1]
new_tab('http://localhost:%s/json/version' % port)
wait_for_load()
result = js("""(async()=>{
  const open=n=>new Promise((res,rej)=>{const r=indexedDB.open(n,1);r.onupgradeneeded=()=>r.result.createObjectStore('originals');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
  const db=await open('durability-probe');
  const bytes=new Uint8Array(2838913);crypto.getRandomValues(bytes.subarray(0,65536));for(let i=65536;i<bytes.length;i++)bytes[i]=bytes[i-65536]^(i&7);
  const put=(opts,i)=>new Promise((res,rej)=>{const blob=new Blob([bytes],{type:'image/png'});const t0=performance.now();
    const tx=opts?db.transaction('originals','readwrite',opts):db.transaction('originals','readwrite');
    tx.objectStore('originals').put({blob,values:new Float32Array(9216),i},'k'+Math.random());
    tx.oncomplete=()=>res(performance.now()-t0);tx.onerror=()=>rej(tx.error)});
  const arms={default:null,relaxed:{durability:'relaxed'},strict:{durability:'strict'}};
  const out={default:[],relaxed:[],strict:[]};
  for(let round=0;round<14;round++){const order=round%2?['strict','relaxed','default']:['default','relaxed','strict'];
    for(const a of order)out[a].push(await put(arms[a],round));}
  const med=a=>{const s=a.slice(2).sort((x,y)=>x-y);return s[Math.floor(s.length/2)]};
  return {median:{default:med(out.default),relaxed:med(out.relaxed),strict:med(out.strict)},raw:out};})()""")
print(json.dumps(result))
