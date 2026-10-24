// cloudflare-model-host (fm-3osh): chunking and reconstruction, staging against the manager's manifest contract,
// dry-run publication, paid-service refusal, private provenance and the Cloudflare limits. Planted bundles in
// temporary directories are inputs, not fakes; the qualified runtime (FACEMORPH_RUNTIME_DIR, else the
// repository's acquired .cache/runtime) is the real staged set, and is reported untested when absent.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CHUNK_BYTES,
  MIB,
  STATIC_ASSET_FILE_LIMIT_BYTES,
  StageError,
  assets,
  chunkSizes,
  inside,
  limitFindings,
  planPublication,
  provenanceFindings,
  publishRoot,
  reconstruct,
  sha256Hex,
  stage,
  termsRefusal,
  verifyRoot,
  writeChunks,
} from '../src/index.ts';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const REPO = join(PKG, '../..');
const CLI = join(PKG, 'src/cli.ts');
const BASE = 'https://models.example.test/runtime';
const tmp = (p: string) => mkdtempSync(join(tmpdir(), `model-host-${p}-`));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Deterministic bytes: a counter through SHA-256, so planted inputs are reproducible and incompressible. */
function bytes(n: number, seed: string): Buffer {
  const out = Buffer.allocUnsafe(n);
  let block = createHash('sha256').update(seed).digest();
  for (let at = 0; at < n; at += 32) {
    block.copy(out, at, 0, Math.min(32, n - at));
    block = createHash('sha256').update(block).digest();
  }
  return out;
}

/** Every file under a directory with its digest, for before/after comparisons. */
function snapshot(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out.push(`${f.slice(dir.length)} ${statSync(f).size} ${sha(readFileSync(f))}`);
    }
  };
  walk(dir);
  return out.sort();
}

/** A planted unpublished bundle in the contract's `file` form, with one asset above the file limit. */
function plantBundle(extra: Record<string, unknown> = {}) {
  const dir = tmp('bundle');
  const put = (rel: string, b: Buffer) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), b);
    return { file: rel, sha256: sha(b), size: b.length };
  };
  const big = bytes(STATIC_ASSET_FILE_LIMIT_BYTES + 3 * MIB + 5, 'synthesis');
  const noise = put('assets/n/noise0.f32', bytes(4096, 'noise'));
  const manifest = {
    schemaVersion: 1,
    bundleVersion: 'planted-v1',
    modelSourceSha256: 'a'.repeat(64),
    noiseSha256: sha(Buffer.from(noise.sha256)),
    mapping: put('assets/m/mapping.onnx', bytes(1000, 'mapping')),
    synthesis: put('assets/s/synthesis.onnx', big),
    noise: [{ ...noise, name: 'noise0', shape: [1, 1, 4, 4] }],
    ...extra,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return { dir, manifest, big };
}

/** A planted terms record covering the planted bundle's model source. */
function plantTerms(redistribution = 'permitted') {
  const record = join(tmp('terms'), 'licences.json');
  writeFileSync(
    record,
    JSON.stringify({
      rows: [
        { id: 'planted-model', redistribution, provenance: `source sha256 ${'a'.repeat(64)}` },
      ],
    }),
  );
  return record;
}

test('chunk sizes: full 16 MiB pieces then the remainder; only inputs above 25 MiB chunk', () => {
  assert.equal(CHUNK_BYTES, 16 * MIB);
  assert.equal(STATIC_ASSET_FILE_LIMIT_BYTES, 25 * MIB);
  assert.deepEqual(chunkSizes(0), []);
  assert.deepEqual(chunkSizes(CHUNK_BYTES), [CHUNK_BYTES]);
  assert.deepEqual(chunkSizes(2 * CHUNK_BYTES + 1), [CHUNK_BYTES, CHUNK_BYTES, 1]);
  assert.throws(() => chunkSizes(-1), RangeError);
});

test('chunk -> reconstruct equals the source digest; chunks are frozen once written', () => {
  const dir = tmp('chunks');
  const src = join(dir, 'input.bin');
  const b = bytes(2 * CHUNK_BYTES + 12345, 'chunked');
  writeFileSync(src, b);
  const out = join(dir, 'out');
  const chunks = writeChunks(src, out);
  assert.deepEqual(
    chunks.map((c) => c.size),
    chunkSizes(b.length),
  );
  const r = reconstruct(chunks, out);
  assert.deepEqual(r.problems, []);
  assert.equal(r.sha256, sha256Hex(b));
  assert.equal(r.size, b.length);
  assert.deepEqual(writeChunks(src, out), chunks, 'rewriting identical chunks is a no-op');
  writeFileSync(join(out, chunks[1]!.path), 'tampered');
  assert.throws(() => writeChunks(src, out), /Immutable destination changed/);
  assert.equal(reconstruct(chunks, out).problems[0]?.problem, 'chunk digest differs');
});

