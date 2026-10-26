import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkDependencyCurrency,
  parseCurrencyArgs,
  type CurrencyOptions,
} from './check-dependency-currency.ts';
import { type DependencyPolicy } from './dependency-freeze.ts';
import { composeManifest, generateOverlay, ORT_FILES, withSerialCompanion } from './ort-mirror.ts';
import {
  composeEncoderDescriptor,
  generateSerialCompanion,
  SERIAL_ORT_FILES,
} from './serial-ort.ts';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const policyPath = 'scripts/ci/dependency-policy.json';

function fixture(
  t: TestContext,
  encoderVersion = '1.30.0',
  nestedEncoderVersion?: string,
  serial = false,
) {
  const temporary = mkdtempSync(join(tmpdir(), 'facemorph-currency-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const repo = join(temporary, 'repo');
  const artifact = join(temporary, 'artifact');
  mkdirSync(repo);
  const git = (args: string[]) =>
    execFileSync(
      'git',
      [
        '-C',
        repo,
        '-c',
        'user.name=Currency fixture',
        '-c',
        'user.email=currency@example.invalid',
        '-c',
        'core.hooksPath=/dev/null',
        ...args,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  const write = (path: string, value: unknown) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  // Deliberately miniature synthetic package bytes; this fixture never claims to be the production mirror.
  const dist = join(temporary, 'npm', 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    join(dirname(dist), 'package.json'),
    JSON.stringify({ name: 'onnxruntime-web', version: '1.30.0' }),
  );
  for (const file of ORT_FILES) writeFileSync(join(dist, file), `synthetic fixture ${file}`);
  const locked = {
    version: '1.30.0',
    resolved: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.30.0.tgz',
    integrity: `sha512-${Buffer.alloc(64, 7).toString('base64')}`,
  };
  let overlay = generateOverlay(dist, locked);
  const encoderManifests = new Map<string, string>();
  const encoder = (version: string, child?: unknown) => {
    const bytes = JSON.stringify({
      runtime: {
        version,
        unshared: true,
        maxWasmBytes: 268435456,
        memoryReceipt: { newMaximumPages: 4096 },
      },
      ...(child === undefined ? {} : { encoderStream: child }),
    });
    const sha256 = digest(bytes);
    const path = `encoder-stream/${sha256}/manifest.json`;
    encoderManifests.set(path, bytes);
    return {
      url: `https://next.facemorph.me/runtime/${path}`,
      sha256,
      size: Buffer.byteLength(bytes),
    };
  };
  let encoderStream = encoder(
    encoderVersion,
    nestedEncoderVersion === undefined ? undefined : encoder(nestedEncoderVersion),
  );
  let controlEncoderDescriptorBytes: Buffer | undefined;
  let serialDist: string | undefined;
  if (serial) {
    controlEncoderDescriptorBytes = readFileSync(
      new URL(
        '../../import/runtime-manifests/encoder-stream/417811d879ac9ef5a8714f38a453571d86e7168047e3d22b7d809b74905bf468/manifest.json',
        import.meta.url,
      ),
    );
    const pin = digest(controlEncoderDescriptorBytes);
    const path = `encoder-stream/${pin}/manifest.json`;
    encoderManifests.set(path, controlEncoderDescriptorBytes.toString('utf8'));
    encoderStream = {
      url: `https://next.facemorph.me/runtime/${path}`,
      sha256: pin,
      size: controlEncoderDescriptorBytes.length,
    };
    serialDist = join(temporary, 'serial');
    mkdirSync(serialDist);
    // Small valid unshared memory32 module; synthetic bytes never stand in for production qualification.
    const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 5, 5, 1, 1, 1, 128, 32]);
    for (const file of SERIAL_ORT_FILES)
      writeFileSync(
        join(serialDist, file),
        file.endsWith('.wasm') ? wasm : `synthetic serial ${file}`,
      );
    overlay = withSerialCompanion(
      overlay,
      generateSerialCompanion(
        serialDist,
        {
          version: '1.30.0',
          source: {
            repository: 'https://github.com/microsoft/onnxruntime.git',
            tag: 'v1.30.0',
            commit: 'f2c39fe2f838cf35ce7da92824f5a5e3ee6e88a7',
          },
          toolchain: {
            emsdkVersion: '4.0.23',
            emsdkCommit: 'c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56',
          },
          commandSha256: digest('fixture command'),
          linkReceiptSha256: digest('fixture link'),
        },
        controlEncoderDescriptorBytes,
      ),
    );
  }
  const asset = (name: string) => ({
    url: `https://next.facemorph.me/runtime/assets/frozen/${name}`,
    sha256: digest(name),
    size: 1,
  });
  const control = {
    schemaVersion: 1,
    modelSourceSha256: digest('frozen model'),
    mapping: asset('model.onnx'),
    runtime: {
      version: '1.24.3',
      moduleUrl: asset('ort.wasm.min.mjs').url,
      wasmPaths: 'https://next.facemorph.me/runtime/assets/frozen/',
      assets: [
        asset('ort.wasm.min.mjs'),
        asset('ort-wasm-simd-threaded.mjs'),
        asset('ort-wasm-simd-threaded.wasm'),
      ],
    },
    webgpu: {
      runtime: {
        version: '1.22.0',
        module: asset('ort.min.mjs'),
        factory: asset('ort-wasm-simd-threaded.jsep.mjs'),
        wasm: asset('ort-wasm-simd-threaded.jsep.wasm'),
      },
    },
    reference: { sha256: digest('frozen numerical reference') },
    encoderStream,
  };
  const controlBytes = JSON.stringify(control);
  const tolerance = 'export const tolerance = 0.0001;\n';
  const policy: DependencyPolicy = {
    schema: 'facemorph.dependency-policy/1',
    activeNodeMajor: 24,
    updater: 'dependabot',
    reason: 'fixture',
    groups: Object.fromEntries(
      ['build-tools', 'react-and-ui', 'onnx-runtime', 'test-tools'].map((group) => [
        group,
        { patterns: ['*'], requiredChecks: [`${group} / check`] },
      ]),
    ),
    excludedPaths: ['classic/**', 'self-host/**'],
    toleranceFiles: { 'src/numerics.ts': digest(tolerance) },
    requiredJobs: { '.github/workflows/gate.yml': ['matrix'] },
    requiredMatrices: {
      '.github/workflows/gate.yml': { matrix: { engine: ['chromium', 'firefox', 'webkit'] } },
    },
    planRevision: null,
  };
  const files: Record<string, unknown> = {
    'package.json': {
      name: 'fixture',
      private: true,
      engines: { node: '24.x' },
      workspaces: ['packages/*'],
      dependencies: { '@fixture/manager': 'workspace:*' },
      devDependencies: { vite: '^8.3.5' },
    },
    'packages/manager/package.json': {
      name: '@fixture/manager',
      dependencies: { onnxruntimeWeb: 'file:../vendored' },
      devDependencies: { 'onnxruntime-web': '^1.30.0' },
    },
    'package-lock.json': {
      packages: { '': { version: '0.0.0' }, 'node_modules/onnxruntime-web': locked },
    },
    'tools/browser/requirements.txt': 'browser-harness==0.1.8\n',
    [policyPath]: policy,
    '.github/workflows/gate.yml':
      'jobs:\n  matrix:\n    steps: [{run: real-tests}]\n    strategy:\n      matrix:\n        engine: [chromium, firefox, webkit]\n',
    'src/numerics.ts': tolerance,
    'src/app.ts': 'export const behavior = true;\n',
    'PLAN.md': '| Date | Decision |\n',
    'import/build-inputs.json': { runtime: { manifest: { sha256: digest(controlBytes) } } },
    [`import/runtime-manifests/control/${digest(controlBytes)}/manifest.json`]: controlBytes,
    'import/runtime-mirror.json': overlay,
    'self-host/package.json': { dependencies: { frozen: '1.0.0' }, engines: { node: '22' } },
  };
  for (const [path, value] of Object.entries(files)) write(path, value);
  for (const [path, bytes] of encoderManifests) {
    files[`import/runtime-manifests/${path}`] = bytes;
    write(`import/runtime-manifests/${path}`, bytes);
  }
  mkdirSync(artifact);
  for (const [path, bytes] of encoderManifests) {
    mkdirSync(dirname(join(artifact, path)), { recursive: true });
    writeFileSync(join(artifact, path), bytes);
  }
  for (const file of overlay.files) {
    mkdirSync(dirname(join(artifact, file.path)), { recursive: true });
    writeFileSync(join(artifact, file.path), readFileSync(join(dist, file.file)));
  }
  const composed = composeManifest(
    control,
    overlay,
    'https://next.facemorph.me',
    controlEncoderDescriptorBytes === undefined ? {} : { controlEncoderDescriptorBytes },
  ) as Record<string, unknown> & { encoderStream: typeof encoderStream };
  if (overlay.schema === 'facemorph.ort-mirror/2' && serialDist && controlEncoderDescriptorBytes) {
    for (const file of overlay.serial.files) {
      mkdirSync(dirname(join(artifact, file.path)), { recursive: true });
      writeFileSync(join(artifact, file.path), readFileSync(join(serialDist, file.file)));
    }
    const descriptor = composeEncoderDescriptor(
      controlEncoderDescriptorBytes,
      overlay.serial,
      'https://next.facemorph.me',
    );
    mkdirSync(dirname(join(artifact, descriptor.path)), { recursive: true });
    writeFileSync(join(artifact, descriptor.path), descriptor.bytes);
  }
  writeFileSync(join(artifact, 'manifest.json'), JSON.stringify(composed));
  git(['init', '--quiet']);
  git(['add', '--', ...Object.keys(files)]);
  git(['commit', '--quiet', '-m', 'trusted fixture']);
  const base = git(['rev-parse', 'HEAD']);
  const commit = (paths: string[]) => {
    git(['add', '--', ...paths]);
    git(['commit', '--quiet', '-m', 'candidate fixture']);
    return git(['rev-parse', 'HEAD']);
  };
  const report = (options: Partial<CurrencyOptions> = {}) =>
    checkDependencyCurrency(
      { base, head: base, lane: 'stable', runtimeDir: artifact, ...options },
      repo,
    );
  return {
    repo,
    artifact,
    base,
    policy,
    files,
    overlay,
    composed,
    encoderStream,
    controlEncoderDescriptorBytes,
    write,
    git,
    commit,
    report,
  };
}

test('exact Git snapshots and a complete composed CPU/WebGPU artifact pass despite dirty checkout mutations', (t) => {
  const f = fixture(t);
  f.write('package.json', { engines: { node: '>=26' }, dependencies: { vite: '8.0.0' } });
  f.write(policyPath, {});
  const result = f.report();
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.equal(result.manifests, 2);
  assert.equal(result.lockfiles, 1);
});

test('serial adoption is verified from immutable base descriptor and all three actual runtime assets', (t) => {
  const f = fixture(t, '1.24.3', undefined, true);
  // Neither dirty trusted-descriptor files nor dirty mirror metadata may supply evidence.
  f.write('import/runtime-mirror.json', {});
  f.write(
    `import/runtime-manifests/${new URL(f.encoderStream.url).pathname.slice('/runtime/'.length)}`,
    '{}',
  );
  const result = f.report();
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.equal(f.composed.encoderStream.sha256 === f.encoderStream.sha256, false);
});

test('serial adoption refuses corrupted or missing actual modules, factories and WASM', (t) => {
  for (const index of [0, 1, 2]) {
    const f = fixture(t, '1.24.3', undefined, true);
    assert.equal(f.overlay.schema, 'facemorph.ort-mirror/2');
    if (f.overlay.schema !== 'facemorph.ort-mirror/2') throw new Error('missing serial fixture');
    const file = f.overlay.serial.files[index]!;
    writeFileSync(join(f.artifact, file.path), Buffer.alloc(file.size, 42));
    const result = f.report();
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.message.includes('digest or size mismatch')));
    rmSync(join(f.artifact, file.path));
    assert.equal(f.report().ok, false, 'missing actual asset also fails');
  }
});

