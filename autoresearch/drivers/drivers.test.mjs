// Maintained research drivers (fm-qqh): artifact identity and refusal, run labels and fresh run directories, the
// lease requirement, adapter admission, host classes and frame timing. Pure logic is called with plain values;
// artifacts are real directories written for the test, and the drivers' refusals run as real processes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { adapterVerdict } from './lib/adapter.mjs';
import {
  CONTROL,
  REPO,
  artifactDigest,
  freshRunDir,
  labelProblem,
  requireTimingLock,
  verifyArtifact,
} from './lib/artifact.mjs';
import { frameTiming } from './lib/frames.mjs';
import { hostClass } from './lib/session.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'facemorph-drivers-'));
function artifact() {
  const dir = scratch();
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>a</title>');
  writeFileSync(join(dir, 'app.js'), 'console.log(1)');
  return dir;
}

test('an artifact verifies against its own digest and is refused when one byte changes', () => {
  const dir = artifact();
  const { treeSha256, files } = artifactDigest(dir);
  assert.equal(files, 2);
  assert.equal(verifyArtifact(dir, treeSha256).treeSha256, treeSha256);
  writeFileSync(join(dir, 'app.js'), 'console.log(2)');
  assert.throws(() => verifyArtifact(dir, treeSha256), /refused before the run/);
  rmSync(dir, { recursive: true });
});

test('malformed digests and directories without index.html are refused', () => {
  const dir = artifact();
  assert.throws(() => verifyArtifact(dir, 'abc'), /64 lowercase hex/);
  assert.throws(() => verifyArtifact(dir, undefined), /64 lowercase hex/);
  rmSync(join(dir, 'index.html'));
  assert.throws(() => verifyArtifact(dir, 'a'.repeat(64)), /no index.html/);
  rmSync(dir, { recursive: true });
});

test('the independently cached pinned control matches control.json', (t) => {
  const dir = join(REPO, CONTROL.path);
  if (!existsSync(join(dir, 'index.html')))
    return t.skip(
      'untested: fetch the retained control with node scripts/import/fetch-control.mjs --dest .cache/control',
    );
  const id = verifyArtifact(dir, CONTROL.treeSha256);
  assert.equal(id.files, CONTROL.files);
  assert.equal(id.bytes, CONTROL.bytes);
});

test('run labels are fresh simple names; an existing run directory is never reused', () => {
  assert.equal(labelProblem('smoke-2026-10-24_a'), null);
  for (const bad of ['', 'a b', '../x', 'x/y', 'é', 'a'.repeat(81), undefined])
    assert.match(labelProblem(bad), /not \[A-Za-z0-9_-\]/);
  const root = scratch();
  const dir = freshRunDir(root, 'one');
  writeFileSync(join(dir, 'report.json'), '{}');
  assert.throws(() => freshRunDir(root, 'one'), /already exists: use a fresh run label/);
  assert.deepEqual(readdirSync(dir), ['report.json']);
  rmSync(root, { recursive: true });
});

test('a timing driver needs the gpu-timing lock run.py holds', () => {
  assert.throws(() => requireTimingLock({}), /not running under the gpu-timing lock/);
  assert.throws(() => requireTimingLock({ FACEMORPH_RUN: 'r1' }), /gpu-timing lock/);
  assert.throws(
    () => requireTimingLock({ FACEMORPH_EXCLUSIVE: 'other', FACEMORPH_RUN: 'r1' }),
    /gpu-timing lock/,
  );
  assert.deepEqual(requireTimingLock({ FACEMORPH_EXCLUSIVE: 'gpu-timing', FACEMORPH_RUN: 'r1' }), {
    lock: 'gpu-timing',
    run: 'r1',
  });
});

