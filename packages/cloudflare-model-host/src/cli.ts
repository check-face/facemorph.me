#!/usr/bin/env node
// facemorph-model-host: stage, verify and publish model bytes (fm-3osh). One JSON report on stdout.
//   facemorph-model-host stage   --source <dir> --out <dir> --base <https url> [--from-base <url>] [--manifest <name>] [--dry-run]
//   facemorph-model-host verify  --root <dir> --base <https url> [--manifest <name>] [--plan workers-free|workers-paid]
//   facemorph-model-host publish --root <dir> --target <target.json> [--publish]
// publish is a dry run unless --publish is given. Exit 0 ok, 1 refused or findings, 2 usage error.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { Plan } from './limits.ts';
import { publishRoot, type Target } from './publish.ts';
import { stage, StageError } from './stage.ts';
import { verifyRoot } from './verify.ts';

const USAGE =
  'usage: facemorph-model-host <stage|verify|publish> [options] (see the package README)';

export function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...rest],
      options: {
        source: { type: 'string' },
        out: { type: 'string' },
        base: { type: 'string' },
        'from-base': { type: 'string' },
        manifest: { type: 'string' },
        'dry-run': { type: 'boolean' },
        root: { type: 'string' },
        plan: { type: 'string' },
        target: { type: 'string' },
        publish: { type: 'boolean' },
      },
      strict: true,
    }));
  } catch (e) {
    console.error(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const need = (...names: string[]): boolean => {
    const missing = names.filter((n) => typeof values[n] !== 'string');
    if (missing.length)
      console.error(`missing ${missing.map((n) => `--${n}`).join(', ')}\n${USAGE}`);
    return missing.length === 0;
  };
  const str = (n: string): string | undefined =>
    typeof values[n] === 'string' ? (values[n] as string) : undefined;
  const print = (v: unknown) => console.log(JSON.stringify(v));
  try {
    if (command === 'stage') {
      if (!need('source', 'out', 'base')) return 2;
      const fromBase = str('from-base');
      const manifest = str('manifest');
      const r = stage({
        source: str('source')!,
        out: str('out')!,
        base: str('base')!,
        ...(fromBase ? { fromBase } : {}),
        ...(manifest ? { manifest } : {}),
        dryRun: values['dry-run'] === true,
      });
      print({
        staged: !values['dry-run'],
        assets: r.assets,
        chunked: r.chunked,
        files: r.files.length,
        bytes: r.files.reduce((n, f) => n + f.bytes, 0),
      });
      return 0;
    }
    if (command === 'verify') {
      if (!need('root', 'base')) return 2;
      const plan = (str('plan') ?? 'workers-free') as Plan;
      if (plan !== 'workers-free' && plan !== 'workers-paid') return (console.error(USAGE), 2);
      const manifest = str('manifest');
      const r = verifyRoot({
        root: str('root')!,
        base: str('base')!,
        plan,
        ...(manifest ? { manifest } : {}),
      });
      print(r);
      return r.ok ? 0 : 1;
    }
    if (command === 'publish') {
      if (!need('root', 'target')) return 2;
      const target = JSON.parse(readFileSync(str('target')!, 'utf8')) as Target;
      const r = publishRoot(str('root')!, target, { publish: values.publish === true });
      print({ ...r, writes: r.writes.length });
      return r.refused ? 1 : 0;
    }
  } catch (e) {
    if (e instanceof StageError) {
      print({ error: e.code, message: e.message });
      return 1;
    }
    throw e;
  }
  console.error(USAGE);
  return 2;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
