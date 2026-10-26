// Self-test for check-tarball-contents.mjs (acceptance item package-tarball-content-scan.self-test, bead fm-3osh).
// Runs the script as a real subprocess on real planted inputs: .tgz files built with `tar -czf` and directories,
// both in os.tmpdir(). Planted files are inputs, not fakes; nothing is mocked. Secret-shaped strings are built by
// concatenation so this repository's own secret scanners do not flag this source.
//   node --test scripts/packages/check-tarball-contents.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PROFILES, dockerIgnored, evaluate, loadProfile } from './check-tarball-contents.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-tarball-contents.mjs');
const work = mkdtempSync(join(tmpdir(), 'tarball-scan-test-'));
after(() => rmSync(work, { recursive: true, force: true }));
let counter = 0;
const fresh = () => join(work, `case-${counter++}`);

const NPM_TOKEN = `${'npm'}_${'a1B2'.repeat(9)}`;
const CF_TOKEN = `${'CLOUDFLARE'}_API_${'TOKEN'}=${'x'.repeat(40)}`;
const AWS_KEY = `${'AK'}${'IA'}${'ABCDEFGHIJKLMNOP'}`;
const PRIVATE_KEY = `-----${'BEGIN'} RSA PRIVATE ${'KEY'}-----`;

const PKG_JSON = JSON.stringify({
  name: 'x',
  version: '0.0.0',
  exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
});
const packageBase = () => ({
  'package.json': PKG_JSON,
  'dist/index.js': 'export const a = 1;\n',
  'dist/index.d.ts': 'export declare const a: number;\n',
  LICENSE: 'MIT\n',
  'THIRD_PARTY_NOTICES.md': 'none\n',
  'PROVENANCE.json': '{"source":"test"}\n',
});
const contextBase = () => ({
  Dockerfile: 'FROM scratch\n',
  '.dockerignore': '*\n!Dockerfile\n!NOTICE.md\n!PROVENANCE.json\n!model_conv/\n',
  'NOTICE.md': 'notice\n',
  'PROVENANCE.json': '{"source":"test"}\n',
  'model_conv/run.py': 'print(1)\n',
});
const baseFor = (profile) => (profile === 'model-conv-context' ? contextBase() : packageBase());