test('a GPU lane admits only a hardware adapter; CPU lanes make no claim', () => {
  const nvidia = { vendor: 'nvidia', architecture: 'turing', device: '', description: '' };
  assert.equal(adapterVerdict(nvidia, 'browser-gpu').ok, true);
  for (const info of [
    null,
    { ...nvidia, isFallbackAdapter: true },
    { vendor: 'google', architecture: 'swiftshader' },
    { vendor: 'mesa', architecture: '', description: 'llvmpipe (LLVM 19.1.7, 256 bits)' },
    { vendor: 'mesa', description: 'lavapipe' },
    { vendor: '', architecture: '' },
  ])
    assert.equal(adapterVerdict(info, 'browser-gpu').ok, false, JSON.stringify(info));
  assert.equal(adapterVerdict(null, 'browser-cpu').ok, true);
});

test('requests are classed as origin, project host, inline or blocked', () => {
  assert.equal(hostClass('https://next.facemorph.me/runtime/manifest.json'), 'origin');
  assert.equal(
    hostClass('https://facemorph-name-catalogue.cdilga.workers.dev/x'),
    'project:facemorph-name-catalogue.cdilga.workers.dev',
  );
  assert.equal(hostClass('data:image/png;base64,AA'), 'inline');
  assert.equal(
    hostClass('https://www.google-analytics.com/g/collect'),
    'blocked:www.google-analytics.com',
  );
});

test('frame timing counts synthesized and written frames from the last warm-up frame', () => {
  const events = [
    { at: 5, posted: 'synthesize-frames' },
    ...[100, 200, 300, 400, 500, 600].map((at) => ({ at, type: 'frame', provider: 'webgpu' })),
    ...[150, 250].map((at) => ({ at, posted: 'frame' })),
    { at: 610, type: 'complete', routeOutcome: 'served' },
  ];
  assert.deepEqual(frameTiming(events, 3), {
    synthesizedFrames: 6,
    writtenFrames: 2,
    firstFrameMs: 100,
    lastFrameMs: 600,
    perFrameMs: 100,
    providers: ['webgpu'],
    routeOutcomes: ['served'],
  });
  assert.equal(frameTiming(events.slice(0, 3), 3).perFrameMs, null);
});

for (const driver of ['built-ui-paired.mjs', 'morph-frame-product.mjs'])
  test(`${driver} refuses a wrong digest before the timing lock, a server or a browser`, () => {
    const dir = artifact();
    const out = scratch();
    const wrong = 'f'.repeat(64);
    const r = spawnSync(
      process.execPath,
      [
        join(REPO, 'autoresearch/drivers', driver),
        '--label',
        'x',
        '--control',
        dir,
        '--control-digest',
        wrong,
        '--out-root',
        out,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, FACEMORPH_EXCLUSIVE: '', FACEMORPH_RUN: '' },
      },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, new RegExp(`not the expected ${wrong}: refused before the run`));
    assert.doesNotMatch(r.stderr, /gpu-timing lock/); // identity is checked before the timing lock
    assert.deepEqual(readdirSync(out), []); // no run directory, so nothing ran
    // With the right digest and no timing lock, the timing refusal is next, still before any output.
    const right = artifactDigest(dir).treeSha256;
    const r2 = spawnSync(
      process.execPath,
      [
        join(REPO, 'autoresearch/drivers', driver),
        '--label',
        'x',
        '--control',
        dir,
        '--control-digest',
        right,
        '--out-root',
        out,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, FACEMORPH_EXCLUSIVE: '', FACEMORPH_RUN: '' },
      },
    );
    assert.notEqual(r2.status, 0);
    assert.match(r2.stderr, /not running under the gpu-timing lock/);
    assert.deepEqual(readdirSync(out), []);
    rmSync(dir, { recursive: true });
    rmSync(out, { recursive: true });
  });

test('a copy of the control with one file removed is not the control', (t) => {
  const dir = join(REPO, CONTROL.path);
  if (!existsSync(join(dir, 'index.html')))
    return t.skip(
      'untested: fetch the retained control with node scripts/import/fetch-control.mjs --dest .cache/control',
    );
  const copy = scratch();
  cpSync(dir, copy, { recursive: true });
  rmSync(join(copy, 'robots.txt'));
  assert.throws(() => verifyArtifact(copy, CONTROL.treeSha256), /refused before the run/);
  rmSync(copy, { recursive: true });
});
