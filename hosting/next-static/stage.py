#!/usr/bin/env python3
"""Assemble the reviewed frontend and immutable runtime; never copy private inventories."""
import argparse
import os
from pathlib import Path
import shutil
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/hosting'))
from response_headers import headers_text

p=argparse.ArgumentParser();p.add_argument('--runtime',type=Path,required=True);p.add_argument('--frontend',type=Path,required=True);p.add_argument('--catalogue',type=Path,required=True);p.add_argument('--output',type=Path,default=Path(__file__).parent/'public');a=p.parse_args()
if a.output.exists():
    raise SystemExit('Use a fresh staging directory to avoid stale public assets.')
a.output.mkdir(parents=True)
def copy_tree(src,dst):
    for item in src.rglob('*'):
        if item.is_dir(): continue
        relative=item.relative_to(src)
        if item.is_symlink() or any(part.startswith('.') for part in relative.parts) or 'private' in item.name.lower():
            raise ValueError('Unsafe publication file')
        if item.stat().st_size>25*1024*1024:
            raise ValueError('Static asset exceeds25MiB')
        dest=dst/relative;dest.parent.mkdir(parents=True,exist_ok=True)
        # The runtime is immutable and content-addressed, and staging only ever reads it, so a
        # hard link publishes the identical bytes without a second copy. A full copy of the
        # runtime is several gigabytes and staging used to spend that on every promotion. Falls
        # back to copying across filesystems, where linking is not possible. A path already staged
        # (the runtime's own notices, overlaid by next/notices) is detached first: copying onto it
        # would write through its hard link into the acquired runtime cache.
        dest.unlink(missing_ok=True)
        try:
            os.link(item,dest)
        except OSError:
            shutil.copyfile(item,dest)
copy_tree(a.runtime,a.output/'runtime');copy_tree(a.frontend,a.output)
# Generated publication files may have been hard-linked from the frontend. Detach
# them before writing so staging never changes the identified input artifact.
for relative in ('catalogue.json', 'names/index.html', '_headers', '_redirects'):
    (a.output/relative).unlink(missing_ok=True)
shutil.copyfile(a.catalogue,a.output/'catalogue.json')
(a.output/'names').mkdir(exist_ok=True)
shutil.copyfile(a.output/'index.html',a.output/'names/index.html')
copy_tree(Path(__file__).parent.parent/'next/notices',a.output/'runtime/notices')
(a.output/'_headers').write_text(headers_text())
(a.output/'_redirects').write_text('/* /index.html 200\n')
print('Independent static candidate staged:',a.output)