test('a self-consistent forged memory receipt loses to the actual WASM declaration', (t) => {
  const f = fixture(t, '1.24.3', undefined, true);
  if (f.overlay.schema !== 'facemorph.ort-mirror/2' || !f.controlEncoderDescriptorBytes)
    throw new Error('missing serial fixture');
  const old = f.overlay.serial;
  const memory = { ...old.memory, maximumPages: 2048 };
  const bundleSha256 = digest(
    JSON.stringify({
      schema: old.schema,
      controlDescriptorSha256: old.controlDescriptorSha256,
      build: old.build,
      memory,
      files: old.files.map(({ file, sha256, size }) => ({ file, sha256, size })),
    }),
  );
  const serial = {
    ...old,
    memory,
    bundleSha256,
    files: old.files.map((file) => ({ ...file, path: `assets/${bundleSha256}/${file.file}` })),
  };
  const overlay = withSerialCompanion(f.overlay, serial);
  for (const [i, file] of serial.files.entries()) {
    mkdirSync(dirname(join(f.artifact, file.path)), { recursive: true });
    writeFileSync(join(f.artifact, file.path), readFileSync(join(f.artifact, old.files[i]!.path)));
  }
  const descriptor = composeEncoderDescriptor(
    f.controlEncoderDescriptorBytes,
    serial,
    'https://next.facemorph.me',
  );
  mkdirSync(dirname(join(f.artifact, descriptor.path)), { recursive: true });
  writeFileSync(join(f.artifact, descriptor.path), descriptor.bytes);
  writeFileSync(
    join(f.artifact, 'manifest.json'),
    JSON.stringify({
      ...f.composed,
      encoderStream: { ...f.composed.encoderStream, ...descriptor.asset },
    }),
  );
  f.write('import/runtime-mirror.json', overlay);
  const head = f.commit(['import/runtime-mirror.json']);
  const result = f.report({ head });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.message.includes('memory declarations differ')));
});

