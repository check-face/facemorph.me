// Harness self-test on the real committed control goldens (fm-q007): control vs control passes; a planted DOM text
// difference in a copy of one parity row fails on that row only; changed and new rows are owner-graded, never compared.
//   node --experimental-strip-types --test scripts/verify/parity-grade.test.mjs
import assert from 'node:assert/strict';
import { cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { tempDir } from '../inventory/testing.mjs';
import { REPO } from '../inventory/lib.mjs';
import { grade } from './parity-grade.mjs';

const CONTROL = join(REPO, 'apps/web/test/goldens/control');
const { ROWS } = await import(join(REPO, 'apps/web/test/parity/rows.ts'));

test('control vs control: every recorded parity row passes; the rest are owner-graded', () => {
  const { results, summary } = grade(ROWS, CONTROL, CONTROL);
  assert.equal(summary.failed, 0);
  assert.ok(summary.passed >= 6, JSON.stringify(summary));
  assert.equal(summary.ownerGraded, ROWS.filter((r) => r.tag !== 'parity').length * 2);
  assert.ok(results.filter((r) => r.verdict === 'owner-graded').every((r) => r.owner));
});

test('a planted text difference on a parity row fails that row, in place', () => {
  const subject = tempDir('parity-subject-');
  cpSync(CONTROL, subject, { recursive: true });
  const dir = join(subject, 'first-visit', 'desktop');
  const file = join(dir, readdirSync(dir).sort()[0]);
  const text = readFileSync(file, 'utf8');
  const planted = text.replace('"text": "Morph from"', '"text": "Morph form"');
  assert.notEqual(planted, text, 'the golden no longer holds the text this test plants into');
  writeFileSync(file, planted);
  const { results, summary } = grade(ROWS, CONTROL, subject);
  assert.equal(summary.failed, 1);
  const failed = results.find((r) => r.verdict === 'failed');
  assert.equal(failed.rowId, 'first-visit');
  assert.equal(failed.project, 'desktop');
  const change = failed.steps[0].diffs.find((d) => d.op === 'changed');
  assert.equal(change.control.text, 'Morph from');
  assert.equal(change.subject.text, 'Morph form');
});

test('a subject that skipped a parity row fails it', () => {
  const subject = tempDir('parity-subject-');
  cpSync(CONTROL, subject, { recursive: true, filter: (src) => !src.includes('seed.generate') });
  const { results } = grade(ROWS, CONTROL, subject);
  assert.ok(results.some((r) => r.rowId === 'seed.generate' && r.verdict === 'failed'));
});
