import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkSync, mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { headersText } from './headers.mjs';
import { compareTrees, portedNotices, publicationReference, treeDigest } from './stage.mjs';
import { headersFor } from './headers.mjs';
import { responseFindings, checkResponses } from './check-headers.mjs';
import { serve } from '../../apps/web/test/support/serve.ts';
import { sha256 } from '../inventory/lib.mjs';

test('real staging never overwrites hard-linked frontend publication inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'fm-stage-inputs-'));
  try {
    const frontend = join(root, 'frontend');
    const runtime = join(root, 'runtime');
    mkdirSync(join(frontend, 'names'), { recursive: true });
    mkdirSync(runtime);
    const originals = {
      'index.html': '<html>candidate</html>',
      'names/index.html': '<html>old names route</html>',
      'catalogue.json': '{"old":true}',
      _headers: 'candidate headers',
      _redirects: 'candidate redirects',
    };
    for (const [path, bytes] of Object.entries(originals))
      writeFileSync(join(frontend, path), bytes);
    writeFileSync(join(root, 'catalogue.json'), '{"new":true}');
    execFileSync('python3', [
      'hosting/next-static/stage.py',
      '--runtime',
      runtime,
      '--frontend',
      frontend,
      '--catalogue',
      join(root, 'catalogue.json'),
      '--output',
      join(root, 'public'),
    ]);
    for (const [path, bytes] of Object.entries(originals))
      assert.equal(readFileSync(join(frontend, path), 'utf8'), bytes, path);
    assert.equal(readFileSync(join(root, 'public/_headers'), 'utf8'), headersText());
    assert.equal(readFileSync(join(root, 'public/catalogue.json'), 'utf8'), '{"new":true}');
    assert.equal(
      readFileSync(join(root, 'public/names/index.html'), 'utf8'),
      originals['index.html'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the next/notices overlay never writes through a hard link into the acquired runtime', () => {
  const root = mkdtempSync(join(tmpdir(), 'fm-stage-notices-'));
  try {
    const frontend = join(root, 'frontend');
    const runtime = join(root, 'runtime');
    const store = join(root, 'store');
    mkdirSync(frontend);
    mkdirSync(join(runtime, 'notices'), { recursive: true });
    mkdirSync(store);
    writeFileSync(join(frontend, 'index.html'), '<html>candidate</html>');
    // The acquired notice, hard-linked as a content-addressed mirror links it.
    const frozen = '<html>frozen notice</html>';
    writeFileSync(join(store, 'notice'), frozen);
    linkSync(join(store, 'notice'), join(runtime, 'notices/index.html'));
    writeFileSync(join(root, 'catalogue.json'), '{}');
    execFileSync('python3', [
      'hosting/next-static/stage.py',
      '--runtime',
      runtime,
      '--frontend',
      frontend,
      '--catalogue',
      join(root, 'catalogue.json'),
      '--output',
      join(root, 'public'),
    ]);
    assert.equal(readFileSync(join(runtime, 'notices/index.html'), 'utf8'), frozen);
    assert.equal(readFileSync(join(store, 'notice'), 'utf8'), frozen);
    assert.ok(
      readFileSync(join(root, 'public/runtime/notices/index.html')).equals(
        readFileSync('hosting/next/notices/index.html'),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing isolation, wrong runtime worker/WASM CORS and digest differences fail', () => {
  const path = '/runtime/a.wasm',
    bytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const headers = { ...headersFor(path), 'Content-Type': 'application/wasm' };
  const expected = { kind: 'wasm', sha256: sha256(bytes) };
  assert.deepEqual(responseFindings(path, headers, bytes, expected), []);
  for (const key of [
    'Cross-Origin-Opener-Policy',
    'Cross-Origin-Embedder-Policy',
    'Access-Control-Allow-Origin',
  ]) {
    const bad = { ...headers };
    delete bad[key];
    assert.ok(responseFindings(path, bad, bytes, expected).some((f) => f.problem === key));
  }
  assert.ok(
    responseFindings(
      '/runtime/worker.mjs',
      {
        ...headers,
        'Content-Type': 'text/javascript',
        'Access-Control-Allow-Origin': 'https://wrong.example',
      },
      bytes,
      { ...expected, kind: 'worker' },
    ).some((f) => f.problem === 'Access-Control-Allow-Origin'),
  );
  assert.ok(
    responseFindings(path, headers, Buffer.from('corrupt'), expected).some(
      (f) => f.problem === 'digest',
    ),
  );
});

test('real preview serves static routes and production headers; missing file assets remain 404', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'fm-preview-headers-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const index = Buffer.from('<!doctype html><title>Static route</title>');
  writeFileSync(join(root, 'index.html'), index);
  const site = await serve(root);
  t.after(() => site.close());
  const reports = await checkResponses(site.origin, [
    { path: '/names', kind: 'html', sha256: sha256(index) },
  ]);
  assert.deepEqual(reports[0].findings, []);
  assert.equal((await fetch(site.origin + '/missing.js')).status, 404);
});

test('classic staging comparison changes only to the exact production header policy', () => {
  const header = { path: '_headers', size: 3, sha256: sha256(Buffer.from('old')) };
  const app = { path: 'index.html', size: 4, sha256: sha256(Buffer.from('page')) };
  const before = {
    classicCommit: 'f'.repeat(40),
    files: [header, app],
    fields: {
      files: 2,
      bytes: 7,
      headersSha256: header.sha256,
      treeSha256: treeDigest([header, app]),
    },
  };
  const target = publicationReference(before);
  const good = [
    {
      path: '_headers',
      size: Buffer.byteLength(headersText()),
      sha256: sha256(Buffer.from(headersText())),
    },
    app,
  ];
  assert.deepEqual(compareTrees(good, target.files), []);
  assert.equal(
    target.fields.bytes,
    good.reduce((n, f) => n + f.size, 0),
  );
  assert.ok(compareTrees([header, app], target.files).some((d) => d.path === '_headers'));
  assert.ok(
    compareTrees([good[0], { ...app, sha256: '0'.repeat(64) }], target.files).some(
      (d) => d.path === 'index.html',
    ),
  );
  assert.throws(() => publicationReference({ ...before, files: [app] }), /header record/);
});

test('classic staging comparison takes each ported notice exactly, and nothing else', () => {
  const file = (path, text) => ({
    path,
    size: Buffer.byteLength(text),
    sha256: sha256(Buffer.from(text)),
  });
  const header = file('_headers', 'old');
  const frozen = file('runtime/notices/index.html', 'frozen');
  const other = file('runtime/notices/e4e-MIT.txt', 'mit');
  const ported = file('runtime/notices/index.html', 'ported notice');
  const notices = [
    {
      path: frozen.path,
      classic: frozen.sha256,
      sha256: ported.sha256,
      size: ported.size,
      bead: 'fm-x',
    },
  ];
  const before = {
    classicCommit: 'f'.repeat(40),
    files: [header, frozen, other],
    fields: { headersSha256: header.sha256 },
  };
  const target = publicationReference(before, notices);
  const h = file('_headers', headersText());
  assert.deepEqual(compareTrees([h, ported, other], target.files), []);
  assert.deepEqual(target.noticeMigration, [
    { path: frozen.path, classic: frozen.sha256, ported: ported.sha256, bead: 'fm-x' },
  ]);
  assert.equal(target.fields.bytes, h.size + ported.size + other.size);
  // The frozen notice staged unchanged, or another notice changed, still differs.
  assert.ok(compareTrees([h, frozen, other], target.files).some((d) => d.path === frozen.path));
  assert.ok(
    compareTrees([h, ported, file(other.path, 'changed')], target.files).some(
      (d) => d.path === other.path,
    ),
  );
  // A classic record that is not the frozen notice the port replaced is refused.
  assert.throws(
    () =>
      publicationReference({ ...before, files: [header, file(frozen.path, 'x'), other] }, notices),
    /not the frozen notice/,
  );
  // The repository's provenance declares the fm-gbdt notice port.
  const real = portedNotices();
  assert.ok(real.some((n) => n.path === 'runtime/notices/index.html' && n.bead === 'fm-gbdt'));
  assert.ok(real.every((n) => /^[0-9a-f]{64}$/.test(n.sha256) && n.classic !== n.sha256));
});
