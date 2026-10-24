"""model-conv CLI: `convert` and `verify`. Run inside the container (see docs/usage.md)."""
import argparse
import json
import sys
from pathlib import Path

WARNING = ('WARNING: a checkpoint is a Python pickle, and loading it runs code. Only convert a checkpoint you trust; '
           'model-conv also refuses any file whose SHA-256 is not the declared one.')


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog='model-conv', description=WARNING)
    sub = ap.add_subparsers(dest='command', required=True)
    c = sub.add_parser('convert', help='checkpoint -> chunks, manifests and report')
    c.add_argument('--model', default='stylegan2-ffhq-config-f')
    c.add_argument('--checkpoint', type=Path, required=True)
    c.add_argument('--out', type=Path, required=True)
    c.add_argument('--force', action='store_true', help='rebuild over a complete output')
    v = sub.add_parser('verify', help='output digests, then parity against the upstream reference')
    v.add_argument('--checkpoint', type=Path, required=True)
    v.add_argument('--out', type=Path, required=True)
    v.add_argument('--seeds', default='0,1,42')
    sub.add_parser('models', help='list the declared models')
    args = ap.parse_args(argv)

    if args.command == 'models':
        from .models import MODELS
        for m in MODELS.values():
            print(f'{m.key}: {m.architecture} {m.resolution}px, z {m.z_dim}, w {m.w_dim} x {m.num_ws}, source {m.source_format} {m.source_sha256}')
        return 0
    print(WARNING, file=sys.stderr)
    if args.command == 'convert':
        from .convert import convert
        from .models import declaration
        manifest = convert(declaration(args.model), args.checkpoint, args.out, force=args.force, log=lambda s: print(s, file=sys.stderr))
        print(json.dumps({'complete': str(args.out / 'manifest.json'), 'synthesis': manifest['synthesis']['sha256'], 'mapping': manifest['mapping']['sha256']}))
        return 0
    from .verify import verify
    report = verify(args.checkpoint, args.out, seeds=[int(s) for s in args.seeds.split(',')], log=lambda s: print(s, file=sys.stderr))
    (args.out / 'verify.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report.get(k) for k in ['passed', 'maxRawAbsError', 'maxRgbDifference', 'files']}))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
