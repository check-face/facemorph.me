// Self-test for check-notices.mjs (fm-oagi): every finding class fails on a planted input, the real model-conv build
// context is clean, and the CLI reads a real .tgz in the npm layout.
//   node --test scripts/packages/check-notices.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dockerfileSources, evaluateNotices, lockedPython, NOTICES } from './check-notices.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'notice-check-test-'));
after(() => rmSync(work, { recursive: true, force: true }));

const notices = {
  ownOrigins: '\\b(?:the candidate|classic)',
  ownPackages: ['own-pkg'],
  artifacts: {
    pkg: {
      noticeFile: 'THIRD_PARTY_NOTICES',
      components: [{ name: 'mt', files: ['^dist/rng\\.js$'], mentions: ['MT19937 notice'] }],
      notBundled: [{ name: 'ort', mentions: ['ORT is not bundled'] }],
    },
    ctx: {
      noticeFile: 'NOTICE.md',
      components: [],
      sources: [{ name: 'base', match: '^base:1@sha256:', mentions: ['base image'] }],
      python: [
        { name: 'torch', licence: 'BSD-3-Clause', metadata: 'BSD-3-Clause' },
        { name: 'pip', licence: 'MIT', metadata: 'MIT', base: true },
      ],
    },
  },
};
const pkgFiles = (extra = {}) =>
  Object.entries({
    'package.json': JSON.stringify({ name: 'p', dependencies: { 'own-pkg': '^1.0.0' } }),
    'dist/rng.js': '// MT19937, ported from the candidate\nexport {};\n',
    'dist/index.js': 'export {};\n',
    THIRD_PARTY_NOTICES: 'MT19937 notice\nORT is not bundled\n',
    LICENSE: 'MIT License\nCopyright (c) 2026 Someone\n',
    ...extra,
  })
    .filter(([, text]) => text !== null)
    .map(([path, text]) => ({ path, text }));
const ctxFiles = (extra = {}) =>
  Object.entries({
    Dockerfile: 'ARG BASE=base:1@sha256:abc\nFROM ${BASE}\nRUN true\n',
    'requirements.lock': 'torch==2.0 \\\n    --hash=sha256:00\n',
    'NOTICE.md': 'base image\n| torch | BSD-3-Clause |\n| pip | MIT |\n',
    ...extra,
  })
    .filter(([, text]) => text !== null)
    .map(([path, text]) => ({ path, text }));
const rules = (findings) => findings.map((f) => f.rule).sort();
const run = (profile, files, image) => evaluateNotices({ profile, files, image, notices });

test('a clean planted package and context pass', () => {
  assert.deepEqual(run('pkg', pkgFiles()), []);
  assert.deepEqual(
    run('ctx', ctxFiles(), [
      { name: 'torch', metadata: 'BSD-3-Clause' },
      { name: 'pip', metadata: 'MIT' },
    ]),
    [],
  );
});

const bad = [
  ['unclaimed-third-party', 'pkg', { 'dist/vendor/x.js': 'export {};\n' }],
  ['unclaimed-third-party', 'pkg', { 'dist/node_modules/x/index.js': 'export {};\n' }],
  ['unclaimed-third-party', 'pkg', { 'dist/x/LICENSE': 'text\n' }],
  ['unclaimed-third-party', 'pkg', { 'dist/a.js': '/*! Copyright (c) 2020 Other */\n' }],
  ['unclaimed-third-party', 'pkg', { 'dist/a.js': '// SPDX-License-Identifier: Apache-2.0\n' }],
  ['unclaimed-third-party', 'pkg', { 'dist/a.js': '// Ported from libfoo 1.2 (zlib licence).\n' }],
  ['unclaimed-third-party', 'pkg', { 'dist/a.js': '// Based on https://example.org/blur.c\n' }],
  ['unclaimed-third-party', 'pkg', { 'dist/a.js': '// Copied from [kernels](https://e.org/k)\n' }],
  ['stale-component', 'pkg', { 'dist/rng.js': null }],
  ['notice-missing-mention', 'pkg', { THIRD_PARTY_NOTICES: 'ORT is not bundled\n' }],
  ['notice-missing-mention', 'pkg', { THIRD_PARTY_NOTICES: 'MT19937 notice\n' }],
  ['notice-file-missing', 'pkg', { THIRD_PARTY_NOTICES: null }],
  [
    'dependency-not-mentioned',
    'pkg',
    { 'package.json': JSON.stringify({ name: 'p', dependencies: { leftpad: '^1.0.0' } }) },
  ],
  [
    'undeclared-bundled-dependency',
    'pkg',
    { 'package.json': JSON.stringify({ name: 'p', bundleDependencies: ['own-pkg'] }) },
  ],
  [
    'unlisted-source',
    'ctx',
    { Dockerfile: 'FROM base:1@sha256:abc\nADD https://e.org/x.tgz /x\n' },
  ],
  ['stale-source', 'ctx', { Dockerfile: 'FROM other:2\n' }],
  ['unlisted-python', 'ctx', { 'requirements.lock': 'torch==2.0\nnumpy==2.0\n' }],
  ['stale-python', 'ctx', { 'requirements.lock': 'pip==1\n' }],
  [
    'python-licence-missing',
    'ctx',
    { 'NOTICE.md': 'base image\n| torch | MIT |\n| pip | MIT |\n' },
  ],
];
for (const [rule, profile, extra] of bad) {
  test(`${rule}: ${JSON.stringify(extra).slice(0, 70)}`, () => {
    const findings = run(profile, profile === 'pkg' ? pkgFiles(extra) : ctxFiles(extra));
    assert.ok(rules(findings).includes(rule), JSON.stringify(findings));
  });
}

