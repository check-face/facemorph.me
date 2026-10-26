import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./dependency-policy-probe.ts', import.meta.url));
const repo = fileURLToPath(new URL('../..', import.meta.url));
const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

for (const probeCase of ['tolerance', 'cell']) {
  test(`actual ${probeCase} probe preserves the exact red gate and adds a specific new frozen failure`, () => {
    const root = mkdtempSync(join(tmpdir(), `fm-r4a-probe-${probeCase}-`));
    const out = join(root, 'evidence');
    // Model actions/checkout on a PR: an immutable detached HEAD with no local main ref.
    const source = join(root, 'source');
    git(root, 'init', '--quiet', source);
    const originalHead = git(repo, 'rev-parse', '--verify', 'HEAD');
    writeFileSync(
      join(source, '.git/objects/info/alternates'),
      resolve(repo, git(repo, 'rev-parse', '--git-path', 'objects')) + '\n',
    );
    git(source, 'update-ref', '--no-deref', 'HEAD', originalHead);
    assert.equal(git(source, 'for-each-ref', '--format=%(refname)'), '');
    const result = spawnSync(process.execPath, [cli, '--case', probeCase, '--out', out], {
      cwd: source,
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    assert.equal(report.status, 'verified-rejection');
    assert.equal(report.exitCode, 1);
    assert.equal(report.base, originalHead);
    assert.equal(git(source, 'rev-parse', 'HEAD'), originalHead);
    assert.equal(git(source, 'for-each-ref', '--format=%(refname)'), '');
    for (const sha of [
      report.base,
      report.control,
      report.candidate,
      ...Object.values(report.trees),
    ])
      assert.match(String(sha), /^[a-f0-9]{40}$/);
    assert.notEqual(report.control, report.candidate);
    assert.equal(report.newFrozenViolation.message, report.expectedDiagnostic);
    assert.match(result.stderr, /frozen-policy/);
    assert.ok(result.stderr.includes(report.expectedDiagnostic.replaceAll('"', '\\"')));
    assert.equal(
      report.baselineViolations.some(
        (v: { message: string }) => v.message === report.expectedDiagnostic,
      ),
      false,
    );
    for (const [name, status] of [
      ['control-freeze', 0],
      ['candidate-freeze', 1],
      ['candidate-currency', 1],
    ] as const)
      assert.equal(
        JSON.parse(readFileSync(join(out, `${name}.command.json`), 'utf8')).status,
        status,
      );
    assert.equal(report.publication.refsBefore, '');
    assert.equal(report.publication.refsAfter, '');
    assert.equal(report.publication.refsPublished, 0);
    assert.equal(report.publication.mergeAttempts, 0);
    assert.equal(report.publication.sharedWrites, 0);
    const controlPatch = readFileSync(join(out, 'control.patch'), 'utf8');
    assert.match(controlPatch, /diff --git a\/package\.json/);
    assert.match(controlPatch, /diff --git a\/package-lock\.json/);
    assert.match(controlPatch, /oxfmt/);
    const commands = JSON.parse(readFileSync(join(out, 'commands.json'), 'utf8')) as {
      command: string[];
      cwd: string;
    }[];
    assert.equal(
      commands.some((c) =>
        c.command.some((arg) => arg === 'push' || arg === 'merge' || arg === 'update-ref'),
      ),
      false,
    );
    console.log(`# exact ${probeCase} replay evidence: ${out}`);
  });
}

test('invalid probe cases fail as verification errors rather than a validated negative gate', () => {
  const result = spawnSync(process.execPath, [cli, '--case', 'everything', '--out', '/unused'], {
    cwd: repo,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).status, 'verification-error');
});
