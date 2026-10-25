// The mirror Worker's import and configuration (fm-fy2.14), on plain values: its provenance names the frozen classic
// revision and every source file at the digest import/allowlist.json records for it, each destination exists, the
// package source names no FaceMorph host, and the prefix rules. The Worker itself runs in workerd in
// mirror.workerd.ts. warm runs through the CLI against a real local test mirror with a fault switch.
// The cf deploy dry runs need workerd too; deploy.workerd.ts runs them in the supported eris lane.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_COMPATIBILITY_DATE, deployEnv } from '../src/mirror/deploy.ts';
import { mirrored, prefixes } from '../src/mirror/worker.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const PACKAGE = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(join(REPO, path), 'utf8'));
const provenance = read('packages/cloudflare-model-host/mirror/provenance.json');
const allowlist = read('import/allowlist.json');

test('the provenance names the frozen revision and each source at the allowlist digest; destinations exist', () => {
  assert.equal(provenance.source.commit, allowlist.source.frozen_commit);
  assert.equal(provenance.source.repository, allowlist.source.repository);
  const listed = allowlist.listed_with_digests.filter((f: { source: string }) =>
    f.source.startsWith('hosting/next-mirror/'),
  );
  assert.deepEqual(
    provenance.files.map((f: { source: string }) => f.source).sort(),
    listed.map((f: { source: string }) => f.source).sort(),
    'every listed mirror file has a provenance entry',
  );
  for (const f of provenance.files) {
    const row = listed.find((l: { source: string }) => l.source === f.source);
    assert.equal(f.sha256, row.sha256, f.source);
    assert.equal(f.bytes, row.bytes, f.source);
    assert.ok(f.ported, `${f.source} says what changed`);
    if (f.destination !== null) assert.ok(existsSync(join(REPO, f.destination)), f.destination);
  }
});

test('the package source names no FaceMorph host', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  for (const path of files(join(PACKAGE, 'src')))
    assert.doesNotMatch(
      readFileSync(path, 'utf8'),
      /(next|models)\.facemorph\.me/,
      path.slice(PACKAGE.length),
    );
});

test('prefixes come from configuration only; a path is mirrored under one, never with an empty or .. segment', () => {
  assert.deepEqual(prefixes(undefined), []);
  assert.deepEqual(prefixes(' runtime/chunks , runtime/assets/,'), [
    'runtime/chunks/',
    'runtime/assets/',
  ]);
  const allowed = prefixes('runtime/chunks/');
  assert.equal(mirrored('runtime/chunks/a/part-001.bin', allowed), true);
  assert.equal(mirrored('runtime/chunksx/a', allowed), false);
  assert.equal(mirrored('runtime/manifest.json', allowed), false);
  assert.equal(mirrored('runtime/chunks/../manifest.json', allowed), false);
  assert.equal(mirrored('runtime/chunks//a', allowed), false);
  assert.equal(mirrored('runtime/chunks/', allowed), false);
  assert.equal(mirrored('runtime/chunks/a', []), false);
});

// A real local test mirror with a fault switch: HEAD answers 200 for every path except those `missing` names, and
// `flaky` paths answer 503 the given number of times first.
const mirrorSite = {
  missing: new Set<string>(),
  flaky: new Map<string, number>(),
  asked: [] as string[],
};
let mirrorServer: Server;
let mirrorOrigin: string;
before(async () => {
  mirrorServer = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').slice(1));
    mirrorSite.asked.push(`${req.method} ${path}`);
    const left = mirrorSite.flaky.get(path) ?? 0;
    if (left > 0) {
      mirrorSite.flaky.set(path, left - 1);
      return res.writeHead(503).end();
    }
    res.writeHead(mirrorSite.missing.has(path) ? 404 : 200).end();
  });
  await new Promise<void>((r) => mirrorServer.listen(0, '127.0.0.1', r));
  mirrorOrigin = `http://127.0.0.1:${(mirrorServer.address() as AddressInfo).port}/`;
});
after(() => mirrorServer?.close());

