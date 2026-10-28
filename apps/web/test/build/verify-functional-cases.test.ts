// verify.functional's case manifest (fm-ejwq): every case maps to a known flow-matrix row or defect, and the operated
// e2e test it names exists with that title.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { ROWS } from '../parity/rows.ts';
import { manifestProblems, stepId } from '../verify/harness.ts';
import { UNTESTED, VERIFY_FUNCTIONAL } from '../verify/cases/verify-functional.ts';

const e2e = new URL('../e2e/', import.meta.url);
const known = new Set(ROWS.map((r) => r.rowId));

test('the verify.functional manifest is valid: every case grades a known row or defect', () => {
  assert.deepEqual(manifestProblems(VERIFY_FUNCTIONAL, known), []);
  for (const u of UNTESTED) for (const r of u.rows) assert.ok(known.has(r), `untested row ${r}`);
  const ids = VERIFY_FUNCTIONAL.cases.flatMap((c) =>
    c.steps.map((s) => stepId(VERIFY_FUNCTIONAL.bead, c.id, s)),
  );
  assert.equal(new Set(ids).size, ids.length, 'step IDs are unique');
});

test('every verify.functional case names an e2e test that exists', () => {
  for (const c of VERIFY_FUNCTIONAL.cases) {
    const file = new URL(c.test.file, e2e);
    assert.ok(existsSync(file), `${c.id}: no ${c.test.file}`);
    assert.ok(
      readFileSync(file, 'utf8').includes(c.test.title),
      `${c.id}: no test titled ${c.test.title}`,
    );
  }
});

test('the bead scope rows each have a case or an untested entry', () => {
  // The rows fm-ejwq's acceptance names (R04, R05, R08-R11, R18, R20-R22, R26, R46, R47) and defects 5, 7, 8.
  const scope = [
    'words.generate-cpu',
    'seed.generate',
    'names.open-pick',
    'names.slow-offline',
    'names.edit-picked',
    'names.exact-text',
    'photo.paste-drop',
    'crop.confirm-one',
    'crop.adjust-rotate',
    'crop.no-face',
    'controls.add-remove',
    'remove-down-to-one',
    'testing-bulk-generate',
  ];
  const graded = new Set([
    ...VERIFY_FUNCTIONAL.cases.flatMap((c) => c.rows ?? []),
    ...UNTESTED.flatMap((u) => u.rows),
  ]);
  assert.deepEqual(
    scope.filter((r) => !graded.has(r)),
    [],
  );
  const defects = new Set(VERIFY_FUNCTIONAL.cases.flatMap((c) => c.defects ?? []));
  for (const d of [5, 7, 8]) assert.ok(defects.has(d), `defect ${d}`);
});
