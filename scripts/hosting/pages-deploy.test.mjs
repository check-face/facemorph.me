import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { assetHash, assetsIn, deploymentArgs } from './pages-deploy.mjs';

const commit = 'a'.repeat(40);
test('Pages manifest identifies real file bytes plus extension, preserves paths and rejects unsupported inputs', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'fm-pages-assets-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'vendor'));
  writeFileSync(join(directory, 'index.html'), '<body>FaceMorph beads</body>');
  writeFileSync(join(directory, 'vendor/hello.txt'), 'hello');
  const assets = assetsIn(directory);
  assert.deepEqual(
    assets.map((asset) => asset.name),
    ['/index.html', '/vendor/hello.txt'],
  );
  assert.equal(assets[1].hash, 'f0b3413d4cabb000327fad369003d6a5');
  assert.equal(assets[1].contentType, 'text/plain');
  assert.notEqual(assetHash(Buffer.from('hello'), 'file.js'), assets[1].hash);
  assert.notEqual(assetHash(Buffer.from('changed'), 'file.txt'), assets[1].hash);
  symlinkSync(join(directory, 'index.html'), join(directory, 'outside'));
  assert.throws(() => assetsIn(directory), /symlink/);
  rmSync(join(directory, 'outside'));
  writeFileSync(join(directory, '_worker.js'), '');
  assert.throws(() => assetsIn(directory), /Unsupported tracker asset/);
});

test('identity must be explicit; only publish omits the cf dry-run flag', () => {
  const options = {
    project: 'example-pages',
    branch: 'main',
    commit,
    manifest: { '/index.html': 'a'.repeat(32) },
  };
  const args = deploymentArgs(options);
  assert.deepEqual(args.slice(0, 4), ['pages', 'deployments', 'create', options.project]);
  assert.equal(args[args.indexOf('--commit-hash') + 1], commit);
  assert.equal(args[args.indexOf('--branch') + 1], 'main');
  assert.equal(args.includes('--dry-run'), true);
  assert.equal(deploymentArgs({ ...options, publish: true }).includes('--dry-run'), false);
  assert.throws(() => deploymentArgs({ ...options, project: undefined }), /Pages project/);
  assert.throws(() => deploymentArgs({ ...options, commit: 'HEAD' }), /source commit/);
});

test('installed cf dry-run retains actual static files, project, main branch and exact visible commit', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'fm-pages-dryrun-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'index.html'), '<html><body>FaceMorph beads</body></html>');
  const args = [
    'scripts/hosting/pages-deploy.mjs',
    directory,
    '--project=example-pages',
    `--commit=${commit}`,
  ];
  const env = {
    ...process.env,
    CF_SEND_TELEMETRY: 'false',
    CLOUDFLARE_API_TOKEN: '',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  };
  const first = spawnSync(process.execPath, args, { encoding: 'utf8', env });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /"command": "cf pages deployments create"/);
  assert.match(first.stdout, /"project-name": "example-pages"/);
  assert.match(first.stdout, /"branch": "main"/);
  assert.match(first.stdout, new RegExp(`"commit-hash": "${commit}"`));
  assert.match(first.stdout, /"published":false/);
  const index = readFileSync(join(directory, 'index.html'), 'utf8');
  assert.ok(index.includes(`Source commit <code>${commit}</code>`));
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'deploy-source.json'))), {
    branch: 'main',
    commit,
  });
  const second = spawnSync(process.execPath, args, { encoding: 'utf8', env });
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(
    readFileSync(join(directory, 'index.html'), 'utf8'),
    index,
    'dry-run then publish keeps exact bytes',
  );
});