test('a self-consistent replacement encoder descriptor cannot alter frozen steps or references', (t) => {
  const f = fixture(t, '1.24.3', undefined, true);
  const reference = f.composed.encoderStream;
  const descriptorPath = new URL(reference.url).pathname.slice('/runtime/'.length);
  const descriptor = JSON.parse(readFileSync(join(f.artifact, descriptorPath), 'utf8'));
  descriptor.steps[0].sha256 = digest('changed frozen shard');
  const bytes = JSON.stringify(descriptor);
  const replacementPath = `encoder-stream/${digest(bytes)}/manifest.json`;
  mkdirSync(dirname(join(f.artifact, replacementPath)), { recursive: true });
  writeFileSync(join(f.artifact, replacementPath), bytes);
  writeFileSync(
    join(f.artifact, 'manifest.json'),
    JSON.stringify({
      ...f.composed,
      encoderStream: {
        ...reference,
        url: `https://next.facemorph.me/runtime/${replacementPath}`,
        sha256: digest(bytes),
        size: Buffer.byteLength(bytes),
      },
    }),
  );
  assert.ok(f.report().violations.some((v) => v.code === 'ort-composition-mismatch'));
  // Altering the expected on-disk descriptor itself also loses to trusted-base composition.
  writeFileSync(join(f.artifact, descriptorPath), bytes);
  assert.ok(
    f.report().violations.some((v) => v.message.includes('not exactly the trusted control')),
  );
});