test('stage: an unpublished bundle becomes hosted URLs, the large asset chunks, and the result verifies', () => {
  const { dir, big } = plantBundle();
  const out = tmp('staged');
  const r = stage({ source: dir, out, base: BASE });
  assert.equal(r.assets, 3);
  assert.equal(r.chunked, 1);
  const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(m.synthesis.url, `${BASE}/assets/s/synthesis.onnx`);
  assert.equal(m.synthesis.chunks.length, 2);
  assert.equal(m.synthesis.file, undefined);
  assert.equal(
    existsSync(join(out, 'assets/s/synthesis.onnx')),
    false,
    'a chunked asset is published only as chunks',
  );
  assert.equal(m.mapping.url, `${BASE}/assets/m/mapping.onnx`);
  const v = verifyRoot({ root: out, base: BASE });
  assert.deepEqual(v.findings, []);
  assert.deepEqual(v.limits, []);
  assert.equal(v.ok, true);
  assert.ok(v.largestFile.bytes <= STATIC_ASSET_FILE_LIMIT_BYTES);
  assert.equal(
    reconstruct(
      m.synthesis.chunks.map((c: { url: string; sha256: string; size: number }) => ({
        ...c,
        path: c.url.slice(BASE.length + 1),
      })),
      out,
    ).sha256,
    sha(big),
  );
  assert.equal(readdirSync(out).includes('sources.private.json'), false);
});

test('the staged manifest validates against the contract schema; a newer major is rejected', () => {
  const require = createRequire(import.meta.url);
  const Ajv2020 = require('ajv/dist/2020').default as new (o: object) => {
    compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown };
  };
  const schema = JSON.parse(
    readFileSync(
      join(REPO, 'packages/browser-model-manager/schema/model-manifest.v1.schema.json'),
      'utf8',
    ),
  );
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const { dir } = plantBundle();
  const out = tmp('schema');
  const r = stage({ source: dir, out, base: BASE });
  assert.equal(validate(r.manifest), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...(r.manifest as object), schemaVersion: 2 }), false);
  const newer = plantBundle({ schemaVersion: 2 });
  assert.throws(
    () => stage({ source: newer.dir, out: tmp('newer'), base: BASE }),
    (e: unknown) =>
      e instanceof StageError && e.code === 'contract' && /newer-major/.test(e.message),
  );
});

test('stage refuses integrity mismatches, unsafe paths, plain http and private provenance', () => {
  const bad = plantBundle();
  writeFileSync(join(bad.dir, 'assets/m/mapping.onnx'), 'changed');
  assert.throws(
    () => stage({ source: bad.dir, out: tmp('a'), base: BASE }),
    (e: unknown) => e instanceof StageError && e.code === 'integrity',
  );
  const unsafe = plantBundle({
    average: { file: '../outside.bin', sha256: 'b'.repeat(64), size: 1 },
  });
  // The manager's contract refuses the escape first; staging's own check refuses it too.
  assert.throws(
    () => stage({ source: unsafe.dir, out: tmp('b'), base: BASE }),
    (e: unknown) =>
      e instanceof StageError &&
      (e.code === 'contract' || e.code === 'unsafe-path') &&
      /average/.test(e.message),
  );
  for (const rel of ['../outside.bin', '/etc/passwd', 'a/../../b'])
    assert.throws(
      () => inside(unsafe.dir, rel),
      (e: unknown) => e instanceof StageError && e.code === 'unsafe-path',
      rel,
    );
  assert.equal(inside(unsafe.dir, 'a/b.bin'), join(unsafe.dir, 'a/b.bin'));
  const ok = plantBundle();
  assert.throws(
    () => stage({ source: ok.dir, out: tmp('c'), base: 'http://models.example.test' }),
    (e: unknown) => e instanceof StageError && e.code === 'not-https',
  );
  const leak = plantBundle({ notes: 'built from /home/someone/review-artifacts/manifest.json' });
  assert.throws(
    () => stage({ source: leak.dir, out: tmp('d'), base: BASE }),
    (e: unknown) => e instanceof StageError && e.code === 'private-provenance',
  );
  assert.deepEqual(
    provenanceFindings({ a: { source: 'x/y' }, b: 'file:///tmp/x' })
      .map((f) => f.rule)
      .sort(),
    ['file-url', 'source-path-key'],
  );
});

