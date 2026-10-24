// The parity harness runner (fm-q007): runs the frozen parity spec (test/parity/flow-matrix.spec.ts) against a subject
// served under the production origin with the same runtime bytes as the control, records the subject's goldens beside
// the run (never into the committed control goldens), and grades them against the control's with
// scripts/verify/parity-grade.mjs: parity rows exactly, changed/new rows owner-graded.
//
//   node --experimental-strip-types apps/web/test/harness/run.ts --subject <deploy-next-shaped dir> --name <name> \
//     --source <subject source identity> [--rows first-visit,seed.generate] [--out <dir>]
//   node --experimental-strip-types apps/web/test/harness/run.ts --self-test [--rows first-visit] [--out <dir>]
//
// --self-test serves the verified control itself as the subject (it must pass), then a copy of it with one label
// changed in its bundle ('Morph from' -> 'Morph form'; it must fail on the row that shows that label). Run under the
// machine's device lease; it synthesizes on the CPU:
//   python3 autoresearch/run.py --lane browser-cpu --device eris --wait 900 --timeout 3600 -- \
//     node --experimental-strip-types apps/web/test/harness/run.ts --self-test
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { REPO } from '../parity/control-server.ts';

interface Args {
  subject?: string;
  name?: string;
  source?: string;
  rows?: string;
  out: string;
  selfTest: boolean;
}

export interface Graded {
  readonly name: string;
  readonly playwrightExit: number;
  readonly gradeExit: number;
  readonly summary: { passed: number; failed: number; ownerGraded: number; untested: number };
  readonly results: readonly { rowId: string; project: string; verdict: string }[];
}

function parse(argv: string[]): Args {
  const a: Args = { out: join(REPO, 'test-results/parity-harness'), selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--self-test') a.selfTest = true;
    else if (k?.startsWith('--'))
      (a as unknown as Record<string, string | undefined>)[k.slice(2)] = argv[++i];
  }
  return a;
}

const grepFor = (rows: string | undefined) =>
  rows
    ? rows
        .split(',')
        .map((r) => `${r.replace(/[.]/g, '\\.')}$`)
        .join('|')
    : null;

/** Records the subject's goldens with the parity spec, then grades them against the control's. */
export function runSubject({
  subject,
  name,
  source,
  rows,
  out,
}: {
  subject: string;
  name: string;
  source: string;
  rows?: string;
  out: string;
}): Graded {
  const goldens = join(out, 'goldens');
  rmSync(join(goldens, name), { recursive: true, force: true });
  mkdirSync(goldens, { recursive: true });
  const grep = grepFor(rows);
  const pw = spawnSync(
    'npx',
    [
      '--prefix',
      'apps/web',
      'playwright',
      'test',
      '-c',
      'apps/web/test/parity/playwright.config.ts',
      '--output',
      join(out, `pw-${name}`),
      ...(grep ? ['--grep', grep] : []),
    ],
    {
      cwd: REPO,
      stdio: 'inherit',
      env: {
        ...process.env,
        RECORD: '1',
        PARITY_SUBJECT: resolve(subject),
        PARITY_SUBJECT_SOURCE: source,
        PARITY_SUBJECT_NAME: name,
        PARITY_GOLDENS_DIR: goldens,
      },
    },
  );
  const gradeFile = join(out, `grade-${name}.json`);
  const g = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      join(REPO, 'scripts/verify/parity-grade.mjs'),
      '--subject',
      join(goldens, name),
      '--out',
      gradeFile,
      ...(rows ? ['--rows', rows] : []),
    ],
    { cwd: REPO, encoding: 'utf8' },
  );
  const graded = JSON.parse(readFileSync(gradeFile, 'utf8')) as {
    summary: Graded['summary'];
    results: Graded['results'];
  };
  return {
    name,
    playwrightExit: pw.status ?? -1,
    gradeExit: g.status ?? -1,
    summary: graded.summary,
    results: graded.results,
  };
}

/** A copy of the served control with one visible label changed in its app bundle. */
export function plantedCopy(into: string): { dir: string; file: string } {
  const dir = join(into, 'planted-deploy-next');
  rmSync(dir, { recursive: true, force: true });
  cpSync(join(REPO, 'deploy-next'), dir, { recursive: true });
  const bundles = readdirSync(dir).filter((f) => /^app\.[0-9a-f]+\.js$/.test(f));
  for (const f of bundles) {
    const text = readFileSync(join(dir, f), 'utf8');
    if (text.includes('Morph from')) {
      writeFileSync(join(dir, f), text.replaceAll('Morph from', 'Morph form'));
      return { dir, file: f };
    }
  }
  throw new Error('no app bundle carries the label the self-test plants into');
}

function main() {
  const a = parse(process.argv.slice(2));
  mkdirSync(a.out, { recursive: true });
  if (!a.selfTest) {
    if (!a.subject || !a.name || !a.source)
      throw new Error('--subject, --name and --source are required (or --self-test)');
    const r = runSubject({
      subject: a.subject,
      name: a.name,
      source: a.source,
      out: a.out,
      ...(a.rows ? { rows: a.rows } : {}),
    });
    console.log(JSON.stringify({ subject: r.name, summary: r.summary }));
    process.exit(r.summary.failed || r.gradeExit !== 0 ? 1 : 0);
  }
  const rows = a.rows ?? 'first-visit';
  const controlSource = readFileSync(join(REPO, 'next-site-source.txt'), 'utf8').trim();
  const same = runSubject({
    subject: join(REPO, 'deploy-next'),
    name: 'control-as-subject',
    source: controlSource,
    rows,
    out: a.out,
  });
  const scratch = mkdtempSync(join(tmpdir(), 'parity-harness-'));
  const planted = plantedCopy(scratch);
  const changed = runSubject({
    subject: planted.dir,
    name: 'planted',
    source: `${controlSource}+planted`,
    rows,
    out: a.out,
  });
  rmSync(scratch, { recursive: true, force: true });
  const plantedFailedRows = changed.results
    .filter((r) => r.verdict === 'failed')
    .map((r) => `${r.rowId}/${r.project}`);
  const report = {
    selfTest: {
      controlVsControl: {
        passed: same.summary.failed === 0 && same.summary.passed > 0,
        summary: same.summary,
      },
      plantedDifference: {
        bundle: planted.file,
        change: "'Morph from' -> 'Morph form'",
        failed: plantedFailedRows,
        passed: plantedFailedRows.length > 0 && changed.summary.passed + changed.summary.failed > 0,
      },
    },
    rows,
  };
  writeFileSync(join(a.out, 'self-test.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify(report));
  process.exit(
    report.selfTest.controlVsControl.passed && report.selfTest.plantedDifference.passed ? 0 : 1,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
  main();
