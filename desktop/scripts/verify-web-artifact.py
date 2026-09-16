"""Verify exact compiled web artifact before reusing it in the desktop shell."""
import argparse
import hashlib
import json
from pathlib import Path
import re

p=argparse.ArgumentParser();p.add_argument('--artifact',type=Path,required=True);p.add_argument('--revision',required=True);p.add_argument('--receipt',type=Path,required=True);a=p.parse_args()
if not re.fullmatch('[0-9a-f]{40}',a.revision):raise ValueError('Expected full source revision')
root=a.artifact.resolve()
if (root/'next-site-source.txt').read_text().strip()!=a.revision:raise ValueError('Web artifact source revision differs')
listed=set();entries=[]
for line in (root/'next-site-SHA256SUMS').read_text().splitlines():
    digest,name=line.split('  ',1);relative=Path(name)
    if not re.fullmatch('[0-9a-f]{64}',digest) or relative.is_absolute() or '..' in relative.parts or relative.parts[0]!='deploy-next' or name in listed:raise ValueError('Invalid web artifact inventory')
    source=root/relative
    if source.is_symlink() or not source.resolve().is_relative_to(root/'deploy-next'):raise ValueError('Web artifact path escapes frontend')
    with source.open('rb') as stream:actual=hashlib.file_digest(stream,'sha256').hexdigest()
    if actual!=digest:raise ValueError('Web artifact checksum differs: '+name)
    listed.add(name);entries.append({'path':name,'sha256':digest})
actual_files={p.relative_to(root).as_posix() for p in (root/'deploy-next').rglob('*') if p.is_file()}
if listed!=actual_files or 'deploy-next/index.html' not in listed:raise ValueError('Incomplete web artifact inventory')
a.receipt.parent.mkdir(parents=True,exist_ok=True)
a.receipt.write_text(json.dumps({'schemaVersion':1,'webSourceRevision':a.revision,'files':entries},indent=2)+'\n')
print(f'Verified {len(entries)} compiled web files at {a.revision}')
