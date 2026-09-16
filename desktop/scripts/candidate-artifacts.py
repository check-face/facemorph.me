"""Collect unsigned packages and prove the downloadable inventory matches their bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify(folder):
    inventory = json.loads((folder / 'candidate.json').read_text())
    expected = {entry['path'] for entry in inventory['files']}
    actual = {p.name for p in folder.iterdir() if p.is_file()} - {'candidate.json', 'SHA256SUMS', 'startup.json'}
    if expected != actual or not expected:
        raise ValueError('Artifact set differs from inventory')
    for entry in inventory['files']:
        name = entry['path']
        if Path(name).name != name or '/' in name or '\\' in name:
            raise ValueError('Invalid artifact path')
        path = folder / name
        if path.is_symlink() or path.stat().st_size != entry['bytes'] or digest(path) != entry['sha256']:
            raise ValueError('Artifact integrity failed')
    sums = ''.join(f"{entry['sha256']}  {entry['path']}\n" for entry in inventory['files'])
    if (folder / 'SHA256SUMS').read_text() != sums:
        raise ValueError('Checksum inventory mismatch')


def collect(bundle, output, platform, revision, native_runtime_inventory=None):
    output.mkdir(parents=True, exist_ok=True)
    extension = {'windows': '.exe', 'linux': '.deb', 'macos': '.app'}[platform]
    packages = sorted(bundle.rglob('*' + extension))
    if platform == 'linux':
        packages += sorted(bundle.rglob('*.AppImage'))
    if not packages:
        raise ValueError('No expected platform package produced')
    files = []
    for source in packages:
        if source.is_dir():
            # ZIP preserves app permissions/symlinks using ditto on macOS.
            import subprocess
            target = output / (source.name + '.zip')
            subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(source), str(target)], check=True)
        else:
            target = output / source.name
            shutil.copy2(source, target)
        files.append({'path': target.name, 'bytes': target.stat().st_size, 'sha256': digest(target)})
    (output / 'candidate.json').write_text(json.dumps({'schemaVersion': 1, 'platform': platform,
        'sourceRevision': revision, 'signed': False, 'qualification': 'packaging-only',
        'nativeRuntimeBundled': native_runtime_inventory is not None,
        'nativeRuntimeInventorySha256': digest(native_runtime_inventory) if native_runtime_inventory else None,
        'modelsBundled': False, 'files': files}, indent=2) + '\n')
    (output / 'SHA256SUMS').write_text(''.join(f"{e['sha256']}  {e['path']}\n" for e in files))
    verify(output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--platform', choices=['windows', 'linux', 'macos'])
    parser.add_argument('--revision', default='local-uncommitted')
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--native-runtime-inventory', type=Path)
    args = parser.parse_args()
    if args.verify:
        verify(args.output)
    else:
        collect(args.bundle, args.output, args.platform, args.revision, args.native_runtime_inventory)
