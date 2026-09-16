"""Rebuild and run exact native/WASM preprocessing controls in the active venv."""
from pathlib import Path
import argparse,subprocess,sys
C=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--skip-build',action='store_true');a=p.parse_args()
commands=[] if a.skip_build else [[sys.executable,str(C/'build.py')]]
commands.extend([[sys.executable,str(C/'make-fixtures.py')],['node',str(C/'verify-native.mjs')]])
for command in commands:subprocess.run(command,check=True,cwd=C.parent)