test('a candidate cannot redefine the base descriptor to bless changed encoder model fields', (t) => {
  const f = fixture(t, '1.24.3', undefined, true);
  const path = `import/runtime-manifests/${new URL(f.encoderStream.url).pathname.slice('/runtime/'.length)}`;
  f.write(path, '{}');
  const head = f.commit([path]);
  const result = f.report({ head });
  assert.equal(result.ok, true, 'candidate descriptor edits never replace immutable base bytes');
});

test('an overlay label alone cannot claim adopted ORT equality with frozen CPU or WebGPU', (t) => {
  const f = fixture(t);
  const result = checkDependencyCurrency({ base: f.base, head: f.base, lane: 'stable' }, f.repo);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.code === 'runtime-artifact-required'));
  const mismatch = result.violations.filter((v) => v.code === 'ort-adopted-version-mismatch');
  assert.equal(mismatch.length, 2);
  assert.ok(mismatch.some((v) => v.message.includes('cpu runtime is 1.24.3')));
  assert.ok(mismatch.some((v) => v.message.includes('webgpu runtime is 1.22.0')));
});

test('candidate composition cannot alter a frozen model/reference field or retain the old WebGPU version', (t) => {
  const f = fixture(t);
  for (const changed of [
    { ...f.composed, reference: { sha256: digest('weakened reference') } },
    { ...f.composed, webgpu: { runtime: { version: '1.22.0' } } },
  ]) {
    writeFileSync(join(f.artifact, 'manifest.json'), JSON.stringify(changed));
    assert.ok(f.report().violations.some((v) => v.code === 'ort-composition-mismatch'));
  }
});

