// Runs the deletion against a real S3-compatible server (SeaweedFS in Docker, pinned) and real temporary Git
// repositories with a bare remote. Upload times are real, so the test spaces its sets by a few seconds and
// passes the matching bounds. Skips (reported, not passed) when Docker is unavailable.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CreateBucketCommand,
  PutObjectCommand,
  PutBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';
import { run, s3Client, listAll, digestKeys, EXIT } from './delete-old-wording-reports.mjs';

const IMAGE = 'chrislusf/seaweedfs:3.97';
const PORT = 18333;
const ENDPOINT = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOTE = 'docs/findings/diagnostics-learnings-2026-10-18.md';
let container;
let docker = true;
try {
  execFileSync('docker', ['info'], { stdio: 'ignore' });
} catch {
  docker = false;
}

const client = () => s3Client({ endpoint: ENDPOINT, accessKeyId: 'test', secretAccessKey: 'test' });
const sh = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

before(async () => {
  if (!docker) return;
  container = execFileSync(
    'docker',
    [
      'run',
      '-d',
      '--rm',
      '-p',
      `${PORT}:8333`,
      IMAGE,
      'server',
      '-s3',
      '-dir=/data',
      '-ip.bind=0.0.0.0',
    ],
    { encoding: 'utf8' },
  ).trim();
  for (let i = 0; i < 60; i++) {
    try {
      await client().send(new CreateBucketCommand({ Bucket: 'probe' }));
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error('SeaweedFS did not start');
});
after(() => {
  if (container) execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
});

// A working repository whose note commit is (or is not) on the bare remote's main.
function makeRepo({ pushed = true, noteText = 'Aggregates only: 12 runs, 3 devices.\n' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'fm-xgww-git-'));
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' });
  execFileSync('git', ['init', '-b', 'main', work], { stdio: 'ignore' });
  sh(work, 'config', 'user.email', 'test@invalid');
  sh(work, 'config', 'user.name', 'test');
  writeFileSync(join(work, 'README'), 'base\n');
  sh(work, 'add', '.');
  sh(work, 'commit', '-m', 'base');
  sh(work, 'remote', 'add', 'origin', remote);
  sh(work, 'push', '-q', 'origin', 'main');
  mkdirSync(join(work, 'docs/findings'), { recursive: true });
  writeFileSync(join(work, NOTE), noteText);
  sh(work, 'add', '.');
  sh(work, 'commit', '-m', 'note');
  const noteCommit = sh(work, 'rev-parse', 'HEAD');
  if (pushed) sh(work, 'push', '-q', 'origin', 'main');
  return { root, work, noteCommit };
}

// Bucket with: mined set M (before t1), optional extra set X (t1..t2), set A after t2. Real upload times.
async function seed(bucket, { mined = 5, extra = 0, after = 3 } = {}) {
  const c = client();
  await c.send(new CreateBucketCommand({ Bucket: bucket }));
  const put = (k) =>
    c.send(new PutObjectCommand({ Bucket: bucket, Key: k, Body: '{"events":[]}' }));
  const m = Array.from({ length: mined }, (_, i) => `runs/runm${i}xq7/obj${i}`);
  for (const k of m) await put(k);
  await sleep(2100);
  const t1 = new Date(Date.now() - 1000).toISOString();
  const x = Array.from({ length: extra }, (_, i) => `runs/runx${i}xq7/obj${i}`);
  for (const k of x) await put(k);
  await sleep(2100);
  const t2 = new Date(Date.now() - 1000).toISOString();
  const a = Array.from({ length: after }, (_, i) => `runs/runa${i}xq7/obj${i}`);
  await sleep(1100);
  for (const k of a) await put(k);
  return { m, x, a, t1, t2 };
}

// A client that records whether list/delete were ever called.
function counting(c) {
  const calls = { list: 0, delete: 0, keys: [] };
  return {
    calls,
    client: {
      send: (cmd) => {
        const n = cmd.constructor.name;
        if (n.startsWith('List')) calls.list++;
        if (n.startsWith('Delete')) {
          calls.delete++;
          calls.keys.push(...cmd.input.Delete.Objects.map((o) => o.Key));
        }
        return c.send(cmd);
      },
    },
  };
}

const base = (repo, s, extra = {}) => ({
  repo: repo.work,
  noteCommit: repo.noteCommit,
  notePath: NOTE,
  minedUpperBound: s.t1,
  boundary: s.t2,
  expectedCount: s.m.length,
  expectedDigest: digestKeys(s.m),
  workingRoots: [],
  ...extra,
});

test(
  'precondition (a): note commit absent from the remote default branch stops with zero list/delete calls',
  { skip: !docker && 'docker unavailable' },
  async () => {
    const repo = makeRepo({ pushed: false });
    const s = await seed('fmtest-pa');
    const r = counting(client()),
      w = counting(client());
    const out = await run(
      base(repo, s, { bucket: 'fmtest-pa', readClient: r.client, writeClient: w.client }),
      { log: () => {} },
    );
    assert.equal(out.code, EXIT.preconditionA);
    assert.equal(r.calls.list + w.calls.delete, 0);
    rmSync(repo.root, { recursive: true, force: true });
  },
);

test(
  'a note that fails the identifier scan stops before any listing',
  { skip: !docker && 'docker unavailable' },
  async () => {
    const repo = makeRepo({ noteText: 'run runs/k3x9qv2mzt1/abc failed\n' });
    const s = await seed('fmtest-pb');
    const r = counting(client()),
      w = counting(client());
    const out = await run(
      base(repo, s, { bucket: 'fmtest-pb', readClient: r.client, writeClient: w.client }),
      { log: () => {} },
    );
    assert.equal(out.code, EXIT.scan);
    assert.equal(r.calls.list + w.calls.delete, 0);
  },
);

test(
  'a digest mismatch on the mined set stops before any delete',
  { skip: !docker && 'docker unavailable' },
  async () => {
    const repo = makeRepo();
    const s = await seed('fmtest-pc');
    const w = counting(client());
    const out = await run(
      base(repo, s, {
        bucket: 'fmtest-pc',
        expectedDigest: '0'.repeat(64),
        readClient: client(),
        writeClient: w.client,
      }),
      { log: () => {} },
    );
    assert.equal(out.code, EXIT.digest);
    assert.equal(w.calls.delete, 0);
  },
);

test(
  'extra pre-boundary objects take the repeat path with no delete',
  { skip: !docker && 'docker unavailable' },
  async () => {
    const repo = makeRepo();
    const s = await seed('fmtest-pd', { extra: 2 });
    const w = counting(client());
    const out = await run(
      base(repo, s, { bucket: 'fmtest-pd', readClient: client(), writeClient: w.client }),
      { log: () => {} },
    );
    assert.equal(out.code, EXIT.repeat);
    assert.equal(w.calls.delete, 0);
  },
);

test(
  'happy path deletes exactly the mined set, keeps set A, cleans planted working copies, and is idempotent',
  { skip: !docker && 'docker unavailable' },
  async () => {
    const repo = makeRepo();
    const s = await seed('fmtest-pe');
    const tree = mkdtempSync(join(tmpdir(), 'fm-xgww-wc-'));
    writeFileSync(join(tree, 'raw-copy.json'), `{"key":"${s.m[0]}"}`);
    writeFileSync(join(tree, 'run-index.txt'), `runm3xq7\n`);
    writeFileSync(join(tree, 'unrelated.txt'), 'nothing here\n');
    writeFileSync(join(tree, 'after-set.txt'), `${s.a[0]}\n`);
    const w = counting(client());
    const logs = [];
    const out = await run(
      base(repo, s, {
        bucket: 'fmtest-pe',
        readClient: client(),
        writeClient: w.client,
        workingRoots: [tree],
      }),
      { log: (x) => logs.push(x) },
    );
    assert.equal(out.code, EXIT.done, JSON.stringify(logs));
    assert.deepEqual(new Set(w.calls.keys), new Set(s.m));
    for (const k of s.a)
      assert.ok(!w.calls.keys.includes(k), 'a post-boundary object was passed to delete');
    const left = (await listAll(client(), 'fmtest-pe', 'runs/')).map((o) => o.key).sort();
    assert.deepEqual(left, [...s.a].sort());
    assert.ok(!existsSync(join(tree, 'raw-copy.json')) && !existsSync(join(tree, 'run-index.txt')));
    assert.ok(existsSync(join(tree, 'unrelated.txt')) && existsSync(join(tree, 'after-set.txt')));
    assert.equal(out.receipt.post.remainingMined, 0);
    assert.equal(out.receipt.post.afterDigest, out.receipt.pre.afterDigest);
    for (const l of logs)
      for (const k of [...s.m, ...s.a])
        assert.ok(!JSON.stringify(l).includes(k), 'a key reached the log');
    // Second run: nothing left to delete, same invocation, no prompt or flag.
    const again = await run(
      base(repo, s, {
        bucket: 'fmtest-pe',
        readClient: client(),
        writeClient: client(),
        workingRoots: [tree],
      }),
      { log: () => {} },
    );
    assert.equal(again.code, EXIT.done);
    assert.equal(again.receipt.deleted, 0);
  },
);

test(
  'a post-check failure marks the run failed',
  { skip: !docker && 'docker unavailable' },
  async () => {
    const repo = makeRepo();
    const s = await seed('fmtest-pf');
    // A real expiration rule on the bucket breaks the "no deletion promise" post-check.
    await client().send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: 'fmtest-pf',
        LifecycleConfiguration: {
          Rules: [
            {
              ID: 'expire-30d',
              Status: 'Enabled',
              Filter: { Prefix: 'runs/' },
              Expiration: { Days: 30 },
            },
          ],
        },
      }),
    );
    const out = await run(
      base(repo, s, { bucket: 'fmtest-pf', readClient: client(), writeClient: client() }),
      { log: () => {} },
    );
    assert.equal(out.code, EXIT.postCheck);
    assert.equal(out.receipt.outcome, 'failed');
    assert.equal(out.receipt.post.expirationRules, 1);
  },
);
