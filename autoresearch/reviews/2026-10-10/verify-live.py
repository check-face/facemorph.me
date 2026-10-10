#!/usr/bin/env python3
"""Bind publicly served UI/worker/catalogue/preview bytes to a qualified artifact."""
import argparse,concurrent.futures,datetime,hashlib,json,pathlib,re,urllib.request
p=argparse.ArgumentParser();p.add_argument('--artifact',type=pathlib.Path,required=True);p.add_argument('--run',type=int,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
root=a.artifact/'deploy-next';origin='https://next.facemorph.me'
def fetch(path):
 with urllib.request.urlopen(urllib.request.Request(origin+'/'+path,headers={'User-Agent':'curl/8.7.1','Cache-Control':'no-cache'}),timeout=45) as r:return r.read(16*1024*1024+1)
source=(a.artifact/'next-site-source.txt').read_text().strip();index=fetch('');expected=(root/'index.html').read_bytes();assets=sorted([p for p in root.glob('*') if p.suffix in ['.js','.css']]+[root/'catalogue.json',root/'preview/hello-1024.webp'])
# The existing platform rule may inject this single beacon even for a curl client.
# Verify the exact remaining application HTML; do not ignore arbitrary script changes.
normalized,beacons=re.subn(rb'\s*<script\b[^>]*src="https://static\.cloudflareinsights\.com/beacon\.min\.js[^"<>]*"[^>]*>\s*</script>\s*',b'',index)
assert beacons<=1,'Unexpected duplicate platform beacon'
def check(file):
 path=str(file.relative_to(root));data=fetch(path);assert data==file.read_bytes(),f'Live asset mismatch: {path}'
 return {'path':path,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:receipts=list(pool.map(check,assets))
manifest=fetch('runtime/manifest.json');pin=hashlib.sha256(pathlib.Path('hosting/next-static/runtime-overlay/manifest.json').read_bytes()).hexdigest();assert hashlib.sha256(manifest).hexdigest()==pin,'Live manifest mismatch'
app=next(root.glob('app.*.js')).read_text();builds=sorted(set(re.findall(r'next-[a-f0-9]{16}',app)));assert len(builds)==1,builds
report={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'passed':True,'source':source,'qualifiedRun':a.run,'origin':origin,'indexMatchesForCurlClient':index==expected,'applicationIndexMatchesAfterPlatformBeacon':normalized==expected,'platformBeaconCount':beacons,'servedIndexSha256':hashlib.sha256(index).hexdigest(),'diagnosticBuild':builds[0],'runtimeManifestSha256':pin,'assets':receipts,'scope':'Qualified artifact UI/worker/style/catalogue/hello bytes and pinned live runtime manifest. Model payloads not redownloaded; manifest pins identify them. One known platform Cloudflare beacon is separated from exact application HTML; no arbitrary script changes ignored.'}
assert report['applicationIndexMatchesAfterPlatformBeacon'],'Live application index differs from qualified artifact'
a.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['passed','source','diagnosticBuild','qualifiedRun']}))
