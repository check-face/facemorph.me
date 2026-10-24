// Pure logic of the catalogue result generator (bead fm-a40f), called with plain values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sha256, nameIdentity, catalogueRows, resultSet, resultPath, parseManifest, headerLine, rowLine, rowValid, plan,
  latentCheck, referenceLatentCheck, synthesisCheck, referenceRows, isApiHost, LATENT_TOLERANCE,
} from './lib.mjs';

const H = (s) => sha256(Buffer.from(s));
const catalogue = (names) => ({ names: names.map((name) => ({ name, value: name.toLowerCase(), id: H(name.toLowerCase()), latent: { sha256: H(`l${name}`), modelSha256: 'm'.repeat(64), generationSha256: 'g'.repeat(64) } })) });
const SET = resultSet({ manifestSha256: 'a'.repeat(64), modelSha256: 'm'.repeat(64), generationSha256: 'g'.repeat(64) });

test('name identity: lowercase value, id = SHA-256 of the value', () => {
  assert.deepEqual(nameIdentity('Zoë'), { name: 'Zoë', value: 'zoë', id: H('zoë') });
});

test('catalogue rows: derivation rules enforced; latent digest required', () => {
  const rows = catalogueRows(catalogue(['Charlotte', 'Mary Ann']));
  assert.deepEqual(rows.map((r) => [r.value, r.latentSha256]), [['charlotte', H('lCharlotte')], ['mary ann', H('lMary Ann')]]);
  const bad = catalogue(['Charlotte']);
  bad.names[0].value = 'Charlotte';
  assert.throws(() => catalogueRows(bad), /derivation rules/);
  const dup = catalogue(['Ann', 'ann']);
  assert.throws(() => catalogueRows(dup), /derivation rules/);
  const nolatent = catalogue(['Ann']);
  delete nolatent.names[0].latent.sha256;
  assert.throws(() => catalogueRows(nolatent), /no latent digest/);
});

test('result set: identity digest changes with any input; <set> is its first 16 hex', () => {
  assert.equal(SET.set, SET.digest.slice(0, 16));
  assert.equal(resultSet({ manifestSha256: 'a'.repeat(64), modelSha256: 'm'.repeat(64), generationSha256: 'g'.repeat(64) }).digest, SET.digest);
  assert.notEqual(resultSet({ manifestSha256: 'b'.repeat(64), modelSha256: 'm'.repeat(64), generationSha256: 'g'.repeat(64) }).digest, SET.digest);
  assert.equal(resultPath(SET.set, 'abc'), `results/${SET.set}/abc.webp`);
});

const good = (id, over = {}) => ({ id, resultSet: SET.digest, file: resultPath(SET.set, id), fileSha256: H(`f${id}`), latentCheck: 'exact', referenceLatent: { status: 'pass' }, synthesisCheck: { status: 'pass' }, ...over });

test('manifest: header and rows round trip; a later row for an id replaces the earlier one', () => {
  const text = headerLine(SET) + rowLine(good('a', { fileSha256: 'old' })) + rowLine(good('b')) + rowLine(good('a'));
  const m = parseManifest(text);
  assert.equal(m.header.resultSet, SET.digest);
  assert.equal(m.rows.size, 2);
  assert.equal(m.rows.get('a').fileSha256, H('fa'));
});

test('resume plan: only rows with this result set, passing checks and an intact file are reused', () => {
  const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({ id }));
  const m = parseManifest(headerLine(SET) + [
    good('a'),
    good('b', { resultSet: 'other' }),
    good('c', { latentCheck: 'mismatch' }),
    good('d', { synthesisCheck: { status: 'fail' } }),
    good('e', { referenceLatent: { status: 'fail' } }),
    good('f'),
  ].map(rowLine).join(''));
  const disk = { [resultPath(SET.set, 'a')]: H('fa'), [resultPath(SET.set, 'f')]: 'corrupted' };
  const p = plan(rows, m, SET, disk);
  assert.deepEqual(p.reuse.map((r) => r.id), ['a']);
  assert.deepEqual(p.generate.map((r) => r.id), ['b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(rowValid(good('a', { synthesisCheck: { status: 'not-checked' } }), SET, disk), true);
  assert.equal(rowValid(good('a', { synthesisCheck: { status: 'not-checked' } }), SET, disk, { requireSynthesis: true }), false);
});

test('latent check: exact only when the file carries the typed-path W+ under the catalogue identity', () => {
  const row = { generationSha256: 'g'.repeat(64) };
  assert.equal(latentCheck({ producedSha256: 'x', envelopeSha256: 'x', generationSha256: 'g'.repeat(64) }, row), 'exact');
  assert.equal(latentCheck({ producedSha256: 'x', envelopeSha256: 'y', generationSha256: 'g'.repeat(64) }, row), 'mismatch');
  assert.equal(latentCheck({ producedSha256: 'x', envelopeSha256: null, generationSha256: 'g'.repeat(64) }, row), 'mismatch');
  assert.equal(latentCheck({ producedSha256: 'x', envelopeSha256: 'x', generationSha256: 'h'.repeat(64) }, row), 'identity-mismatch');
});

test('reference latent: within the frozen tolerance passes; beyond it, NaN or a missing reference fails', () => {
  const pub = new Float32Array([0.5, -1, 2]);
  assert.deepEqual(referenceLatentCheck(new Float32Array([0.5, -1, 2]), pub), { status: 'pass', maxAbsDiff: 0 });
  assert.equal(referenceLatentCheck(new Float32Array([0.5 + 2.8e-6, -1, 2]), pub).status, 'pass');
  assert.equal(referenceLatentCheck(new Float32Array([0.5 + 2 * LATENT_TOLERANCE, -1, 2]), pub).status, 'fail');
  assert.equal(referenceLatentCheck(new Float32Array([NaN, -1, 2]), pub).status, 'fail');
  assert.equal(referenceLatentCheck(new Float32Array([0.5, -1]), pub).status, 'fail');
  assert.equal(referenceLatentCheck(pub, null).status, 'fail');
});

test('synthesis check: max channel difference 1 passes, 2 fails, no comparison is not-checked', () => {
  assert.deepEqual(synthesisCheck({ maxDiff: 1, differing: 256, reference: 'webgpu' }), { status: 'pass', maxRgbDiff: 1, differingChannels: 256, reference: 'webgpu' });
  assert.equal(synthesisCheck({ maxDiff: 2, differing: 1, reference: 'webgpu' }).status, 'fail');
  assert.deepEqual(synthesisCheck(null), { status: 'not-checked' });
});

test('reference rows: all, none, or a spread sample', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i) }));
  assert.equal(referenceRows(rows, 'all').size, 10);
  assert.equal(referenceRows(rows, 'none').size, 0);
  assert.deepEqual([...referenceRows(rows, '3')], ['0', '3', '6']);
  assert.throws(() => referenceRows(rows, 'some'), /reference must be/);
});

test('API hosts: the two retired hosts and their subdomains only', () => {
  assert.equal(isApiHost('api.facemorph.me'), true);
  assert.equal(isApiHost('checkface.facemorph.me'), true);
  assert.equal(isApiHost('x.api.facemorph.me'), true);
  assert.equal(isApiHost('next.facemorph.me'), false);
  assert.equal(isApiHost('models.facemorph.me'), false);
});
