// Manual negative gate: synthetic commits stay in an isolated object database, never on a branch or PR.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { parse, stringify } from 'yaml';
import type { DependencyPolicy } from './dependency-freeze.ts';

export interface PolicyProbeOptions {
  readonly case: 'tolerance' | 'cell';
  readonly out: string;
}
interface CommandResult {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const POLICY = 'scripts/ci/dependency-policy.json';
const CHECKERS = [
  'scripts/ci/dependency-freeze.ts',
  'scripts/ci/check-dependency-currency.ts',
  'scripts/ci/dependency-currency.ts',
  'scripts/ci/ort-mirror.ts',
  'scripts/ci/serial-ort.ts',
  'scripts/ci/package.json',
  'package.json',
];
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
function requireProof(condition: unknown, text: string): asserts condition {
  if (!condition) throw new Error(text);
}

export function parsePolicyProbeArgs(args: readonly string[]): PolicyProbeOptions {
  const { values } = parseArgs({
    args: [...args],
    options: { case: { type: 'string' }, out: { type: 'string' } },
  });
  if (values.case !== 'tolerance' && values.case !== 'cell')
    throw new Error('--case must be tolerance or cell');
  if (!values.out?.trim()) throw new Error('--out must name a new evidence directory');
  return { case: values.case, out: values.out };
}

/** Returns the original rejected freeze gate's exit status (1), never a green inversion of that gate. */
export function runDependencyPolicyProbe(
  options: PolicyProbeOptions,
  sourceRepo = process.cwd(),
): number {
  const out = resolve(options.out);
  mkdirSync(out); // Refuse to overwrite an existing evidence directory.
  const commands: CommandResult[] = [];
  const scratch = mkdtempSync(join(tmpdir(), 'facemorph-policy-probe-'));
  const repo = join(scratch, 'repo');
  const index = join(scratch, 'private-index');
  const metadata: Record<string, unknown> = {
    schema: 'facemorph.dependency-policy-probe/1',
    case: options.case,
    group: 'build-tools',
    sourceRepo: resolve(sourceRepo),
    noPlanRevision: true,
  };
  const save = (path: string, value: unknown) =>
    writeFileSync(
      join(out, path),
      typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n',
    );
  const run = (
    command: string[],
    cwd: string,
    input?: string,
    privateGit = false,
  ): CommandResult => {
    const result = spawnSync(command[0]!, command.slice(1), {
      cwd,
      encoding: 'utf8',
      input,
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        ...(privateGit
          ? {
              GIT_INDEX_FILE: index,
              GIT_AUTHOR_NAME: 'FaceMorph policy probe',
              GIT_AUTHOR_EMAIL: 'policy-probe@example.invalid',
              GIT_COMMITTER_NAME: 'FaceMorph policy probe',
              GIT_COMMITTER_EMAIL: 'policy-probe@example.invalid',
            }
          : {}),
      },
    });
    const entry = {
      command,
      cwd,
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
    commands.push(entry);
    if (result.error) throw result.error;
    return entry;
  };
  const checked = (result: CommandResult) => {
    requireProof(
      result.status === 0,
      `Command failed: ${result.command.join(' ')}: ${result.stderr}`,
    );
    return result.stdout.trim();
  };
  const sourceGit = (args: string[]) =>
    checked(run(['git', '-C', resolve(sourceRepo), ...args], resolve(sourceRepo)));
  const git = (args: string[], input?: string) =>
    checked(run(['git', '-c', 'core.hooksPath=/dev/null', ...args], repo, input, true));
  const recordGate = (name: string, script: string, args: string[]) => {
    const result = run([process.execPath, join(repo, script), ...args], repo);
    save(`${name}.command.json`, { command: result.command, cwd: repo, status: result.status });
    save(`${name}.stdout.jsonl`, result.stdout);
    save(`${name}.stderr.txt`, result.stderr);
    return {
      result,
      report: JSON.parse(result.stdout) as {
        problems?: string[];
        violations?: { code: string; path: string; message: string }[];
      },
    };
  };
  try {
    requireProof(options.case === 'tolerance' || options.case === 'cell', 'Unknown probe case');
    const base = sourceGit(['rev-parse', '--verify', 'HEAD']);
    requireProof(
      /^[a-f0-9]{40}$/.test(base),
      'Committed checkout must identify an immutable commit',
    );
    metadata.base = base;
    metadata.baseline = 'immutable checked-out HEAD; manual workflow restricts execution to main';
    const objects = resolve(sourceRepo, sourceGit(['rev-parse', '--git-path', 'objects']));
    mkdirSync(repo);
    checked(run(['git', 'init', '--quiet', repo], scratch));
    writeFileSync(join(repo, '.git/objects/info/alternates'), objects + '\n');
    const refsBefore = git(['for-each-ref', '--format=%(refname) %(objectname)']);
    const read = (revision: string, path: string) => git(['show', `${revision}:${path}`]);
    const checkerHashes: Record<string, string> = {};
    for (const path of CHECKERS) {
      const bytes = read(base, path);
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      // git show's trimmed output is restored from the untrimmed recorded command, preserving exact bytes.
      const exact = commands.at(-1)!.stdout;
      writeFileSync(join(repo, path), exact);
      checkerHashes[path] = hash(exact);
      requireProof(Boolean(bytes), `Missing committed checker dependency ${path}`);
    }
    mkdirSync(join(repo, 'node_modules'));
    const yamlPackage = dirname(fileURLToPath(import.meta.resolve('yaml/package.json')));
    symlinkSync(yamlPackage, join(repo, 'node_modules/yaml'), 'dir');
    metadata.checkers = {
      revision: base,
      sha256: checkerHashes,
      node: process.version,
      yaml: JSON.parse(readFileSync(join(yamlPackage, 'package.json'), 'utf8')).version,
    };
    const policy = JSON.parse(read(base, POLICY)) as DependencyPolicy;
    // A historical decision cannot authorize these comparisons: policy and PLAN stay unchanged.
    const manifest = JSON.parse(read(base, 'package.json'));
    const lock = JSON.parse(read(base, 'package-lock.json'));
    const before = manifest.devDependencies.oxfmt as string;
    const match = /^\^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(before);
    requireProof(
      match && lock.packages[''].devDependencies.oxfmt === before,
      'Expected a paired stable oxfmt caret declaration in manifest and root lock entry',
    );
    requireProof(
      policy.groups['build-tools']?.patterns.includes('*') &&
        !policy.groups['build-tools'].excludePatterns?.includes('oxfmt'),
      'oxfmt must belong to the frozen build-tools group',
    );
    const after = `^${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
    manifest.devDependencies.oxfmt = after;
    lock.packages[''].devDependencies.oxfmt = after;
    metadata.bump = {
      package: 'oxfmt',
      before,
      after,
      synthetic: true,
      scope:
        'paired manifest and lock root declaration; no registry release or installed-resolution claim',
    };
    git(['read-tree', base]);
    const edit = (path: string, bytes: string) => {
      const blob = git(['hash-object', '-w', '--stdin'], bytes);
      git(['update-index', '--add', '--cacheinfo', '100644', blob, path]);
    };
    edit('package.json', JSON.stringify(manifest, null, 2) + '\n');
    edit('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
    const controlTree = git(['write-tree']);
    const control = git([
      'commit-tree',
      controlTree,
      '-p',
      base,
      '-m',
      'synthetic grouped build-tools declaration bump (fm-r4a probe)',
    ]);
    let path: string;
    let expectedDiagnostic: string;
    if (options.case === 'tolerance') {
      path = Object.keys(policy.toleranceFiles).find((path) => path.endsWith('/numerics.ts')) ?? '';
      requireProof(path, 'No frozen numerical tolerance file');
      const source = read(base, path);
      requireProof(
        source.split('maxAbsError: 0.0001,').length === 2,
        'Expected exactly one frozen e4e latent tolerance',
      );
      edit(path, source.replace('maxAbsError: 0.0001,', 'maxAbsError: 0.001,') + '\n');
      expectedDiagnostic = `${path}: frozen numerical tolerance digest changed`;
      metadata.mutation = { path, before: 0.0001, after: 0.001, constant: 'maxAbsError' };
    } else {
      const selection = Object.entries(policy.requiredMatrices).flatMap(([path, jobs]) =>
        Object.entries(jobs).flatMap(([job, axes]) =>
          Object.entries(axes)
            .filter(([, cells]) => Array.isArray(cells) && cells.length > 0)
            .map(([axis, cells]) => ({ path, job, axis, cell: (cells as unknown[])[0] })),
        ),
      )[0];
      requireProof(selection, 'No frozen retained matrix cell');
      path = selection.path;
      const workflow = parse(read(base, path));
      const cells = workflow.jobs[selection.job].strategy.matrix[selection.axis] as unknown[];
      const found = cells.findIndex((cell) => isDeepStrictEqual(cell, selection.cell));
      requireProof(found >= 0, 'The retained cell is absent before mutation');
      cells.splice(found, 1);
      edit(path, stringify(workflow));
      expectedDiagnostic = `${path}: required cell ${selection.job}.${selection.axis} removed: ${JSON.stringify(selection.cell)}`;
      metadata.mutation = selection;
    }
    const candidateTree = git(['write-tree']);
    const candidate = git([
      'commit-tree',
      candidateTree,
      '-p',
      control,
      '-m',
      `synthetic prohibited ${options.case} mutation (fm-r4a probe)`,
    ]);
    Object.assign(metadata, {
      control,
      candidate,
      trees: {
        base: git(['rev-parse', `${base}^{tree}`]),
        control: controlTree,
        candidate: candidateTree,
      },
      expectedDiagnostic,
    });
    save('control.patch', git(['diff', '--binary', base, control]) + '\n');
    save('candidate.patch', git(['diff', '--binary', control, candidate]) + '\n');
    for (const [name, sha] of Object.entries({ base, control, candidate }))
      save(`${name}.commit.txt`, git(['cat-file', '-p', sha]) + '\n');
    requireProof(
      read(base, POLICY) === read(candidate, POLICY) &&
        read(base, 'PLAN.md') === read(candidate, 'PLAN.md'),
      'Probe must not revise policy or PLAN.md',
    );
    const controlFreeze = recordGate('control-freeze', 'scripts/ci/dependency-freeze.ts', [
      base,
      control,
    ]);
    requireProof(
      controlFreeze.result.status === 0 && controlFreeze.report.problems?.length === 0,
      'Clean grouped control must pass the exact committed freeze CLI',
    );
    const baseline = recordGate('control-currency', 'scripts/ci/check-dependency-currency.ts', [
      '--base',
      base,
      '--head',
      control,
      '--group',
      'build-tools',
    ]);
    const candidateFreeze = recordGate('candidate-freeze', 'scripts/ci/dependency-freeze.ts', [
      base,
      candidate,
    ]);
    requireProof(
      candidateFreeze.result.status === 1 &&
        candidateFreeze.report.problems?.includes(expectedDiagnostic),
      'Tampered freeze CLI must reject the exact target diagnostic with exit 1',
    );
    const strict = recordGate('candidate-currency', 'scripts/ci/check-dependency-currency.ts', [
      '--base',
      base,
      '--head',
      candidate,
      '--group',
      'build-tools',
    ]);
    // Keep the original gate diagnostic visible in CI, while stdout remains a single summary JSON.
    process.stderr.write(strict.result.stdout);
    process.stderr.write(strict.result.stderr);
    const target = (entry: { code: string; message: string }) =>
      entry.code === 'frozen-policy' && entry.message === expectedDiagnostic;
    requireProof(
      (baseline.result.status === 0 || baseline.result.status === 1) &&
        Array.isArray(baseline.report.violations) &&
        !baseline.report.violations.some(target),
      'Baseline strict report already contains the target failure or is malformed',
    );
    requireProof(
      strict.result.status === 1 && strict.report.violations?.some(target),
      'Strict CLI must add the NEW exact frozen-policy target beyond baseline failures',
    );
    const refsAfter = git(['for-each-ref', '--format=%(refname) %(objectname)']);
    requireProof(
      refsBefore === '' && refsAfter === refsBefore && git(['remote', '-v']) === '',
      'No synthetic ref or remote may exist',
    );
    metadata.publication = {
      refsBefore,
      refsAfter,
      refsPublished: 0,
      mergeAttempts: 0,
      sharedWrites: 0,
      isolatedIndex: true,
    };
    metadata.status = 'verified-rejection';
    metadata.exitCode = candidateFreeze.result.status;
    metadata.baselineViolations = baseline.report.violations;
    metadata.newFrozenViolation = strict.report.violations!.find(target);
    save('report.json', metadata);
    console.log(
      JSON.stringify({
        schema: metadata.schema,
        status: metadata.status,
        case: options.case,
        base,
        control,
        candidate,
        expectedDiagnostic,
        out,
        exitCode: candidateFreeze.result.status,
      }),
    );
    return candidateFreeze.result.status;
  } catch (error) {
    Object.assign(metadata, { status: 'verification-error', exitCode: 2, error: errorText(error) });
    save('report.json', metadata);
    console.log(
      JSON.stringify({
        schema: metadata.schema,
        status: metadata.status,
        out,
        error: metadata.error,
        exitCode: 2,
      }),
    );
    return 2;
  } finally {
    save('commands.json', commands);
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runDependencyPolicyProbe(parsePolicyProbeArgs(process.argv.slice(2)));
  } catch (error) {
    console.log(
      JSON.stringify({
        schema: 'facemorph.dependency-policy-probe/1',
        status: 'verification-error',
        error: errorText(error),
        exitCode: 2,
      }),
    );
    process.exitCode = 2;
  }
}
