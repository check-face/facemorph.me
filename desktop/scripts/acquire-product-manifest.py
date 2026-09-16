"""Acquire build input pinned by the operator/CI; no renderer-selected origins."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.request
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args()
url=os.environ['MANIFEST_URL'];digest=os.environ['MANIFEST_SHA256']
if not url.startswith('https://') or not re.fullmatch('[0-9a-f]{64}',digest):raise ValueError('HTTPS and pinned SHA-256 required')
with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'FaceMorph-Preview/0.1 build-acquisition'}),timeout=60) as response:
    if not response.url.startswith('https://'):raise ValueError('Insecure manifest redirect')
    data=response.read(2*1024*1024+1)
if len(data)>2*1024*1024 or hashlib.sha256(data).hexdigest()!=digest:raise ValueError('Manifest integrity mismatch')
manifest=json.loads(data)
if manifest.get('schemaVersion')!=1 or not manifest.get('encoder') or not manifest.get('landmarks'):raise ValueError('Complete photo product manifest required')
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_bytes(data)
