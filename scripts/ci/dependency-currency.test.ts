import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  isActiveLtsNodeRange,
  validateLockfile,
  validateManifest,
  validateOrtMirror,
  validateUpdaterPaths,
} from './dependency-currency.ts';

const manifest = () => ({
  path: 'apps/web/package.json',
  manifest: {
    engines: { node: '>=24.0.0 <25.0.0' },
    dependencies: { react: '^19.3.1', '@facemorph/stylegan-js': 'workspace:*' },
    devDependencies: { vite: '^8.3.5' },
    optionalDependencies: { codec: 'file:../../vendor/codec' },
    peerDependencies: { host: '^3.0.0 || ^4.0.0' },
  },
});
const manifestPolicy = { workspaceNames: ['@facemorph/stylegan-js'], requireNodeEngine: true };

test('caret ranges across every dependency section coexist with explicit workspace/local references', () => {
  assert.deepEqual(validateManifest(manifest(), manifestPolicy), []);
  for (const range of ['0.0.0', '*', 'workspace:^', 'workspace:~', 'workspace:^0.0.0']) {
    const input = manifest();
    input.manifest.dependencies['@facemorph/stylegan-js'] = range;
    assert.deepEqual(validateManifest(input, manifestPolicy), [], range);
  }
});

test('exact, wildcard, tilde, dist-tag, remote and bounded hold-back dependency mutations fail', () => {
  for (const range of [
    '19.3.1',
    '=19.3.1',
    '*',
    '~19.3.1',
    'latest',
    '>=19',
    '^19.3.1 <19.4.0',
    'git+https://example.test/react.git',
    '^19.3.1 || 20.0.0',
    '^19.3.1-01',
  ]) {
    const input = manifest();
    input.manifest.dependencies.react = range;
    assert.deepEqual(
      validateManifest(input, manifestPolicy).map((v) => v.code),
      ['manifest-caret'],
      range,
    );
  }
  for (const section of ['devDependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const input = manifest();
    Object.assign(input.manifest[section], { unexpected: '1.2.3' });
    assert.equal(validateManifest(input, manifestPolicy).length, 1, section);
  }
});

test('an undeclared workspace and malformed workspace/local references cannot bypass caret policy', () => {
  for (const range of [
    'workspace:*',
    'workspace:^999invalid',
    'file:/absolute/codec',
    'file:https://example.test/codec',
    'link:',
    'file:..\\codec',
  ]) {
    const input = manifest();
    input.manifest.dependencies.react = range;
    assert.equal(validateManifest(input, manifestPolicy).length, 1, range);
  }
  const input = manifest();
  input.manifest.dependencies['@facemorph/stylegan-js'] = 'workspace:^999invalid';
  assert.equal(validateManifest(input, manifestPolicy).length, 1);
});

test('Node LTS selectors have both a lower bound of 24 and an upper bound excluding 25', () => {
  for (const range of [
    '24',
    '24.x',
    '24.*',
    '24.22',
    '^24.0.0',
    '~24.22.0',
    '>=24 <25',
    '>= 24.1.0 < 25.0.0',
    '>=24.1 <=24.99',
    '^24.0.0 || >=24.20 <25',
  ])
    assert.equal(isActiveLtsNodeRange(range), true, range);
  for (const range of [
    '>=24',
    '>=24.0.0',
    '^26.0.0',
    '26.x',
    '>=24 <27',
    '>=22 <25',
    '<25',
    '24 || 26',
    '>=24 <=25.0.0',
    '>=25 <25',
    '>=24 <24',
    '24.0.0-rc.1',
    '*',
    '',
    '24.x.1',
  ])
    assert.equal(isActiveLtsNodeRange(range), false, range);
});

test('manifest Node engine mutations report an actionable violation; inherited engine omission is explicit', () => {
  const input = manifest();
  input.manifest.engines.node = '>=24';
  assert.deepEqual(
    validateManifest(input, manifestPolicy).map((v) => v.code),
    ['node-lts'],
  );
  assert.deepEqual(
    validateManifest({ path: 'packages/model-conv/package.json', manifest: {} }),
    [],
  );
  assert.equal(
    validateManifest({ path: 'package.json', manifest: {} }, { requireNodeEngine: true })[0]?.code,
    'node-lts',
  );
});

const lock = () => ({
  path: 'package-lock.json',
  lockfile: {
    packages: {
      '': { version: '0.0.0' },
      'node_modules/onnxruntime-web': { version: '1.30.0' },
      'node_modules/tool/node_modules/helper': { version: '2.1.0+build-beta.2' },
      'node_modules/@facemorph/stylegan-js': { link: true },
    },
  },
});

test('stable lock resolutions and workspace links pass, including build metadata containing a hyphen', () => {
  assert.deepEqual(validateLockfile(lock()), []);
});

test('all prerelease identifiers in nested resolutions fail outside the explicitly declared bleeding-edge lane', () => {
  for (const version of [
    '2.1.0-dev.1',
    '2.1.0-canary.5',
    '2.1.0-alpha',
    '2.1.0-beta.2',
    '2.1.0-rc.4',
    '2.1.0-next',
    '2.1.0-nightly.20261027',
    '2.1.0-experimental',
  ]) {
    const input = lock();
    input.lockfile.packages['node_modules/tool/node_modules/helper'].version = version;
    const errors = validateLockfile(input);
    assert.equal(errors[0]?.code, 'lock-prerelease', version);
    assert.match(errors[0]!.message, /node_modules\/tool\/node_modules\/helper/);
    assert.deepEqual(validateLockfile(input, { lane: 'bleeding-edge' }), []);
  }
});

test('malformed resolved versions fail even in the bleeding-edge lane', () => {
  const input = lock();
  input.lockfile.packages['node_modules/onnxruntime-web'].version = 'latest';
  assert.equal(validateLockfile(input, { lane: 'bleeding-edge' })[0]?.code, 'lock-version');
});

const paths = {
  manifestPaths: ['package.json', 'apps/web/package.json'],
  lockfilePaths: ['package-lock.json', 'apps/web/scripts/matrix-tools/package-lock.json'],
  runtimeManifestPaths: ['import/runtime-mirror.json'],
};

test('updater manifest, nested lock and runtime-manifest changes pass their exact allowlist', () => {
  assert.deepEqual(
    validateUpdaterPaths(
      [
        'package.json',
        'package-lock.json',
        'apps/web/package.json',
        'apps/web/scripts/matrix-tools/package-lock.json',
        'import/runtime-mirror.json',
      ],
      paths,
    ),
    [],
  );
});

test('a grouped update touching source, CI, tolerances or an uninventoried manifest fails', () => {
  for (const path of [
    'apps/web/src/controller.ts',
    '.github/workflows/ci.yml',
    'packages/stylegan-js/src/numerics.ts',
    'unlisted/package.json',
  ]) {
    const errors = validateUpdaterPaths(['package-lock.json', path], paths);
    assert.deepEqual(
      errors.map((v) => v.path),
      [path],
    );
  }
});

test('traversal and frozen classic/self-host paths are rejected even if mistakenly allowlisted', () => {
  for (const path of [
    '../package.json',
    '/package.json',
    './package.json',
    'apps\\web\\package.json',
    'self-host/package.json',
    'classic/package.json',
    'facemorph.me-classic/package.json',
  ]) {
    assert.equal(
      validateUpdaterPaths([path], { ...paths, manifestPaths: [path] })[0]?.code,
      'updater-path',
      path,
    );
  }
});

// Synthetic byte fixtures exercise independent hashing. They are not a claimed real ORT mirror.
const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const mirror = () => {
  const files = [
    { path: 'ort.wasm.min.mjs', sha256: digest('fixture module bytes') },
    { path: 'ort-wasm-simd-threaded.wasm', sha256: digest('fixture wasm bytes') },
  ];
  return {
    lockfile: lock().lockfile,
    lockfilePath: 'package-lock.json',
    mirror: { version: '1.30.0', files: structuredClone(files) },
    mirrorPath: 'import/runtime-mirror.json',
    actualFiles: structuredClone(files),
  };
};

test('lock ORT version and every independently hashed mirror file agree', () => {
  assert.deepEqual(validateOrtMirror(mirror()), []);
});

test('an ORT npm bump without its mirrored runtime fails; conflicting nested versions also fail', () => {
  const input = mirror();
  input.lockfile.packages['node_modules/onnxruntime-web'].version = '1.31.0';
  assert.equal(validateOrtMirror(input)[0]?.code, 'ort-version-mismatch');
  const nested = mirror();
  Object.assign(nested.lockfile.packages, {
    'node_modules/tool/node_modules/onnxruntime-web': { version: '1.29.0' },
  });
  assert.equal(validateOrtMirror(nested)[0]?.code, 'ort-version-mismatch');
});

test('a changed mirrored byte, missing file or missing digest fails despite matching ORT versions', () => {
  const changed = mirror();
  changed.actualFiles[1]!.sha256 = digest('changed fixture wasm byte');
  assert.equal(validateOrtMirror(changed)[0]?.code, 'ort-digest-mismatch');
  const missing = mirror();
  missing.actualFiles.pop();
  assert.equal(validateOrtMirror(missing)[0]?.code, 'ort-digest-mismatch');
  const missingDigest = mirror();
  missingDigest.mirror.files[0]!.sha256 = '';
  assert.ok(validateOrtMirror(missingDigest).some((v) => v.code === 'ort-mirror-file'));
});

test('an empty mirror, ambiguous file inventory or unrecorded ORT file fails closed', () => {
  const empty = mirror();
  empty.mirror.files = [];
  assert.ok(validateOrtMirror(empty).some((v) => v.code === 'ort-mirror-files'));
  const duplicate = mirror();
  duplicate.actualFiles.push({ ...duplicate.actualFiles[0]! });
  assert.ok(validateOrtMirror(duplicate).some((v) => v.code === 'ort-actual-file'));
  const extra = mirror();
  extra.actualFiles.push({ path: 'new-runtime.mjs', sha256: digest('new fixture module') });
  assert.equal(validateOrtMirror(extra)[0]?.code, 'ort-unrecorded-file');
});

test('validators do not mutate caller-owned snapshots', () => {
  const input = mirror();
  const before = structuredClone(input);
  validateOrtMirror(input);
  assert.deepEqual(input, before);
});
