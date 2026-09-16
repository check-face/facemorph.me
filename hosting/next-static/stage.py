#!/usr/bin/env python3
"""Assemble the reviewed frontend and immutable runtime; never copy private inventories."""
import argparse
import os
from pathlib import Path
import shutil

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
        # back to copying across filesystems, where linking is not possible.
        try:
            os.link(item,dest)
        except OSError:
            shutil.copyfile(item,dest)
copy_tree(a.runtime,a.output/'runtime');copy_tree(a.frontend,a.output)
shutil.copyfile(a.catalogue,a.output/'catalogue.json')
(a.output/'names').mkdir(exist_ok=True)
shutil.copyfile(a.output/'index.html',a.output/'names/index.html')
copy_tree(Path(__file__).parent.parent/'next/notices',a.output/'runtime/notices')
(a.output/'_headers').write_text('''/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
/runtime/*
  Access-Control-Allow-Origin: *
  Cross-Origin-Resource-Policy: cross-origin
/runtime/assets/*
  Cache-Control: public, max-age=31536000, immutable
/runtime/chunks/*
  Cache-Control: public, max-age=31536000, immutable
/runtime/manifests/*
  Cache-Control: public, max-age=31536000, immutable
/runtime/photo/*
  Cache-Control: public, max-age=31536000, immutable
/runtime/encoder-stream/*
  Cache-Control: public, max-age=31536000, immutable
/runtime/manifest.json
  Cache-Control: no-cache
/runtime/qualification-manifest.json
  Cache-Control: no-cache
/catalogue.json
  Cache-Control: no-cache
''')
print('Independent static candidate staged:',a.output)
