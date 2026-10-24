// check-rename.mjs against the real GitHub API (read-only), with the expected values as the script's input
// (fm-rur): the recorded values pass under the current organization, and a changed repository ID, archive flag
// or default branch, or an unresolvable historical commit, each fail their own assertion. Runs the script as a
// real process; planted expected files and docs in temporary directories are inputs, not fakes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { docLinks, EXPECTED_FILE } from './check-rename.mjs';

const SCRIPT = fileURLToPath(new URL('./check-rename.mjs', import.meta.url));
const ORG = JSON.parse(readFileSync(EXPECTED_FILE, 'utf8')).organizations.before;
const recorded = () => JSON.parse(readFileSync(EXPECTED_FILE, 'utf8'));

function check(expected, org = ORG) {
  const dir = mkdtempSync(join(tmpdir(), 'check-rename-'));
  const file = join(dir, 'expected.json');
  writeFileSync(file, JSON.stringify(expected));
  const r = spawnSync(process.execPath, [SCRIPT, '--org', org, '--expected', file], {
    encoding: 'utf8',
  });
  const lines = r.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return { status: r.status, stderr: r.stderr, lines, failed: lines.filter((l) => l.ok === false) };
}

const gh = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
const skip = gh.status === 0 ? false : 'untested here: gh is not authenticated';

test(
  'the recorded values pass under the current organization; each line names its command',
  { skip },
  () => {
    const r = check(recorded());
    assert.equal(r.status, 0, JSON.stringify(r.failed) + r.stderr);
    const asserted = r.lines.filter((l) => 'assertion' in l);
    assert.ok(asserted.length >= 12);
    for (const l of asserted) {
      assert.match(l.command, /^(gh api|git ls-remote) /);
      assert.ok('expected' in l && 'actual' in l);
    }
    assert.deepEqual(r.lines.at(-1), {
      summary: { org: ORG, assertions: asserted.length, failed: 0 },
    });
  },
);

test('a changed repository ID fails', { skip }, () => {
  const e = recorded();
  e.repositories[3].id = 1; // repository 1 is not facemorph-names
  const r = check(e);
  assert.equal(r.status, 1);
  assert.deepEqual(
    r.failed.map((l) => l.assertion),
    ['repository 1 identity'],
  );
});

test('a changed archive flag fails', { skip }, () => {
  const e = recorded();
  const backend = e.repositories.find((x) => x.name === 'checkface');
  backend.archived = false;
  const r = check(e);
  assert.equal(r.status, 1);
  assert.deepEqual(
    r.failed.map((l) => l.assertion),
    [`repository ${backend.id} identity`],
  );
  assert.equal(r.failed[0].actual.archived, true);
});

test(
  'a changed default branch fails both the identity and the ls-remote assertion',
  { skip },
  () => {
    const e = recorded();
    e.repositories[0].defaultBranch = 'trunk';
    const r = check(e);
    assert.equal(r.status, 1);
    assert.deepEqual(
      r.failed.map((l) => l.assertion),
      [
        `repository ${e.repositories[0].id} identity`,
        `${ORG}/${e.repositories[0].name} answers git ls-remote with its default branch`,
      ],
    );
  },
);

test('an unresolvable historical commit fails', { skip }, () => {
  const e = recorded();
  e.commits.push({ label: 'planted', repoId: e.commits[0].repoId, sha: 'f'.repeat(40) });
  const r = check(e);
  assert.equal(r.status, 1);
  assert.deepEqual(
    r.failed.map((l) => l.assertion),
    ['commit fffffff (planted) resolves'],
  );
});

test(
  'under an organization the repositories are not in, every repository assertion fails',
  { skip },
  () => {
    const r = check({ ...recorded(), commits: [] }, 'facemorph-me');
    assert.equal(r.status, 1);
    assert.equal(
      r.failed.filter((l) => l.assertion.endsWith('identity')).length,
      5,
      'IDs resolve but names are under check-face',
    );
  },
);

test('docLinks finds github.com/<org>/<repo> links in markdown under the active paths only', () => {
  const root = mkdtempSync(join(tmpdir(), 'check-rename-docs-'));
  mkdirSync(join(root, 'docs/dev'), { recursive: true });
  mkdirSync(join(root, 'docs/history'), { recursive: true });
  writeFileSync(
    join(root, 'README.md'),
    'See https://github.com/check-face/facemorph.me-classic. and https://github.com/other/x.\n',
  );
  writeFileSync(
    join(root, 'docs/dev/a.md'),
    'clone https://github.com/check-face/facemorph.me.git\n',
  );
  writeFileSync(join(root, 'docs/history/b.md'), 'https://github.com/check-face/old-thing\n');
  assert.deepEqual(docLinks(root, ['README.md', 'docs/dev'], 'check-face'), [
    { name: 'facemorph.me-classic', file: 'README.md' },
    { name: 'facemorph.me', file: 'docs/dev/a.md' },
  ]);
});
