"""Run the local CPU encoder diagnostic; defaults to the upload page on port 7863."""
from pathlib import Path
import os
import sys

repo = Path(__file__).resolve().parents[1]
backend = repo / 'experiment/hf'
candidates = [backend / '.venv/bin/python', repo.parent / 'hf-trial/.venv/bin/python']
python = next((p for p in candidates if p.is_file()), None)
if python is None:
    raise SystemExit('Prepare the local Python environment described in HF_TRIAL.md.')
args = sys.argv[1:] or ['--serve']
os.execv(str(python), [str(python), '-u', str(backend / 'e4e_cpu.py'), *args])
