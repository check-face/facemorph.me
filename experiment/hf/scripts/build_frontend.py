"""Build the existing Facemorph checkout; never substitute a generated UI."""
from pathlib import Path
import os
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
source = root.parents[1]
subprocess.run(['npm', 'run', 'build'], cwd=source,
               env={**os.environ, 'FACEMORPH_TRIAL': '1', 'FACEMORPH_REVIEW': os.getenv('FACEMORPH_REVIEW', '0')}, check=True)
target = root / 'frontend'
target.mkdir(exist_ok=True)
for entry in (source / 'deploy').iterdir():
    if entry.name in ('api', 'package.json', 'vercel.json'):
        continue
    destination = target / entry.name
    if entry.is_dir():
        shutil.copytree(entry, destination, dirs_exist_ok=True)
    else:
        shutil.copy2(entry, destination)
index = target / 'index.html'
html = index.read_text()
# A local co-maintainer review should not emit production analytics.
if os.getenv('FACEMORPH_REVIEW') == '1':
    import re
    html = re.sub(r'<script[^>]*src="https://www.googletagmanager.com[^>]*></script>', '', html)
    html = re.sub(r"gtag\('config', 'UA-140064290-2'\);", '', html)
# Webpack emits root-relative bundle paths; the same-origin Gradio API owns
# other root routes. Keep static frontend files under their own mount.
import re
html = re.sub(r'(src|href)="/?((?:app|vendors|runtime|style)\.[^"]+)"', r'\1="/assets/\2"', html)
html = re.sub(r'(href)="/((?:favicon[^"/]*|apple-touch-icon.png|site.webmanifest))"', r'\1="/assets/\2"', html)
index.write_text(html)
print('Built original Facemorph frontend:', target)

import json
(target / 'build-mode.json').write_text(json.dumps({'trial': True, 'review': os.getenv('FACEMORPH_REVIEW') == '1'}, indent=2)+'\n')