test('changed artifact bytes fail independent digest verification', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.artifact, f.overlay.files[0]!.path), 'corrupt runtime bytes');
  assert.ok(f.report().violations.some((v) => v.code === 'ort-digest-mismatch'));
});

test('top-level ORT adoption cannot hide the preserved encoder stream old runtime and bounded memory contract', (t) => {
  const f = fixture(t, '1.24.3');
  const result = f.report();
  assert.equal(result.ok, false);
  assert.ok(
    result.violations.some(
      (v) => v.code === 'ort-encoder-version-mismatch' && v.message.includes('1.24.3'),
    ),
  );
  assert.equal(
    result.violations.some((v) => v.code === 'ort-composition-mismatch'),
    false,
    'top-level composition alone remains valid',
  );
  const path = join(f.artifact, new URL(f.encoderStream.url).pathname.slice('/runtime/'.length));
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(manifest.runtime.unshared, true);
  assert.equal(manifest.runtime.maxWasmBytes, 268435456);
  assert.equal(manifest.runtime.memoryReceipt.newMaximumPages, 4096);
});

test('recursive encoder references are checked and a corrupted actual encoder manifest cannot vouch for itself', (t) => {
  const f = fixture(t, '1.30.0', '1.24.3');
  assert.ok(
    f
      .report()
      .violations.some(
        (v) => v.code === 'ort-encoder-version-mismatch' && v.message.includes('1.24.3'),
      ),
  );
  const path = join(f.artifact, new URL(f.encoderStream.url).pathname.slice('/runtime/'.length));
  writeFileSync(path, JSON.stringify({ runtime: { version: '1.30.0' } }));
  assert.ok(
    f
      .report()
      .violations.some(
        (v) => v.code === 'ort-encoder-manifest-invalid' && v.message.includes('digest'),
      ),
  );
});

test('an updater group may edit inventoried manifests and requirement files but cannot edit source', (t) => {
  const f = fixture(t);
  f.write('tools/browser/requirements.txt', 'browser-harness==0.2.0\n');
  const head = f.commit(['tools/browser/requirements.txt']);
  assert.equal(f.report({ head, group: 'test-tools' }).ok, true);
  f.write('src/app.ts', 'export const behavior = false;\n');
  const sourceHead = f.commit(['src/app.ts']);
  const result = f.report({ head: sourceHead, group: 'test-tools' });
  assert.ok(result.violations.some((v) => v.code === 'updater-path' && v.path === 'src/app.ts'));
  assert.deepEqual(result.requiredChecks, ['test-tools / check']);
});

