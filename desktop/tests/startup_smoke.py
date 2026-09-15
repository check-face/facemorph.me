"""Launch the actual installed/extracted executable; require Elmish and IPC evidence."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, default=Path(__file__).resolve().parents[1] / 'src-tauri/target/debug/checkface-desktop')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='checkface launch space ') as folder:
        report = Path(folder) / 'smoke.json'
        env = {key: value for key, value in os.environ.items() if not key.startswith('CHECKFACE_NATIVE_')}
        env.update(CHECKFACE_DESKTOP_SMOKE='1', CHECKFACE_DESKTOP_SMOKE_REPORT=str(report))
        # File evidence works for Windows GUI-subsystem builds without stderr handles.
        with (Path(folder) / 'stderr.log').open('w') as errors:
            process = subprocess.Popen([str(args.binary.resolve())], cwd=folder, env=env,
                                       stdout=subprocess.DEVNULL, stderr=errors)
            evidence = None
            try:
                deadline = time.monotonic() + 45
                while time.monotonic() < deadline:
                    if report.exists():
                        try:
                            evidence = json.loads(report.read_text())
                            break
                        except json.JSONDecodeError:
                            pass
                    if process.poll() is not None:
                        break
                    time.sleep(.1)
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
        if evidence != {'rendered': True, 'missingRuntimeRejected': True}:
            raise RuntimeError(f'Packaged Elmish/IPC smoke failed: {evidence}; ' + (Path(folder) / 'stderr.log').read_text())
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps({'schemaVersion': 1, 'binary': str(args.binary),
                **evidence, 'inference': 'not tested', 'gpu': 'not tested'}, indent=2) + '\n')
        print('PASS: actual Elmish DOM, IPC missing-runtime rejection, unrelated working directory, bounded shutdown')

if __name__ == '__main__':
    main()