test('own-origin and runtime-behaviour wording is not third-party', () => {
  const findings = run(
    'pkg',
    pkgFiles({
      'dist/a.js':
        "// Ported from the candidate's png.mjs\n// copied from the upstream on first request, e.g. https://x/\n",
      'dist/b.d.ts': '/** The id is derived from these fields. */\n',
    }),
  );
  assert.deepEqual(findings, []);
});

test('--image: a package the image installs but no row lists, and a licence that differs', () => {
  const findings = run('ctx', ctxFiles(), [
    { name: 'torch', metadata: 'MIT' },
    { name: 'pip', metadata: 'MIT' },
    { name: 'wheel', metadata: 'MIT' },
  ]);
  assert.deepEqual(rules(findings), ['image-licence-mismatch', 'image-unlisted-python']);
});

test('parsers: Dockerfile sources with ARG defaults and continuations; lock names normalized', () => {
  assert.deepEqual(
    dockerfileSources(
      'ARG B=py:3@sha256:1\nARG R=abc\nFROM ${B}\nADD --checksum=sha256:0 \\\n  https://g/${R}.tar.gz /t\n',
    ),
    ['py:3@sha256:1', 'https://g/abc.tar.gz'],
  );
  assert.deepEqual(lockedPython('Jinja2==3 \\\n  --hash=x\ntyping_extensions==4\n'), [
    'jinja2',
    'typing-extensions',
  ]);
});

test('the real model-conv build context is clean against notices.json', () => {
  const r = spawnSync(
    process.execPath,
    [
      join(here, 'check-notices.mjs'),
      '--profile',
      'model-conv-context',
      '--input',
      join(here, '../../packages/model-conv'),
      '--report',
      join(work, 'ctx.json'),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(readFileSync(join(work, 'ctx.json'), 'utf8')).outcome, 'clean');
});

test('the CLI reads an npm-layout tarball and exits 1 on a finding, 2 on usage', () => {
  const root = join(work, 'tgz');
  const files = {
    'package/package.json': JSON.stringify({ name: 'cloudflare-model-host', dependencies: {} }),
    'package/THIRD_PARTY_NOTICES': 'none\n',
    'package/dist/vendor/x.js': 'export {};\n',
  };
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  const tgz = join(work, 'p.tgz');
  assert.equal(spawnSync('tar', ['-czf', tgz, '-C', root, 'package']).status, 0);
  const cli = (...a) =>
    spawnSync(process.execPath, [join(here, 'check-notices.mjs'), ...a], { encoding: 'utf8' });
  const r = cli(
    '--profile',
    'cloudflare-model-host',
    '--input',
    tgz,
    '--report',
    join(work, 'p.json'),
  );
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /unclaimed-third-party/);
  assert.equal(
    cli('--profile', 'nope', '--input', tgz, '--report', join(work, 'q.json')).status,
    2,
  );
  assert.ok(NOTICES.artifacts['stylegan-js']);
});