test('frozen classic/self-host remains out of audit scope but cannot be edited by an updater', (t) => {
  const f = fixture(t);
  assert.equal(f.report().ok, true);
  f.write('self-host/package.json', { dependencies: { frozen: '2.0.0' } });
  const head = f.commit(['self-host/package.json']);
  assert.ok(
    f.report({ head, group: 'build-tools' }).violations.some((v) => v.code === 'updater-path'),
  );
});

test('the trusted base tolerance and matrix survive candidate attempts to redefine their own policy', (t) => {
  const f = fixture(t);
  const widened = 'export const tolerance = 0.001;\n';
  f.write('src/numerics.ts', widened);
  const candidate = structuredClone(f.policy);
  candidate.toleranceFiles['src/numerics.ts'] = digest(widened);
  candidate.requiredMatrices['.github/workflows/gate.yml']!.matrix!.engine = [
    'chromium',
    'firefox',
  ];
  f.write(policyPath, candidate);
  f.write(
    '.github/workflows/gate.yml',
    'jobs:\n  matrix:\n    steps: [{run: real-tests}]\n    strategy:\n      matrix:\n        engine: [chromium, firefox]\n',
  );
  const head = f.commit(['src/numerics.ts', policyPath, '.github/workflows/gate.yml']);
  const result = f.report({ head });
  assert.ok(result.violations.some((v) => v.message.includes('frozen policy changed')));
  assert.ok(result.violations.some((v) => v.message.includes('tolerance digest changed')));
  assert.ok(
    result.violations.some((v) => v.message.includes('required cell matrix.engine removed')),
  );
});

test('stable audit includes nested lockfiles; bleeding-edge is a deliberate explicit lane', (t) => {
  const f = fixture(t);
  f.write('tools/browser/package-lock.json', {
    packages: { 'node_modules/tool': { version: '2.0.0-canary.1' } },
  });
  const head = f.commit(['tools/browser/package-lock.json']);
  const stable = f.report({ head });
  assert.ok(
    stable.violations.some(
      (v) => v.code === 'lock-prerelease' && v.path === 'tools/browser/package-lock.json',
    ),
  );
  assert.equal(f.report({ head, lane: 'bleeding-edge' }).ok, true);
});

test('CLI accepts only immutable revisions, the four groups and explicit known lane values', () => {
  const sha = 'a'.repeat(40);
  assert.equal(parseCurrencyArgs(['--base', sha, '--head', sha]).lane, 'stable');
  for (const extra of [
    ['--group', 'all'],
    ['--lane', 'canary'],
    ['--runtime-dir', ''],
  ])
    assert.throws(() => parseCurrencyArgs(['--base', sha, '--head', sha, ...extra]));
  assert.throws(() => parseCurrencyArgs(['--base', sha, '--head', 'HEAD']));
});

test('real CLI emits structured JSON and nonzero status for rejected source changes', (t) => {
  const f = fixture(t);
  const cli = fileURLToPath(new URL('./check-dependency-currency.ts', import.meta.url));
  const passing = spawnSync(
    process.execPath,
    [cli, '--base', f.base, '--head', f.base, '--runtime-dir', f.artifact],
    { cwd: f.repo, encoding: 'utf8' },
  );
  assert.equal(passing.status, 0, passing.stdout + passing.stderr);
  assert.equal(JSON.parse(passing.stdout).ok, true);
  f.write('src/app.ts', 'export const behavior = false;\n');
  const head = f.commit(['src/app.ts']);
  const result = spawnSync(
    process.execPath,
    [cli, '--base', f.base, '--head', head, '--group', 'build-tools', '--runtime-dir', f.artifact],
    { cwd: f.repo, encoding: 'utf8' },
  );
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, 'facemorph.dependency-currency/1');
  assert.equal(report.ok, false);
  assert.ok(report.violations.some((v: { code: string }) => v.code === 'updater-path'));
});
