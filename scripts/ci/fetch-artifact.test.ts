// Shared artifact lookup (fm-o8xn), against the real GitHub API and real classic workflow artifacts. The correct
// fixture is the pinned control's own classic run; the mismatch cases name that real run with one input wrong; the
// sums and flipped-byte cases mutate a real downloaded copy; the expired case is a real expired classic artifact.
// Needs a token (GITHUB_TOKEN, GH_TOKEN or `gh auth token`); without one every API case is reported untested.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  checkRun,
  fetchArtifact,
  inputProblems,
  LookupError,
  pickArtifact,
  verifyUnpacked,
  type Inputs,
  type Run,
} from './fetch-artifact.ts';

const REPO = new URL('../..', import.meta.url).pathname;
const control = JSON.parse(
  readFileSync(join(REPO, 'autoresearch/drivers/control.json'), 'utf8'),
) as {
  treeSha256: string;
  source: string;
  classic: { repositoryId: number; workflow: string; runId: number; artifact: string };
};
const PINNED: Inputs = {
  sourceRepoId: String(control.classic.repositoryId),
  workflow: control.classic.workflow,
  runId: String(control.classic.runId),
  commit: control.source,
  artifactName: control.classic.artifact,
};
const THIS_REPO_ID = '1413979666'; // facemorph-me/facemorph.me

if (!process.env['GITHUB_TOKEN'] && !process.env['GH_TOKEN']) {
  const t = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  if (t.status === 0 && t.stdout.trim()) process.env['GH_TOKEN'] = t.stdout.trim();
}
const NO_TOKEN = !process.env['GITHUB_TOKEN'] && !process.env['GH_TOKEN'];
const scratch = () => mkdtempSync(join(tmpdir(), 'facemorph-fetch-'));

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof LookupError ? e.code : `unexpected ${String(e)}`;
  }
}

test('every input is required; an owner/name in place of the numeric ID is refused', () => {
  assert.deepEqual(inputProblems({}), [
    'source_repo_id is required',
    'workflow is required',
    'run_id must be a numeric run ID',
    'commit must be the full 40-hex SHA',
    'artifact_name is required',
  ]);
  assert.match(
    inputProblems({ ...PINNED, sourceRepoId: 'facemorph-me/facemorph.me-classic' })[0] ?? '',
    /must be the numeric repository ID/,
  );
  assert.deepEqual(inputProblems(PINNED), []);
});

test('nothing defaults to the running repository: GITHUB_REPOSITORY alone is not an input', () => {
  const r = spawnSync(
    process.execPath,
    [join(REPO, 'scripts/ci/fetch-artifact.ts'), '--out', scratch()],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_REPOSITORY: 'facemorph-me/facemorph.me-classic',
        GITHUB_RUN_ID: '1',
      },
    },
  );
  assert.equal(r.status, 1);
  const verdict = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '{}') as {
    error: string;
    message: string;
  };
  assert.equal(verdict.error, 'InvalidInput');
  assert.match(verdict.message, /source_repo_id is required/);
});

test('a run whose repository ID differs is refused (decision on the API fields)', () => {
  const run: Run = {
    id: 1,
    created_at: '2026-10-24T00:00:00Z',
    head_sha: PINNED.commit,
    path: PINNED.workflow,
    repository: { id: 1, full_name: 'someone/fork' },
  };
  assert.throws(() => checkRun(run, PINNED), { name: 'RepositoryMismatch' });
  assert.doesNotThrow(() =>
    checkRun(
      {
        ...run,
        repository: { id: Number(PINNED.sourceRepoId), full_name: 'x' },
        path: `${PINNED.workflow}@refs/heads/main`,
      },
      PINNED,
    ),
  );
});

