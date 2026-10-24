// The frozen flow matrix's invariants (fm-hn9e), on the row table itself.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ROWS } from '../parity/rows.ts';

const plan = readFileSync(new URL('../../../../PLAN.md', import.meta.url), 'utf8');
// GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens.
const anchors = new Set([...plan.matchAll(/^#{1,6} (.+)$/gm)].map((m) => (m[1] ?? '').toLowerCase().trim().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-')));

test('every row id is unique and usable as a golden directory name', () => {
  const ids = ROWS.map((r) => r.rowId);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9][a-z0-9.-]*$/, id);
});

test('candidate defects 1-23 each appear, and no defect row is tagged parity', () => {
  const seen = new Set(ROWS.flatMap((r) => r.defects ?? []));
  for (let n = 1; n <= 23; n++) assert.ok(seen.has(n), `defect ${n} has no row`);
  for (const r of ROWS) if (r.defects?.length) assert.notEqual(r.tag, 'parity', `${r.rowId} repairs defect ${r.defects.join(', ')} and cannot be parity`);
});

test('changed and new rows name their owner; parity rows have none', () => {
  for (const r of ROWS) {
    if (r.tag === 'parity') assert.equal(r.owner, undefined, `${r.rowId} is parity`);
    else assert.ok(r.owner, `${r.rowId} (${r.tag}) needs an owner`);
  }
});

test('a parity row is exercisable against the control', () => {
  for (const r of ROWS) if (r.tag === 'parity') assert.equal(r.unexercisable, undefined, `${r.rowId}`);
});

test('every row cites a plan section that exists', () => {
  for (const r of ROWS) {
    const [file, anchor] = r.plan.split('#');
    assert.equal(file, 'PLAN.md', r.rowId);
    assert.ok(anchors.has(anchor ?? ''), `${r.rowId}: PLAN.md#${anchor} is not a heading`);
  }
});