function plant(dir, files) {
  for (const [p, content] of Object.entries(files)) {
    if (content === null) continue;
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
}

// Builds a tarball with the npm layout (everything under package/).
function tarball(files) {
  const root = fresh();
  plant(join(root, 'package'), files);
  const out = `${root}.tgz`;
  const r = spawnSync('tar', ['-czf', out, '-C', root, 'package'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return out;
}

function directory(files) {
  const dir = fresh();
  plant(dir, files);
  return dir;
}

function run(profile, input) {
  const report = `${fresh()}-report.json`;
  const r = spawnSync(
    process.execPath,
    [SCRIPT, '--profile', profile, '--input', input, '--report', report],
    {
      encoding: 'utf8',
    },
  );
  let json = null;
  try {
    json = JSON.parse(readFileSync(report, 'utf8'));
  } catch {
    // no report on usage errors
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, report: json };
}

const scan = (profile, files) =>
  run(profile, profile === 'model-conv-context' ? directory(files) : tarball(files));

// Exact public/compatibility text from the manager's emitted package. These are planted tarball inputs,
// not a hostname/name allowlist: mutations and the same text outside its documented file scope must fail.
const managerPublic = {
  'dist/cache/model-cache.js': `export const MODEL_CACHE_NAME = 'checkface-model-blobs-v1';
// When a mirror is known (models.facemorph.me, R2: separate storage), retry it.
const origin = typeof location === 'object' ? location.origin : 'https://next.facemorph.me';
const headers = { 'X-CheckFace-SHA256': asset.sha256 };\n`,
  'dist/cache/model-cache.d.ts':
    'export declare const MODEL_CACHE_NAME = "checkface-model-blobs-v1";\n',
  'dist/cache/shard-store.js': "export const SHARD_DIRECTORY = 'checkface-model-shards-v1';\n",
  'dist/cache/shard-store.d.ts':
    'export declare const SHARD_DIRECTORY = "checkface-model-shards-v1";\n',
  'dist/contracts/lifecycle.js': '// (checkface-model-blobs-v1) stays compatible.\n',
  'dist/contracts/manifest.js':
    '// Shape (the candidate runtime manifest, next.facemorph.me /runtime/manifest.json, SHA-256 d9e37e50…).\n',
  'schema/model-manifest.v1.schema.json': JSON.stringify({
    $id: 'https://github.com/facemorph-me/facemorph.me/blob/main/packages/browser-model-manager/schema/model-manifest.v1.schema.json',
  }),
};

describe('clean fixtures pass', () => {
  for (const profile of PROFILES) {
    test(profile, () => {
      const r = scan(profile, baseFor(profile));
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(r.report.outcome, 'clean');
      assert.deepEqual(r.report.findings, []);
      assert.deepEqual(r.report.requiredMissing, []);
    });
  }

  test('cloudflare-model-host README may name FaceMorph origins as an example', () => {
    const r = scan('cloudflare-model-host', {
      ...packageBase(),
      'README.md':
        'Example origin: https://models.facemorph.me/ and bucket_name "facemorph-diagnostics".\n',
    });
    assert.equal(r.status, 0, r.stdout);
  });

  test('stylegan-js may ship its persisted canary receipt schema name (provenanceAllow)', () => {
    const r = scan('stylegan-js', {
      ...packageBase(),
      'dist/canary.js':
        'export const CANARY_RECORD_SCHEMA = "checkface-canary-qualification-v1";\n',
      'dist/canary.d.ts':
        'export declare const CANARY_RECORD_SCHEMA = "checkface-canary-qualification-v1";\n',
    });
    assert.equal(r.status, 0, r.stdout);
  });

  test('package.json may name the source repository; the same URL elsewhere is still a finding (fm-19eb)', () => {
    const withRepository = JSON.stringify({
      ...JSON.parse(PKG_JSON),
      repository: {
        type: 'git',
        url: 'git+https://github.com/facemorph-me/facemorph.me.git',
        directory: 'packages/p',
      },
      homepage: 'https://github.com/facemorph-me/facemorph.me/tree/main/packages/p#readme',
      bugs: { url: 'https://github.com/facemorph-me/facemorph.me/issues' },
    });
    for (const profile of ['stylegan-js', 'browser-model-manager', 'cloudflare-model-host']) {
      const ok = scan(profile, { ...packageBase(), 'package.json': withRepository });
      assert.equal(ok.status, 0, `${profile}: ${ok.stdout}`);
      const elsewhere = scan(profile, {
        ...packageBase(),
        'package.json': withRepository,
        'dist/index.js': 'export const home = "facemorph.me";\n',
      });
      assert.equal(elsewhere.status, 1, `${profile}: ${elsewhere.stdout}`);
    }
  });

  test('manager classifies its exact public defaults, schema ID and compatible storage identities', () => {
    const r = scan('browser-model-manager', { ...packageBase(), ...managerPublic });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.report.findings, []);
  });

  test('an oversize runtime .wasm is on the allowlist', () => {
    const r = scan('stylegan-js', {
      ...packageBase(),
      'dist/rt.wasm': Buffer.alloc(6 * 1024 * 1024, 1),
    });
    assert.equal(r.status, 0, r.stdout);
  });

  test('npm layout: package/ prefix is stripped from report paths', () => {
    const r = scan('stylegan-js', packageBase());
    assert.ok(r.report.files.every((f) => !f.path.startsWith('package/')));
    assert.ok(r.report.files.some((f) => f.path === 'dist/index.js'));
  });
});

describe('manager public classifications do not admit private near misses', () => {
  const cache = 'dist/cache/model-cache.js';
  const contract = 'dist/contracts/manifest.js';
  const schema = 'schema/model-manifest.v1.schema.json';
  const misses = [
    ['storage suffix', cache, managerPublic[cache].replace('blobs-v1', 'blobs-v1-private')],
    ['storage private host', cache, managerPublic[cache].replace('blobs-v1', 'blobs-v1.internal')],
    ['storage private path', cache, managerPublic[cache].replace('blobs-v1', 'blobs-v1/private')],
    [
      'storage Windows path',
      cache,
      managerPublic[cache].replace('blobs-v1', 'blobs-v1\\\\private'),
    ],
    ['storage query suffix', cache, managerPublic[cache].replace('blobs-v1', 'blobs-v1?private')],
    ['storage prefix', cache, managerPublic[cache].replace('checkface-', 'private-checkface-')],
    ['shard suffix', 'dist/cache/shard-store.js', "const x = 'checkface-model-shards-v1-private';"],
    [
      'header suffix',
      cache,
      managerPublic[cache].replace('X-CheckFace-SHA256', 'X-CheckFace-SHA256-private'),
    ],
    [
      'header private path',
      cache,
      managerPublic[cache].replace('X-CheckFace-SHA256', 'X-CheckFace-SHA256/private'),
    ],
    [
      'header different context',
      cache,
      managerPublic[cache].replace('asset.sha256', 'privateMetadata'),
    ],
    ['wrong file', 'dist/private.js', managerPublic[cache]],
    [
      'mirror private host',
      cache,
      managerPublic[cache].replace('models.facemorph.me', 'private.models.facemorph.me'),
    ],
    [
      'mirror suffix',
      cache,
      managerPublic[cache].replace('models.facemorph.me', 'models.facemorph.me.private'),
    ],
    [
      'mirror private path',
      cache,
      managerPublic[cache].replace('models.facemorph.me', 'models.facemorph.me/private'),
    ],
    [
      'default private host',
      cache,
      managerPublic[cache].replace('https://next.', 'https://private.next.'),
    ],
    [
      'default suffix',
      cache,
      managerPublic[cache].replace(
        'https://next.facemorph.me',
        'https://next.facemorph.me.private',
      ),
    ],
    [
      'default private path',
      cache,
      managerPublic[cache].replace(
        'https://next.facemorph.me',
        'https://next.facemorph.me/private',
      ),
    ],
    ['contract private host', contract, managerPublic[contract].replace('next.', 'private.next.')],
    [
      'contract private path',
      contract,
      managerPublic[contract].replace('/runtime/', '/private/runtime/'),
    ],
    [
      'schema private path',
      schema,
      managerPublic[schema].replace('/blob/main/', '/blob/main/private/'),
    ],
    [
      'schema private host',
      schema,
      managerPublic[schema].replace(
        new URL(JSON.parse(managerPublic[schema]).$id).hostname,
        'private.facemorph.me',
      ),
    ],
    ['other private reference', cache, managerPublic[cache] + '\n// ported from checkface\n'],
  ];
  for (const [name, file, content] of misses) {
    test(name, () => {
      const r = scan('browser-model-manager', {
        ...packageBase(),
        ...managerPublic,
        [file]: content,
      });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.ok(r.report.findings.some((f) => f.rule === 'private-provenance' && f.path === file));
    });
  }

  for (const [name, mutation, rule] of [
    [
      'secret',
      { 'dist/cache/model-cache.js': managerPublic[cache] + `\n// ${NPM_TOKEN}\n` },
      'secret-npm-token',
    ],
    [
      'absolute private path',
      { 'dist/cache/model-cache.js': managerPublic[cache] + '\nconst p = "/home/private/repo";\n' },
      'absolute-path',
    ],
    ['repository path', { 'apps/private.js': managerPublic[cache] }, 'repository-path'],
    ['weights', { 'dist/model.onnx': 'not really onnx' }, 'weights-extension'],
    ['required licence', { LICENSE: null }, 'required-file'],
  ]) {
    test(`classification preserves ${name} rejection`, () => {
      const r = scan('browser-model-manager', { ...packageBase(), ...managerPublic, ...mutation });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.ok(r.report.findings.some((f) => f.rule === rule));
    });
  }
});

describe('report shape', () => {
  test('all contract keys are present', () => {
    const r = scan('stylegan-js', packageBase());
    assert.deepEqual(Object.keys(r.report).sort(), [
      'files',
      'findings',
      'input',
      'inputSha256',
      'outcome',
      'profile',
      'requiredMissing',
      'scanVersion',
    ]);
    assert.equal(r.report.scanVersion, 1);
    assert.match(r.report.inputSha256, /^[0-9a-f]{64}$/);
    for (const f of r.report.files) {
      assert.deepEqual(Object.keys(f).sort(), ['bytes', 'path', 'sha256']);
    }
  });

  test('finding entries carry rule, path and detail', () => {
    const r = scan('stylegan-js', { ...packageBase(), 'dist/m.onnx': 'x' });
    for (const f of r.report.findings)
      assert.deepEqual(Object.keys(f).sort(), ['detail', 'path', 'rule']);
  });

  test('directory input digest is stable and content-sensitive', () => {
    const files = contextBase();
    const a = run('model-conv-context', directory(files));
    const b = run('model-conv-context', directory(files));
    const c = run('model-conv-context', directory({ ...files, 'model_conv/run.py': 'print(2)\n' }));
    assert.equal(a.report.inputSha256, b.report.inputSha256);
    assert.notEqual(a.report.inputSha256, c.report.inputSha256);
  });
});

// One planted fixture per rule class: each must exit 1 with the expected rule in the report.
const bad = [
  // shared rules
  ['weights-extension', 'stylegan-js', { 'dist/model.onnx': 'not really onnx' }],
  ['weights-extension', 'stylegan-js', { 'dist/w.safetensors': 'x' }],
  ['oversize-file', 'stylegan-js', { 'dist/big.dat': Buffer.alloc(6 * 1024 * 1024, 1) }],
  ['repository-path', 'stylegan-js', { 'apps/web/index.js': 'x' }],
  ['repository-path', 'stylegan-js', { 'docs/receipts/r.md': 'x' }],
  ['repository-path', 'stylegan-js', { 'test/fixtures/a.json': '{}' }],
  [
    'sourcemap-outside',
    'stylegan-js',
    { 'dist/index.js.map': JSON.stringify({ version: 3, sources: ['../../../elsewhere/a.ts'] }) },
  ],
  [
    'sourcemap-outside',
    'stylegan-js',
    { 'dist/index.js.map': JSON.stringify({ version: 3, sources: ['../src/index.ts'] }) },
  ],
  [
    'sourcemap-outside',
    'stylegan-js',
    { 'dist/index.js': 'export const a = 1;\n//# sourceMappingURL=/abs/index.js.map\n' },
  ],
  ['sourcemap-outside', 'stylegan-js', { 'dist/index.js.map': 'not a source map' }],
  ['absolute-path', 'stylegan-js', { 'dist/p.js': 'export const p = "/home/someone/work";\n' }],
  [
    'absolute-path',
    'stylegan-js',
    { 'dist/p.js': 'import x from "../facemorph.me-classic/a.js";\n' },
  ],
  ['absolute-path', 'stylegan-js', { 'dist/p.js': 'export const u = "file:///tmp/x";\n' }],
  ['absolute-path', 'stylegan-js', { 'dist/p.d.ts': '// /Users/someone/x\nexport {};\n' }],
  ['secret-npm-token', 'stylegan-js', { 'dist/s.js': `export const t = "${NPM_TOKEN}";\n` }],
  ['secret-cloudflare-token', 'stylegan-js', { 'dist/s.js': `// ${CF_TOKEN}\n` }],
  ['secret-private-key', 'stylegan-js', { 'dist/k.txt': `${PRIVATE_KEY}\nabc\n` }],
  ['secret-aws-key', 'stylegan-js', { 'dist/s.js': `export const k = "${AWS_KEY}";\n` }],
  ['secret-env-file', 'stylegan-js', { '.env': 'A=1\n' }],
  ['secret-npmrc-auth', 'stylegan-js', { '.npmrc': `//registry.npmjs.org/:_authToken=abc\n` }],
  ['private-provenance', 'stylegan-js', { 'dist/o.js': 'export const o = "next.facemorph.me";\n' }],
  [
    'private-provenance',
    'stylegan-js',
    { 'dist/o.js': 'export const o = "x.cdilga.workers.dev";\n' },
  ],
  ['private-provenance', 'stylegan-js', { 'dist/o.js': '// ported from checkface\n' }],
  [
    'private-provenance',
    'stylegan-js',
    { 'dist/o.js': 'const bucket_name = "facemorph-diagnostics";\n' },
  ],
  [
    'private-provenance',
    'stylegan-js',
    {
      'dist/o.js': 'const cfg = { bucket: "facemorph-models" };\n'.replace(
        'bucket:',
        'bucket_name:',
      ),
    },
  ],
  [
    'private-provenance',
    'stylegan-js',
    {
      'dist/canary.js':
        'export const S = "checkface-canary-qualification-v1"; // ported from checkface\n',
    },
  ],
  ['required-file', 'stylegan-js', { 'dist/index.d.ts': null }],
  [
    'required-file',
    'stylegan-js',
    {
      'package.json': JSON.stringify({
        name: 'x',
        exports: {
          '.': { types: './dist/index.d.ts', default: './dist/index.js' },
          './engine': { types: './dist/engine/index.d.ts', default: './dist/engine/index.js' },
        },
      }),
    },
  ],
  ['required-file', 'stylegan-js', { 'dist/index.js': null }],
  ['required-file', 'stylegan-js', { LICENSE: null }],
  ['required-file', 'stylegan-js', { 'THIRD_PARTY_NOTICES.md': null }],
  ['required-file', 'stylegan-js', { 'PROVENANCE.json': null }],
  [
    'required-file',
    'cloudflare-model-host',
    {
      'package.json': JSON.stringify({
        name: 'x',
        exports: { '.': './dist/index.js', './worker': { default: './dist/worker.js' } },
      }),
    },
  ],
  // profile rules
  [
    'profile-stylegan-js-host-url',
    'stylegan-js',
    { 'dist/u.js': 'fetch("https://models.example.org/w");\n' },
  ],
  [
    'profile-stylegan-js-opfs',
    'stylegan-js',
    { 'dist/o.js': 'await navigator.storage.getDirectory();\n' },
  ],
  [
    'profile-stylegan-js-cache-storage',
    'stylegan-js',
    { 'dist/o.js': 'await caches.open("m");\n' },
  ],
  [
    'profile-stylegan-js-dom-ui-import',
    'stylegan-js',
    { 'dist/o.js': 'import React from "react";\n' },
  ],
  [
    'profile-stylegan-js-reporting-transport',
    'stylegan-js',
    { 'dist/o.js': 'navigator.sendBeacon("/r", "x");\n' },
  ],
  [
    'profile-browser-model-manager-engine-code',
    'browser-model-manager',
    { 'dist/e.js': 'import * as ort from "onnxruntime-web";\n' },
  ],
  [
    'profile-browser-model-manager-engine-code',
    'browser-model-manager',
    { 'dist/e.js': 'new InferenceSession();\n' },
  ],
  [
    'profile-browser-model-manager-facemorph-catalogue',
    'browser-model-manager',
    { 'dist/c.json': '{"name":"FaceMorph catalogue"}\n' },
  ],
  [
    'profile-browser-model-manager-facemorph-catalogue-file',
    'browser-model-manager',
    { 'dist/facemorph-catalogue.json': '{}\n' },
  ],
  [
    'private-provenance',
    'browser-model-manager',
    { 'dist/h.js': 'const h = "models.facemorph.me";\n' },
  ],
  ['weights-extension', 'cloudflare-model-host', { 'dist/w.bin': 'x' }],
  [
    'profile-cloudflare-model-host-weights-dir',
    'cloudflare-model-host',
    { 'dist/models/a.json': '{}\n' },
  ],
  [
    'private-provenance',
    'cloudflare-model-host',
    { 'dist/h.js': 'export const o = "https://next.facemorph.me";\n' },
  ],
  ['private-provenance', 'cloudflare-model-host', { 'dist/h.json': '{"origin":"facemorph.me"}\n' }],
  ['profile-model-conv-context-checkpoint', 'model-conv-context', { 'weights/e4e.pt': 'x' }],
  ['profile-model-conv-context-checkpoint', 'model-conv-context', { 'weights/g.pkl': 'x' }],
  ['profile-model-conv-context-checkpoint', 'model-conv-context', { 'weights/g.ckpt': 'x' }],
  ['profile-model-conv-context-converted-output', 'model-conv-context', { 'out/m.onnx': 'x' }],
  ['profile-model-conv-context-converted-output', 'model-conv-context', { 'out/avg.f32': 'x' }],
  ['profile-model-conv-context-env-file', 'model-conv-context', { '.env': 'A=1\n' }],
  ['secret-env-file', 'model-conv-context', { '.env': 'A=1\n' }],
  ['profile-model-conv-context-credentials', 'model-conv-context', { 'credentials.json': '{}\n' }],
  ['required-file', 'model-conv-context', { '.dockerignore': null }],
  ['required-file', 'model-conv-context', { Dockerfile: null }],
  [
    'profile-model-conv-context-dockerignore-gap',
    'model-conv-context',
    { '.dockerignore': '.env\n' },
  ],
  [
    'profile-model-conv-context-dockerignore-gap',
    'model-conv-context',
    { '.dockerignore': '*.pkl\n' },
  ],
  ['repository-path', 'model-conv-context', { 'apps/x.py': 'x' }],
];

describe('planted bad fixtures fail with the expected rule', () => {
  for (const [rule, profile, mutation] of bad) {
    const label = `${profile}: ${rule} <- ${Object.keys(mutation).join(',')}`;
    test(label, () => {
      const files = { ...baseFor(profile), ...mutation };
      const r = scan(profile, files);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(r.report.outcome, 'findings');
      assert.ok(
        r.report.findings.some((f) => f.rule === rule),
        `expected ${rule}, got ${JSON.stringify(r.report.findings)}`,
      );
      if (rule === 'required-file') assert.ok(r.report.requiredMissing.length > 0);
    });
  }

  test('a secret is redacted in the report, not echoed', () => {
    const r = scan('stylegan-js', {
      ...packageBase(),
      'dist/s.js': `export const t = "${NPM_TOKEN}";\n`,
    });
    assert.ok(!JSON.stringify(r.report).includes(NPM_TOKEN));
  });

  test('an absolute or parent-relative tar entry is a finding, and nothing is extracted', () => {
    // A hand-written ustar archive: GNU tar refuses to create such names, a hostile tarball need not.
    const header = (name, size) => {
      const h = Buffer.alloc(512);
      h.write(name, 0, 100);
      h.write('0000644\0', 100);
      h.write('0000000\0', 108);
      h.write('0000000\0', 116);
      h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
      h.write('00000000000\0', 136);
      h.write('        ', 148);
      h.write('0', 156);
      h.write('ustar\0', 257);
      h.write('00', 263);
      let sum = 0;
      for (const byte of h) sum += byte;
      h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
      return h;
    };
    const entry = (name, text) => {
      const body = Buffer.from(text);
      const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
      return [header(name, body.length), body, pad];
    };
    for (const name of ['package/../escape.js', '/abs/escape.js']) {
      const out = `${fresh()}.tgz`;
      writeFileSync(
        out,
        gzipSync(
          Buffer.concat([
            ...entry('package/package.json', PKG_JSON),
            ...entry(name, 'x'),
            Buffer.alloc(1024),
          ]),
        ),
      );
      const r = run('stylegan-js', out);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.ok(
        r.report.findings.some((f) => f.rule === 'unsafe-entry' && f.path === name),
        JSON.stringify(r.report.findings),
      );
    }
  });

  test('a symlink in a directory input is a finding', () => {
    const dir = directory(contextBase());
    symlinkSync('/etc/hostname', join(dir, 'link'));
    const r = run('model-conv-context', dir);
    assert.equal(r.status, 1);
    assert.ok(r.report.findings.some((f) => f.rule === 'symlink-entry'));
  });

  test('every rule class has a fixture in this table', () => {
    const covered = new Set(bad.map((b) => b[0]));
    for (const rule of [
      'weights-extension',
      'oversize-file',
      'repository-path',
      'absolute-path',
      'sourcemap-outside',
      'secret-npm-token',
      'secret-cloudflare-token',
      'secret-private-key',
      'secret-aws-key',
      'secret-env-file',
      'secret-npmrc-auth',
      'private-provenance',
      'required-file',
    ]) {
      assert.ok(covered.has(rule), `no fixture for ${rule}`);
    }
    for (const name of PROFILES) {
      const p = loadProfile(name);
      const ids = [...(p.contentRules ?? []), ...(p.pathRules ?? [])].map(
        (r) => `profile-${name}-${r.id}`,
      );
      for (const id of ids) assert.ok(covered.has(id), `no fixture for ${id}`);
    }
  });
});

describe('usage errors exit 2', () => {
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  const input = () => tarball(packageBase());

  test('no arguments', () => assert.equal(cli().status, 2));
  test('unknown profile', () => {
    const report = `${fresh()}.json`;
    const r = cli('--profile', 'nope', '--input', input(), '--report', report);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown profile/);
  });
  test('path-like profile name is not a profile', () =>
    assert.equal(
      cli('--profile', '../x', '--input', input(), '--report', `${fresh()}.json`).status,
      2,
    ));
  test('missing --report', () =>
    assert.equal(cli('--profile', 'stylegan-js', '--input', input()).status, 2));
  test('missing --input', () =>
    assert.equal(cli('--profile', 'stylegan-js', '--report', `${fresh()}.json`).status, 2));
  test('missing --profile', () =>
    assert.equal(cli('--input', input(), '--report', `${fresh()}.json`).status, 2));
  test('unknown flag', () => assert.equal(cli('--bogus', 'x').status, 2));
  test('flag without value', () => assert.equal(cli('--profile').status, 2));
  test('input does not exist', () =>
    assert.equal(
      cli(
        '--profile',
        'stylegan-js',
        '--input',
        join(work, 'absent.tgz'),
        '--report',
        `${fresh()}.json`,
      ).status,
      2,
    ));
  test('input is not a tarball', () => {
    const f = `${fresh()}.tgz`;
    writeFileSync(f, 'not a tarball');
    assert.equal(
      cli('--profile', 'stylegan-js', '--input', f, '--report', `${fresh()}.json`).status,
      2,
    );
  });
});

describe('pure evaluation and profile data', () => {
  const file = (path, text) => ({ path, bytes: text.length, sha256: '0'.repeat(64), text });

  test('evaluate on plain values flags a weights extension and a missing LICENSE', () => {
    const profile = loadProfile('cloudflare-model-host');
    const { findings, requiredMissing } = evaluate({ profile, files: [file('dist/a.onnx', 'x')] });
    assert.ok(findings.some((f) => f.rule === 'weights-extension'));
    assert.ok(requiredMissing.includes('LICENSE'));
  });

  test('dockerignore: root-anchored globs and re-inclusion follow Docker semantics', () => {
    assert.equal(dockerIgnored(['*.pkl'], 'a.pkl'), true);
    assert.equal(dockerIgnored(['*.pkl'], 'sub/a.pkl'), false);
    assert.equal(dockerIgnored(['**/*.pkl'], 'sub/deep/a.pkl'), true);
    assert.equal(dockerIgnored(['*', '!Dockerfile'], 'Dockerfile'), false);
    assert.equal(dockerIgnored(['*', '!Dockerfile'], 'x/a.pkl'), true);
  });

  test('every profile file is complete and the shared sections are identical', () => {
    const shared = JSON.stringify(loadProfile(PROFILES[0]).shared);
    for (const name of PROFILES) {
      const p = loadProfile(name);
      assert.equal(p.profile, name);
      assert.equal(JSON.stringify(p.shared), shared, `${name} shared section drifted`);
      assert.ok(p.required.length > 0);
      assert.ok(['all', 'non-docs', 'none'].includes(p.provenanceScope));
    }
    assert.ok(loadProfile('stylegan-js').shared.r2BucketNames.includes('facemorph-diagnostics'));
  });
});
