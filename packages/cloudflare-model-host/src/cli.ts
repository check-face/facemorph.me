#!/usr/bin/env node
// facemorph-model-host: stage, verify and publish model bytes (fm-3osh). One JSON report on stdout.
//   facemorph-model-host stage   --source <dir> --out <dir> --base <https url> [--from-base <url>] [--manifest <name>] [--dry-run]
//   facemorph-model-host verify  --root <dir> --base <https url> [--manifest <name>] [--plan workers-free|workers-paid]
//   facemorph-model-host publish --root <dir> --target <target.json> [--publish]
//   facemorph-model-host warm    --root <dir> --origin <mirror url> --prefixes <list> [--publish]
//   facemorph-model-host mirror-deploy --worker <name> --bucket <r2 bucket> --upstream <url> --prefixes <list>
//                                      [--site <worker>] [--domain <host>] [--workers-dev] [--compatibility-date <date>]
//                                      [--publish]
//   facemorph-model-host origin-deploy --root <dir> --worker <name> --base-path <path> --immutable <list>
//                                      --mutable <list> [--workers-dev] [--domain <host>] [--terms <record>]
//                                      [--acknowledge <terms row>] [--publish]
// publish, warm and mirror-deploy write nothing unless --publish is given (warm's HEAD makes the mirror copy a file;
// mirror-deploy runs cf deploy --dry-run). Exit 0 ok, 1 refused, findings or failures, 2 usage error.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { Plan } from './limits.ts';
import { deployMirror } from './mirror/deploy.ts';
import { deployModelOrigin } from './origin-deploy.ts';
import { warm } from './mirror/warm.ts';
import { publishRoot, type Target } from './publish.ts';
import { qualifyOrigin } from './qualify.ts';
import { stage, StageError } from './stage.ts';
import { verifyRoot } from './verify.ts';

const USAGE =
  'usage: facemorph-model-host <stage|verify|qualify-origin|publish|warm|mirror-deploy|origin-deploy> [options] (see the package README)';

export async function main(argv: readonly string[]): Promise<number> {
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
        reference: { type: 'string' },
        'dry-run': { type: 'boolean' },
        root: { type: 'string' },
        plan: { type: 'string' },
        target: { type: 'string' },
        publish: { type: 'boolean' },
        origin: { type: 'string' },
        prefixes: { type: 'string' },
        worker: { type: 'string' },
        bucket: { type: 'string' },
        upstream: { type: 'string' },
        site: { type: 'string' },
        domain: { type: 'string' },
        'compatibility-date': { type: 'string' },
        'base-path': { type: 'string' },
        immutable: { type: 'string' },
        mutable: { type: 'string' },
        'workers-dev': { type: 'boolean' },
        terms: { type: 'string' },
        acknowledge: { type: 'string' },
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
    if (command === 'qualify-origin') {
      if (!need('root', 'origin', 'immutable', 'mutable')) return 2;
      const basePath = str('base-path');
      const reference = str('reference');
      const report = await qualifyOrigin({
        root: str('root')!,
        origin: str('origin')!,
        immutable: str('immutable')!.split(',').filter(Boolean),
        mutable: str('mutable')!.split(',').filter(Boolean),
        ...(basePath ? { basePath } : {}),
        ...(reference ? { reference: JSON.parse(readFileSync(reference, 'utf8')) as unknown } : {}),
      });
      print(report);
      return report.ok ? 0 : 1;
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
    if (command === 'warm') {
      if (!need('root', 'origin', 'prefixes')) return 2;
      const r = await warm({
        root: str('root')!,
        origin: str('origin')!,
        prefixes: str('prefixes')!,
        publish: values.publish === true,
      });
      print(r);
      return r.failed.length ? 1 : 0;
    }
    if (command === 'origin-deploy') {
      if (!need('root', 'worker', 'base-path', 'immutable', 'mutable')) return 2;
      const list = (n: string) =>
        str(n)!
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
      const domain = str('domain');
      const date = str('compatibility-date');
      const terms = str('terms');
      const acknowledged = str('acknowledge');
      const r = deployModelOrigin(
        str('root')!,
        {
          worker: str('worker')!,
          basePath: str('base-path')!,
          immutable: list('immutable'),
          mutable: list('mutable'),
          workersDev: values['workers-dev'] === true,
          ...(domain ? { domain } : {}),
          ...(date ? { compatibilityDate: date } : {}),
          ...(terms ? { terms: { record: terms, ...(acknowledged ? { acknowledged } : {}) } } : {}),
        },
        { publish: values.publish === true },
      );
      console.error(r.output);
      print({ published: r.published, status: r.status, refused: r.refused });
      return r.status === 0 && !r.refused ? 0 : 1;
    }
    if (command === 'mirror-deploy') {
      if (!need('worker', 'bucket', 'upstream', 'prefixes')) return 2;
      const site = str('site');
      const domain = str('domain');
      const date = str('compatibility-date');
      const r = deployMirror(
        {
          worker: str('worker')!,
          bucket: str('bucket')!,
          upstream: str('upstream')!,
          prefixes: str('prefixes')!,
          ...(site ? { site } : {}),
          ...(domain ? { domain } : {}),
          ...(date ? { compatibilityDate: date } : {}),
          workersDev: values['workers-dev'] === true,
        },
        { publish: values.publish === true },
      );
      console.error(r.output);
      print({ published: r.published, status: r.status });
      return r.status === 0 ? 0 : 1;
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

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
