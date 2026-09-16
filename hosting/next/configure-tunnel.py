#!/usr/bin/env python3
"""Configure only the authorized next/labs preview tunnel; never classic DNS."""
import argparse
import json
import os
import subprocess
import urllib.parse
import urllib.request

ACCOUNT='8f550a622a484c03d9267efd45573583'
ZONE='893772fe7a5a4ee368f71706bc19e609'
NAME='facemorph-preview'
HOSTS={'next.facemorph.me':8148,'labs.facemorph.me':8147}

def api(method,path,value=None):
    request=urllib.request.Request('https://api.cloudflare.com/client/v4/'+path,method=method,
        headers={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN'],'Content-Type':'application/json'},
        data=json.dumps(value).encode() if value is not None else None)
    with urllib.request.urlopen(request,timeout=60) as response:
        data=json.load(response)
    if not data.get('success'):raise RuntimeError('Cloudflare operation rejected: '+path)
    return data['result']

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--publish-dns',action='store_true');args=parser.parse_args()
    path=f'accounts/{ACCOUNT}/cfd_tunnel'
    found=[x for x in api('GET',path+'?is_deleted=false') if x['name']==NAME]
    if len(found)>1:raise RuntimeError('Ambiguous preview tunnel')
    tunnel=found[0] if found else api('POST',path,{'name':NAME,'config_src':'cloudflare'})
    if tunnel.get('config_src')!='cloudflare':raise RuntimeError('Unexpected tunnel ownership/configuration')
    ident=tunnel['id']
    api('PUT',path+'/'+ident+'/configurations',{'config':{'ingress':[{'hostname':host,'service':f'http://127.0.0.1:{port}'} for host,port in HOSTS.items()]+[{'service':'http_status:404'}]}})
    token=api('GET',path+'/'+ident+'/token')
    subprocess.run(['ssh','-o','BatchMode=yes','truenas','umask 077; mkdir -p ~/facemorph-preview; cat > ~/facemorph-preview/.env'],input=('TUNNEL_TOKEN='+token+'\n').encode(),check=True)
    if args.publish_dns:
        for host in HOSTS:
            records=api('GET',f'zones/{ZONE}/dns_records?name='+urllib.parse.quote(host))
            content=ident+'.cfargotunnel.com'
            if records:
                if len(records)!=1 or records[0]['type']!='CNAME' or records[0]['content']!=content:
                    raise RuntimeError('Refusing to replace existing DNS for '+host)
            else:api('POST',f'zones/{ZONE}/dns_records',{'type':'CNAME','name':host,'content':content,'proxied':True,'ttl':1})
    print(json.dumps({'tunnelId':ident,'hosts':list(HOSTS),'dnsPublished':args.publish_dns}))

if __name__=='__main__':main()
