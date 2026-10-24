"""Verify an exact compiled web artifact (deploy-next/, next-site-SHA256SUMS, next-site-source.txt) against its
source revision and write a receipt. Re-homed from classic desktop/scripts/ by fm-be10 with every check kept; it
runs on Python 3.8 (triton) as well, so it streams SHA-256 and resolves containment without file_digest or
is_relative_to."""
import argparse
import hashlib
import json
from pathlib import Path
import re

def inside(path,folder):
    try:path.relative_to(folder);return True
    except ValueError:return False
p=argparse.ArgumentParser();p.add_argument('--artifact',type=Path,required=True);p.add_argument('--revision',required=True);p.add_argument('--receipt',type=Path,required=True);a=p.parse_args()
if not re.fullmatch('[0-9a-f]{40}',a.revision):raise ValueError('Expected full source revision')
root=a.artifact.resolve()
if (root/'next-site-source.txt').read_text().strip()!=a.revision:raise ValueError('Web artifact source revision differs')
listed=set();entries=[]
for line in (root/'next-site-SHA256SUMS').read_text().splitlines():
    digest,name=line.split('  ',1);relative=Path(name)
    if not re.fullmatch('[0-9a-f]{64}',digest) or relative.is_absolute() or '..' in relative.parts or relative.parts[0]!='deploy-next' or name in listed:raise ValueError('Invalid web artifact inventory')
    source=root/relative
    if source.is_symlink() or not inside(source.resolve(),root/'deploy-next'):raise ValueError('Web artifact path escapes frontend')
    h=hashlib.sha256()
    with source.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1<<20),b''):h.update(chunk)
    actual=h.hexdigest()
    if actual!=digest:raise ValueError('Web artifact checksum differs: '+name)
    listed.add(name);entries.append({'path':name,'sha256':digest})
actual_files={p.relative_to(root).as_posix() for p in (root/'deploy-next').rglob('*') if p.is_file()}
if listed!=actual_files or 'deploy-next/index.html' not in listed:raise ValueError('Incomplete web artifact inventory')
a.receipt.parent.mkdir(parents=True,exist_ok=True)
a.receipt.write_text(json.dumps({'schemaVersion':1,'webSourceRevision':a.revision,'files':entries},indent=2)+'\n')
print(f'Verified {len(entries)} compiled web files at {a.revision}')
