"""Run inside the shared device lease. No install, publication or release keys."""
from pathlib import Path
import subprocess
import sys

desktop = Path(__file__).resolve().parents[1]
workspace = desktop.parents[1]
commands = [
    ['node', str(desktop/'scripts/stage-frontend.mjs')],
    ['node', '--test', str(desktop/'tests/packaging.test.mjs')],
    ['cargo', 'test', '--offline', '--manifest-path', str(desktop/'src-tauri/Cargo.toml')],
    ['cargo', 'build', '--offline', '--manifest-path', str(desktop/'src-tauri/Cargo.toml')],
    [sys.executable, str(desktop/'native/prepare_bundle.py')],
    [str(workspace/'hf-trial/.venv/bin/python'), str(desktop/'tests/native_integration.py')],
]
for command in commands:
    print('RUN', ' '.join(command), flush=True)
    subprocess.run(command, check=True)