/** A planted staged root: immutable files under the prefixes, and a mutable manifest outside them. */
function stagedRoot(): { root: string; immutable: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'mirror-warm-'));
  const immutable = [
    'runtime/chunks/aa/part-001.bin',
    'runtime/chunks/aa/part-002.bin',
    'runtime/assets/bb.onnx',
    'runtime/encoder-stream/cc/part 003.onnx',
  ];
  for (const path of [...immutable, 'runtime/manifest.json', 'index.html']) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), path);
  }
  return { root, immutable };
}
const WARM_PREFIXES = 'runtime/assets/,runtime/chunks/,runtime/encoder-stream/';
const CLI = join(PACKAGE, 'src/cli.ts');
const cli = (args: string[]) =>
  new Promise<{ status: number | null; stdout: string }>((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args]);
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d));
    child.on('close', (status) => resolve({ status, stdout }));
  });

test('warm without --publish requests nothing and counts the immutable paths', async () => {
  const { root, immutable } = stagedRoot();
  mirrorSite.asked = [];
  const r = await cli([
    'warm',
    '--root',
    root,
    '--origin',
    mirrorOrigin,
    '--prefixes',
    WARM_PREFIXES,
  ]);
  assert.equal(r.status, 0);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(
    [report.published, report.paths, report.held, report.requests],
    [false, immutable.length, 0, 0],
  );
  assert.deepEqual(mirrorSite.asked, [], 'no request without --publish');
  rmSync(root, { recursive: true, force: true });
});

test('warm --publish: complete exits 0 holding every immutable path; a missing one exits non-zero naming it', async () => {
  const { root, immutable } = stagedRoot();
  mirrorSite.asked = [];
  mirrorSite.missing.clear();
  mirrorSite.flaky.set('runtime/chunks/aa/part-002.bin', 2);
  const ok = await cli([
    'warm',
    '--root',
    root,
    '--origin',
    mirrorOrigin,
    '--prefixes',
    WARM_PREFIXES,
    '--publish',
  ]);
  assert.equal(ok.status, 0);
  const report = JSON.parse(ok.stdout);
  assert.equal(report.held, immutable.length, 'held count equals the immutable path count');
  assert.deepEqual(report.failed, []);
  assert.equal(report.requests, immutable.length + 2, 'two transient 503s retried');
  assert.ok(mirrorSite.asked.every((a) => a.startsWith('HEAD ')));
  assert.deepEqual(
    [...new Set(mirrorSite.asked.map((a) => a.slice(5)))].sort(),
    [...immutable].sort(),
    'only the immutable paths, never the manifest or the page',
  );

  mirrorSite.missing.add('runtime/assets/bb.onnx');
  mirrorSite.flaky.set('runtime/chunks/aa/part-001.bin', 9);
  const bad = await cli([
    'warm',
    '--root',
    root,
    '--origin',
    mirrorOrigin,
    '--prefixes',
    WARM_PREFIXES,
    '--publish',
  ]);
  assert.equal(bad.status, 1);
  const failed = JSON.parse(bad.stdout).failed;
  assert.deepEqual(failed, [
    { path: 'runtime/assets/bb.onnx', status: 404 },
    { path: 'runtime/chunks/aa/part-001.bin', status: 503 },
  ]);
  mirrorSite.missing.clear();
  mirrorSite.flaky.clear();
  rmSync(root, { recursive: true, force: true });
});

test('a mirror target needs every deploy value; none is built in', () => {
  const target = {
    worker: 'w',
    bucket: 'b',
    upstream: 'https://upstream.invalid/',
    prefixes: 'runtime/chunks/',
  };
  assert.deepEqual(deployEnv(target), {
    MIRROR_WORKER: 'w',
    MIRROR_BUCKET: 'b',
    MIRROR_UPSTREAM: 'https://upstream.invalid/',
    MIRROR_PREFIXES: 'runtime/chunks/',
    MIRROR_COMPATIBILITY_DATE: DEFAULT_COMPATIBILITY_DATE,
  });
  for (const key of ['worker', 'bucket', 'upstream', 'prefixes'] as const)
    assert.throws(() => deployEnv({ ...target, [key]: ' ' }), new RegExp(key));
  assert.throws(() => deployEnv({ ...target, upstream: 'not a url' }));
});
