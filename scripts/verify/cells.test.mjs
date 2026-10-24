// The per-cell table (fm-q007), with plain values.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CELLS, markdown, tableRows } from './cells.mjs';

const pairsAt = (ratios) => ratios.map((r) => ({ control: 100, candidate: 100 * r }));

test('the table covers the three register rows, the four baseline-note items and the evidence gaps', () => {
  assert.equal(CELLS.filter((c) => c.kind === 'register').length, 3);
  assert.equal(CELLS.filter((c) => c.kind === 'baseline-note').length, 4);
  assert.deepEqual(
    CELLS.filter((c) => c.kind === 'evidence-gap').map((c) => c.id),
    ['gap.physical-iphone', 'gap.firefox-webkit-performance', 'gap.gtx1050-inference'],
  );
});

test('with no paired runs every cell is untested, never passed', () => {
  const rows = tableRows({});
  assert.ok(rows.every((r) => r.verdict === 'untested'));
  assert.match(markdown(rows), /gap\.physical-iphone .*untested/);
});

test('recorded pairs grade each measure; the first-Save trade is traded, not failed', () => {
  const rows = tableRows({
    'ubuntu-chrome-cpu-retained': {
      reliability: [{ controlProduced: true, candidateProduced: true }],
      measures: {
        repeatOriginalMs: {
          pairs: pairsAt([0.98, 1, 0.99, 1.01, 1]),
          noisePairs: pairsAt([1.01, 0.99, 1, 1.02, 0.98]),
        },
        repeatSaveMs: {
          pairs: pairsAt([0.9, 0.92, 0.91, 0.9, 0.93]),
          margin: 0.03,
          marginSource: 'research evaluator noise baseline',
        },
        firstSaveMs: {
          pairs: pairsAt([1.86, 1.85, 1.87, 1.86, 1.86]),
          margin: 0.05,
          marginSource: 'control/control pairs on this cell',
        },
      },
    },
  });
  const cell = rows.find((r) => r.id === 'ubuntu-chrome-cpu-retained');
  assert.equal(cell.verdict, 'passed');
  assert.deepEqual(cell.traded, ['firstSaveMs']);
  assert.equal(cell.measures.repeatSaveMs.marginSource, 'research evaluator noise baseline');
  assert.match(markdown(rows), /repeatSaveMs: passed 0\.912 \[/);
});

test('a slower measure beyond the margin fails its cell; a missing measure leaves it untested', () => {
  const slow = tableRows({
    'ios-simulator-product': {
      reliability: [{ controlProduced: true, candidateProduced: true }],
      measures: {
        firstFullFaceMs: { pairs: pairsAt([1.3, 1.31, 1.29, 1.3, 1.32]), margin: 0.05 },
        warmSynthesisMs: { pairs: pairsAt([1, 1, 1, 1, 1]), margin: 0.05 },
      },
    },
  });
  assert.equal(slow.find((r) => r.id === 'ios-simulator-product').verdict, 'failed');
  const partial = tableRows({
    'ios-simulator-product': {
      reliability: [{ controlProduced: true, candidateProduced: true }],
      measures: { firstFullFaceMs: { pairs: pairsAt([1, 1, 1, 1, 1]), margin: 0.05 } },
    },
  });
  assert.equal(partial.find((r) => r.id === 'ios-simulator-product').verdict, 'untested');
});