test('dry runs make zero writes: stage --dry-run and publish without --publish', () => {
  const { dir } = plantBundle();
  const out = join(tmp('dry'), 'out');
  const sourceBefore = snapshot(dir);
  const r = spawnSync(
    process.execPath,
    [CLI, 'stage', '--source', dir, '--out', out, '--base', BASE, '--dry-run'],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).staged, false);
  assert.equal(existsSync(out), false, 'stage --dry-run creates nothing');
  assert.deepEqual(snapshot(dir), sourceBefore);

  const staged = tmp('root');
  stage({ source: dir, out: staged, base: BASE });
  const dest = join(tmp('dest'), 'site');
  const targetFile = join(tmp('target'), 'target.json');
  writeFileSync(
    targetFile,
    JSON.stringify({ kind: 'directory', path: dest, terms: { record: plantTerms() } }),
  );
  const rootBefore = snapshot(staged);
  const dry = spawnSync(
    process.execPath,
    [CLI, 'publish', '--root', staged, '--target', targetFile],
    { encoding: 'utf8' },
  );
  assert.equal(dry.status, 0, dry.stderr);
  const report = JSON.parse(dry.stdout);
  assert.equal(report.published, false);
  assert.equal(report.written, 0);
  assert.ok(report.writes > 0);
  assert.equal(existsSync(dest), false, 'publish without --publish writes nothing');
  assert.deepEqual(snapshot(staged), rootBefore);

  const real = spawnSync(
    process.execPath,
    [CLI, 'publish', '--root', staged, '--target', targetFile, '--publish'],
    { encoding: 'utf8' },
  );
  assert.equal(real.status, 0, real.stderr);
  assert.equal(JSON.parse(real.stdout).written, report.writes);
  assert.deepEqual(
    snapshot(dest),
    rootBefore,
    'the published directory holds exactly the staged bytes',
  );
  const terms = { record: plantTerms() };
  assert.equal(
    publishRoot(staged, { kind: 'directory', path: dest, terms }, { publish: true }).written,
    0,
    'republishing writes nothing',
  );
  assert.equal(
    planPublication(staged, { kind: 'directory', path: dest, terms }).refused,
    null,
    'the republish was allowed, not refused',
  );
  writeFileSync(join(dest, 'manifest.json'), '{}');
  assert.match(
    planPublication(staged, { kind: 'directory', path: dest, terms }).refused ?? '',
    /immutable destination changed: manifest\.json/,
  );
});

test('a paid product is refused unless the target names it; the free product is not', () => {
  const { dir } = plantBundle();
  const staged = tmp('paid');
  stage({ source: dir, out: staged, base: BASE });
  const dest = join(tmp('paid-dest'), 'site');
  const r2 = publishRoot(
    staged,
    { kind: 'directory', path: dest, product: 'r2' },
    { publish: true },
  );
  assert.equal(r2.published, false);
  assert.match(r2.refused ?? '', /r2 is a paid service/);
  assert.equal(existsSync(dest), false);
  const paid = publishRoot(
    staged,
    { kind: 'cloudflare', project: dest, product: 'workers-static-assets-paid' },
    { publish: true },
  );
  assert.equal(paid.published, false, 'refused before cf is ever run');
  const terms = { record: plantTerms() };
  const approved = planPublication(staged, {
    kind: 'directory',
    path: dest,
    product: 'r2',
    paidServiceApproved: 'r2',
    terms,
  });
  assert.equal(approved.refused, null);
  assert.equal(planPublication(staged, { kind: 'directory', path: dest, terms }).paid, false);
});

