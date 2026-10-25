#!/usr/bin/env python3
"""Stage checked static-name results with the shared, API-free publisher.

Generate missing results with tools/names-generator/generate.mjs first. No inference
or preview download is performed here; publishing requires an explicit --publish.
"""
import argparse
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--generated', type=Path, required=True,
                        help='Checked names-generator output (manifest.jsonl and results)')
    parser.add_argument('--legacy', type=Path, required=True,
                        help='Verified static snapshot host directory containing catalogue.json')
    parser.add_argument('--origin', required=True, help='HTTPS static publication origin')
    parser.add_argument('--output', type=Path, required=True, help='Staged output directory')
    parser.add_argument('--previous', type=Path, help='Local retained publication cache')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Validate and stage without running cf')
    mode.add_argument('--publish', action='store_true', help='Deploy and verify; default is cf dry-run')
    args = parser.parse_args()
    command = ['node', str(ROOT / 'scripts/names-publish/publish.mjs'),
               '--generated=' + str(args.generated.resolve()),
               '--legacy=' + str(args.legacy.resolve()),
               '--origin=' + args.origin, '--out=' + str(args.output.resolve())]
    if args.previous:
        command.append('--previous=' + str(args.previous.resolve()))
    if args.check:
        command.append('--check')
    if args.publish:
        command.append('--publish')
    return subprocess.run(command, cwd=ROOT, check=False).returncode


if __name__ == '__main__':
    raise SystemExit(main())
