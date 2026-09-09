"""Build and serve the existing Facemorph app locally; performs no deployment."""
from pathlib import Path
import os
import subprocess
import sys

repo = Path(__file__).resolve().parents[1]
backend = repo / 'experiment/hf'
candidates = [backend / '.venv/bin/python', repo.parent / 'hf-trial/.venv/bin/python']
python = next((p for p in candidates if p.is_file()), None)
if python is None:
    raise SystemExit('Create experiment/hf/.venv and install experiment/hf/requirements.txt. See HF_TRIAL.md.')
env = {**os.environ, 'FACEMORPH_TRIAL': '1', 'FACEMORPH_REVIEW': '1',
       'FACEMORPH_LOCAL_DEMO': '1', 'TRIAL_BUCKET': '', 'TRIAL_STORAGE_TOKEN': '',
       'PORT': os.getenv('PORT', '7862')}
for name in ['SPACE_ID', 'SPACES_ZERO_GPU']:
    env.pop(name, None)
if '--no-build' not in sys.argv:
    subprocess.run([str(python), str(backend / 'scripts/build_frontend.py')], cwd=repo, env=env, check=True)
print('Local review: http://127.0.0.1:' + env['PORT'] + '/classic?from_seed=42&to_seed=5', flush=True)
os.chdir(backend)
os.execve(str(python), [str(python), '-u', 'app.py'], env)