test(
  'the pinned classic run fetches, verifies and yields the control digest',
  { skip: NO_TOKEN && 'untested: no token' },
  async (t) => {
    const out = scratch();
    try {
      const r = await fetchArtifact(PINNED, join(out, 'a'));
      assert.equal(r.artifactDigest, control.treeSha256);
      assert.equal(r.provenance['repository'], 'facemorph-me/facemorph.me-classic');
    } catch (e) {
      if (e instanceof LookupError && e.code === 'ArtifactExpired')
        return t.skip('untested: the pinned run artifact has expired (14-day retention)');
      throw e;
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  },
);

test(
  'one wrong input each gives its own named error',
  { skip: NO_TOKEN && 'untested: no token' },
  async () => {
    const out = scratch();
    const other = 'f'.repeat(40);
    const codes = {
      repository: await code(
        fetchArtifact({ ...PINNED, sourceRepoId: THIS_REPO_ID }, join(out, 'r')),
      ),
      commit: await code(fetchArtifact({ ...PINNED, commit: other }, join(out, 'c'))),
      workflow: await code(
        fetchArtifact({ ...PINNED, workflow: '.github/workflows/next-e2e.yml' }, join(out, 'w')),
      ),
      artifact: await code(
        fetchArtifact({ ...PINNED, artifactName: 'next-site-nope' }, join(out, 'n')),
      ),
    };
    assert.deepEqual(codes, {
      repository: 'RunNotFoundInRepository',
      commit: 'CommitMismatch',
      workflow: 'WorkflowMismatch',
      artifact: 'ArtifactNotFound',
    });
    rmSync(out, { recursive: true, force: true });
  },
);

test(
  'a real downloaded copy: missing sums and one flipped byte are refused',
  { skip: NO_TOKEN && 'untested: no token' },
  async (t) => {
    const out = scratch();
    try {
      await fetchArtifact(PINNED, join(out, 'a'));
    } catch (e) {
      rmSync(out, { recursive: true, force: true });
      if (e instanceof LookupError && e.code === 'ArtifactExpired')
        return t.skip('untested: the pinned run artifact has expired');
      throw e;
    }
    cpSync(join(out, 'a'), join(out, 'nosums'), { recursive: true });
    rmSync(join(out, 'nosums/next-site-SHA256SUMS'));
    assert.throws(() => verifyUnpacked(join(out, 'nosums'), PINNED.commit), {
      name: 'MissingSums',
    });
    cpSync(join(out, 'a'), join(out, 'flip'), { recursive: true });
    const file = join(out, 'flip/deploy-next/robots.txt');
    const bytes = readFileSync(file);
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    writeFileSync(file, bytes);
    assert.throws(() => verifyUnpacked(join(out, 'flip'), PINNED.commit), {
      name: 'DigestMismatch',
      message: /deploy-next\/robots.txt does not match its sum/,
    });
    assert.throws(() => verifyUnpacked(join(out, 'a'), 'f'.repeat(40)), { name: 'SourceMismatch' });
    assert.equal(verifyUnpacked(join(out, 'a'), PINNED.commit).digest, control.treeSha256);
    rmSync(out, { recursive: true, force: true });
  },
);

test(
  'an expired classic artifact reports blocked: artifact expired',
  { skip: NO_TOKEN && 'untested: no token' },
  async (t) => {
    // A successful classic next-site run older than the 14-day retention: its next-site artifact is gone.
    const before = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const runs = JSON.parse(
      execFileSync(
        'gh',
        [
          'api',
          `/repositories/${PINNED.sourceRepoId}/actions/workflows/next-site.yml/runs?status=success&per_page=5&created=<${before}`,
        ],
        { encoding: 'utf8' },
      ),
    ) as { workflow_runs: { id: number; head_sha: string }[] };
    const run = runs.workflow_runs[0];
    if (!run) return t.skip('untested: no classic next-site run older than 30 days');
    const inputs = {
      ...PINNED,
      runId: String(run.id),
      commit: run.head_sha,
      artifactName: `next-site-${run.head_sha}`,
    };
    await assert.rejects(fetchArtifact(inputs, join(scratch(), 'x')), {
      name: 'ArtifactExpired',
      message: /blocked: artifact expired/,
    });
  },
);

test('a missing artifact is expired only past the retention; a live one is picked', () => {
  const now = Date.parse('2026-10-24T00:00:00Z');
  const live = {
    id: 1,
    name: PINNED.artifactName,
    expired: false,
    size_in_bytes: 1,
    archive_download_url: 'u',
  };
  const age = (days: number) => ({
    runCreatedAt: new Date(now - days * 86_400_000).toISOString(),
    now,
    retentionDays: 14,
  });
  assert.equal(pickArtifact([live], PINNED, age(1)), live);
  assert.throws(() => pickArtifact([], PINNED, age(3)), { name: 'ArtifactNotFound' });
  assert.throws(() => pickArtifact([], PINNED, age(20)), {
    name: 'ArtifactExpired',
    message: /blocked: artifact expired/,
  });
  assert.throws(() => pickArtifact([{ ...live, expired: true }], PINNED, age(3)), {
    name: 'ArtifactExpired',
  });
});
