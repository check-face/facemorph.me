// Shared artifact lookup (fm-o8xn), against the real GitHub API and real classic workflow artifacts. The correct
// fixture is the pinned control's own classic run; the mismatch cases name that real run with one input wrong; the
// sums and flipped-byte cases mutate a real downloaded copy; the expired case is a real expired classic artifact.
// Needs a token (GITHUB_TOKEN, GH_TOKEN or `gh auth token`); without one every API case is reported untested.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  checkRun,
  fetchArtifact,
  inputProblems,
  LookupError,
  pickArtifact,
  treeDigest,
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

// These are transport fault tests, not a product/runtime substitute: the actual fetch, body reader, unzip and
// checksum/source verifier run against a real HTTP server and a small, checksum-bound ZIP.
type Stage = 'run-metadata' | 'artifact-list' | 'archive-download';
type Fault = 'disconnect' | 'truncated-body' | 'hang' | number;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function httpFixture(t: TestContext) {
  const root = scratch();
  const unpacked = join(root, 'unpacked');
  mkdirSync(join(unpacked, 'deploy-next'), { recursive: true });
  const content = Buffer.from('artifact transport fixture\n');
  writeFileSync(join(unpacked, 'deploy-next/index.html'), content);
  writeFileSync(
    join(unpacked, 'next-site-SHA256SUMS'),
    `${hash(content)}  deploy-next/index.html\n`,
  );
  writeFileSync(join(unpacked, 'next-site-source.txt'), PINNED.commit + '\n');
  const zipPath = join(root, 'fixture.zip');
  const archive = () => {
    rmSync(zipPath, { force: true });
    execFileSync('zip', ['-qr', zipPath, '.'], { cwd: unpacked });
    return readFileSync(zipPath);
  };
  let zip = archive();
  const expectedDigest = treeDigest(join(unpacked, 'deploy-next'));
  const counts: Record<Stage, number> = {
    'run-metadata': 0,
    'artifact-list': 0,
    'archive-download': 0,
  };
  const faults: Partial<Record<Stage, Fault[]>> = {};
  const run: Run = {
    id: Number(PINNED.runId),
    created_at: new Date().toISOString(),
    head_sha: PINNED.commit,
    path: PINNED.workflow,
    repository: { id: Number(PINNED.sourceRepoId), full_name: 'test/transport' },
  };
  let runBytes: Buffer | undefined;
  let listBytes: Buffer | undefined;
  let origin = '';
  const send = (response: ServerResponse, status: number, bytes: Buffer) => {
    response.writeHead(status, { 'content-length': bytes.length });
    response.end(bytes);
  };
  const server = createServer((request, response) => {
    const stage: Stage = request.url?.startsWith('/archive')
      ? 'archive-download'
      : request.url?.includes('/artifacts?')
        ? 'artifact-list'
        : 'run-metadata';
    counts[stage]++;
    const fault = faults[stage]?.shift();
    if (fault === 'disconnect') return request.socket.destroy();
    if (typeof fault === 'number')
      return send(
        response,
        fault,
        Buffer.from('server failure: signed-url-and-token-must-not-escape'),
      );
    const bytes =
      stage === 'run-metadata'
        ? (runBytes ?? Buffer.from(JSON.stringify(run)))
        : stage === 'artifact-list'
          ? (listBytes ??
            Buffer.from(
              JSON.stringify({
                artifacts: [
                  {
                    id: 42,
                    name: PINNED.artifactName,
                    expired: false,
                    size_in_bytes: zip.length,
                    archive_download_url: `${origin}/archive?signature=do-not-log-this`,
                  },
                ],
              }),
            ))
          : zip;
    if (fault === 'hang' || fault === 'truncated-body') {
      response.writeHead(200, { 'content-length': bytes.length });
      response.flushHeaders();
      if (fault === 'truncated-body') {
        response.write(bytes.subarray(0, Math.floor(bytes.length / 2)));
        setImmediate(() => response.destroy());
      }
      return;
    }
    send(response, 200, bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    unpacked,
    expectedDigest,
    faults,
    counts,
    run,
    setRun: (bytes: string) => {
      runBytes = Buffer.from(bytes);
    },
    setList: (bytes: string) => {
      listBytes = Buffer.from(bytes);
    },
    rearchive: () => {
      zip = archive();
    },
    zipHash: () => hash(zip),
    fetch: (timeoutMs = 1_000) =>
      fetchArtifact(PINNED, join(root, 'downloaded'), 14, {
        apiOrigin: origin,
        token: 'local-test-token-do-not-log-this',
        retryDelayMs: 1,
        timeoutMs,
      }),
  };
}

for (const [stage, fault] of [
  ['run-metadata', 503],
  ['artifact-list', 'truncated-body'],
  ['archive-download', 'disconnect'],
  ['archive-download', 'truncated-body'],
  ['archive-download', 'hang'],
] as const) {
  test(`real HTTP ${stage} ${fault} retries and verifies exactly the same artifact bytes`, async (t) => {
    const fixture = await httpFixture(t);
    const baseline = await fixture.fetch();
    fixture.faults[stage] = [fault];
    const before = fixture.counts[stage];
    const retried = await fixture.fetch(fault === 'hang' ? 100 : 1_000);
    assert.equal(fixture.counts[stage] - before, 2);
    assert.equal(retried.artifactDigest, fixture.expectedDigest);
    assert.equal(retried.artifactDigest, baseline.artifactDigest);
    assert.equal(retried.provenance['zipSha256'], fixture.zipHash());
    assert.deepEqual(retried.provenance, baseline.provenance);
  });
}

for (const [stage, fault, causeCode] of [
  ['run-metadata', 503, 'HTTP_503'],
  ['archive-download', 'disconnect', 'UND_ERR_SOCKET'],
  ['archive-download', 'hang', 'REQUEST_TIMEOUT'],
] as const) {
  test(`real HTTP ${stage} ${fault} stops after three attempts with sanitized diagnostics`, async (t) => {
    const fixture = await httpFixture(t);
    fixture.faults[stage] = [fault, fault, fault];
    await assert.rejects(fixture.fetch(fault === 'hang' ? 50 : 1_000), (error: unknown) => {
      assert.ok(error instanceof LookupError);
      assert.equal(error.stage, stage);
      assert.equal(error.attempts, 3);
      assert.equal(error.causeCode, causeCode);
      const diagnostic = JSON.stringify(error) + error.message;
      assert.equal(/signature|do-not-log|signed-url|127\.0\.0\.1/.test(diagnostic), false);
      return true;
    });
    assert.equal(fixture.counts[stage], 3);
  });
}

for (const stage of ['run-metadata', 'artifact-list', 'archive-download'] as const) {
  for (const status of [401, 403, 404, 410]) {
    test(`real HTTP ${stage} HTTP ${status} fails without retry`, async (t) => {
      const fixture = await httpFixture(t);
      fixture.faults[stage] = [status];
      await assert.rejects(fixture.fetch(), (error: unknown) => {
        assert.ok(error instanceof LookupError);
        assert.equal(/signed-url|do-not-log/.test(error.message), false);
        return true;
      });
      assert.equal(fixture.counts[stage], 1);
    });
  }
}

for (const stage of ['run-metadata', 'artifact-list'] as const) {
  for (const bad of ['not JSON: signed-url-do-not-log-this', '{}']) {
    test(`real HTTP ${stage} malformed metadata ${JSON.stringify(bad)} fails without retry`, async (t) => {
      const fixture = await httpFixture(t);
      (stage === 'run-metadata' ? fixture.setRun : fixture.setList)(bad);
      await assert.rejects(fixture.fetch(), (error: unknown) => {
        assert.ok(error instanceof LookupError);
        assert.equal(error.code, 'ApiError');
        assert.equal(error.stage, stage);
        assert.equal(/signed-url|do-not-log/.test(error.message), false);
        return true;
      });
      assert.equal(fixture.counts[stage], 1);
      assert.equal(fixture.counts['archive-download'], 0);
    });
  }
}

for (const mismatch of ['repository', 'commit', 'workflow'] as const) {
  test(`real HTTP ${mismatch} identity refusal makes no list/download request or retry`, async (t) => {
    const fixture = await httpFixture(t);
    fixture.setRun(
      JSON.stringify({
        ...fixture.run,
        ...(mismatch === 'repository' ? { repository: { id: 1, full_name: 'wrong/repo' } } : {}),
        ...(mismatch === 'commit' ? { head_sha: 'f'.repeat(40) } : {}),
        ...(mismatch === 'workflow' ? { path: '.github/workflows/wrong.yml' } : {}),
      }),
    );
    await assert.rejects(fixture.fetch(), {
      name: {
        repository: 'RepositoryMismatch',
        commit: 'CommitMismatch',
        workflow: 'WorkflowMismatch',
      }[mismatch],
    });
    assert.deepEqual(fixture.counts, {
      'run-metadata': 1,
      'artifact-list': 0,
      'archive-download': 0,
    });
  });
}

for (const refusal of ['digest', 'source', 'sums'] as const) {
  test(`real HTTP verified ZIP ${refusal} refusal is never downloaded again`, async (t) => {
    const fixture = await httpFixture(t);
    if (refusal === 'digest')
      writeFileSync(join(fixture.unpacked, 'deploy-next/index.html'), 'flipped bytes');
    if (refusal === 'source')
      writeFileSync(join(fixture.unpacked, 'next-site-source.txt'), 'f'.repeat(40));
    if (refusal === 'sums') rmSync(join(fixture.unpacked, 'next-site-SHA256SUMS'));
    fixture.rearchive();
    await assert.rejects(fixture.fetch(), {
      name: { digest: 'DigestMismatch', source: 'SourceMismatch', sums: 'MissingSums' }[refusal],
    });
    assert.deepEqual(fixture.counts, {
      'run-metadata': 1,
      'artifact-list': 1,
      'archive-download': 1,
    });
  });
}
