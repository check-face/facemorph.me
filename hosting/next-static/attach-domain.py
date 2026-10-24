#!/usr/bin/env python3
"""Attach only the approved preview hostname; preserve classic and lab DNS."""
import json,os,urllib.request,urllib.error
from pathlib import Path
ACCOUNT='8f550a622a484c03d9267efd45573583';ZONE='893772fe7a5a4ee368f71706bc19e609';HOST='next.facemorph.me'
def api(path,method='GET',data=None):
 request=urllib.request.Request('https://api.cloudflare.com/client/v4/'+path,method=method,headers={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN'],'Content-Type':'application/json'},data=None if data is None else json.dumps(data).encode())
 with urllib.request.urlopen(request,timeout=60) as response:result=json.load(response)
 if not result.get('success'):raise RuntimeError('Cloudflare operation rejected')
 return result['result']
records=api(f'zones/{ZONE}/dns_records?name={HOST}')
expected='fa215bc2-c9d6-4646-a016-ae29ebffd7f1.cfargotunnel.com'
if any(record['name']!=HOST or record['type']!='CNAME' or record['content']!=expected for record in records):
 domains=api(f'accounts/{ACCOUNT}/workers/domains')
 if any(d['hostname']==HOST and d['service']=='facemorph-next' for d in domains):print('Approved preview already attached.');raise SystemExit
 raise SystemExit('Unexpected preview DNS; refusing to replace it.')
if len(records)>1:raise SystemExit('Unexpected duplicate preview DNS.')
# This is the task-owned temporary preview record, never a classic service record.
removed=None
try:
 if records:
  removed=records[0];api(f'zones/{ZONE}/dns_records/'+removed['id'],'DELETE')
 result=api(f'accounts/{ACCOUNT}/workers/domains','PUT',{'hostname':HOST,'service':'facemorph-next','zone_id':ZONE})
 print(json.dumps({'hostname':result['hostname'],'service':result['service'],'domainId':result['id']}))
except Exception:
 if removed:api(f'zones/{ZONE}/dns_records','POST',{key:removed[key] for key in ('type','name','content','ttl','proxied')})
 raise