test('model terms: publication needs a record covering the model source; unresolved terms need acknowledging', () => {
  const { dir } = plantBundle();
  const staged = tmp('terms-root');
  stage({ source: dir, out: staged, base: BASE });
  const dest = join(tmp('terms-dest'), 'site');
  assert.match(
    publishRoot(staged, { kind: 'directory', path: dest }, { publish: true }).refused ?? '',
    /names no model terms record/,
  );
  const unresolved = plantTerms('unresolved');
  assert.match(
    publishRoot(
      staged,
      { kind: 'directory', path: dest, terms: { record: unresolved } },
      { publish: true },
    ).refused ?? '',
    /redistribution "unresolved"/,
  );
  assert.equal(existsSync(dest), false, 'nothing written while the terms refuse');
  const ok = publishRoot(
    staged,
    { kind: 'directory', path: dest, terms: { record: unresolved, acknowledged: 'planted-model' } },
    { publish: true },
  );
  assert.equal(ok.published, true);
  const other = join(tmp('terms-other'), 'licences.json');
  writeFileSync(
    other,
    JSON.stringify({
      rows: [{ id: 'x', redistribution: 'permitted', provenance: 'b'.repeat(64) }],
    }),
  );
  assert.match(
    termsRefusal({ modelSourceSha256: 'a'.repeat(64) }, { record: other }) ?? '',
    /no model terms row covers/,
  );
  // The repository's own record for the qualified runtime's model: redistribution is unresolved today.
  const real = termsRefusal(
    { modelSourceSha256: 'adf127ea7bb8a7788c8bdeda3c9937f7310b669b09ecf799ca53a631ff46948d' },
    { record: join(REPO, 'import/licences.json') },
  );
  assert.match(
    real ?? '',
    /nvidia-stylegan2-ffhq-config-f-derived has redistribution "unresolved"/,
  );
});

test('limits: a file over 25 MiB or a count over the plan is a finding', () => {
  assert.deepEqual(
    limitFindings([{ path: 'a', bytes: STATIC_ASSET_FILE_LIMIT_BYTES }], 'workers-free'),
    [],
  );
  assert.deepEqual(
    limitFindings([{ path: 'a', bytes: STATIC_ASSET_FILE_LIMIT_BYTES + 1 }], 'workers-free').map(
      (f) => f.problem,
    ),
    ['over-file-limit'],
  );
  const many = Array.from({ length: 20_001 }, (_, i) => ({ path: String(i), bytes: 1 }));
  assert.deepEqual(
    limitFindings(many, 'workers-free').map((f) => f.problem),
    ['too-many-files'],
  );
  assert.deepEqual(limitFindings(many, 'workers-paid'), []);
});

// ---- The real staged set: the qualified runtime the candidate serves, as acquired on this machine.
const RUNTIME = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/runtime');
const PUBLISHED_BASE = 'https://next.facemorph.me/runtime';

test('qualified runtime: every chunk reconstructs its asset, re-chunking reproduces the same pieces, every file fits', (t) => {
  if (!existsSync(join(RUNTIME, 'manifest.json'))) {
    if (process.env['FACEMORPH_REQUIRE_RUNTIME'])
      assert.fail(`FACEMORPH_REQUIRE_RUNTIME is set but ${RUNTIME} has no manifest`);
    return t.skip(`untested here: no qualified runtime at ${RUNTIME}`);
  }
  const manifest = JSON.parse(readFileSync(join(RUNTIME, 'manifest.json'), 'utf8'));
  const chunked = assets(manifest).filter(({ asset }) => asset.chunks);
  assert.ok(chunked.length > 0);
  let chunks = 0;
  for (const { path, asset } of chunked) {
    const list = asset.chunks!.map((c) => ({
      path: c.url!.slice(PUBLISHED_BASE.length + 1),
      sha256: c.sha256,
      size: c.size,
    }));
    // Parity with this package's chunker: the published pieces are exactly the 16 MiB cuts of the asset.
    assert.deepEqual(
      list.map((c) => c.size),
      chunkSizes(asset.size),
      path,
    );
    assert.ok(
      list.every((c) => c.path === `chunks/${c.sha256}.bin`),
      path,
    );
    const r = reconstruct(list, RUNTIME);
    assert.deepEqual(r.problems, [], path);
    assert.equal(r.sha256, asset.sha256, path);
    chunks += list.length;
  }
  const v = verifyRoot({ root: RUNTIME, base: PUBLISHED_BASE });
  assert.deepEqual(v.findings, []);
  assert.deepEqual(
    v.limits,
    [],
    'every staged file is under 25 MiB and the count fits Workers Free',
  );
  const plan = stage({
    source: RUNTIME,
    out: tmp('restage'),
    base: BASE,
    fromBase: PUBLISHED_BASE,
    dryRun: true,
  });
  assert.equal(plan.chunked, chunked.length);
  assert.ok(plan.files.every((f) => f.bytes <= STATIC_ASSET_FILE_LIMIT_BYTES));
  console.log(
    'qualified runtime',
    JSON.stringify({
      assets: v.assets,
      chunkedAssets: chunked.length,
      chunks,
      files: v.files,
      bytes: v.bytes,
      largestFile: v.largestFile,
    }),
  );
});
