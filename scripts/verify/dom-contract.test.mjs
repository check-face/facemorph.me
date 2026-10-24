// DOM contract projection, diff and row grading (fm-q007), with plain values.
import assert from 'node:assert/strict';
import test from 'node:test';
import { contractOf, diffContracts, gradeRow } from './dom-contract.mjs';

const face = (label, text = 'Generate', disabled = false) => ({
  tag: 'section', classes: ['box', 'next-face', 'jss12'], attrs: { 'data-next-face': 'face-1' },
  children: [{ tag: 'div', classes: ['MuiBox-root'], children: [
    { tag: 'button', classes: ['MuiButton-root', 'next-face-generate'], attrs: { 'aria-label': label, type: 'button', ...(disabled ? { disabled: '' } : {}) }, text },
    { tag: 'span', classes: ['next-sr'], text: '  Cached\n preview ' },
  ] }],
});

test('the contract keeps next- classes, ARIA, text and interactive tags, and drops wrappers and generated classes', () => {
  const c = contractOf({ faces: [face('Generate Morph from')] });
  assert.deepEqual(c, [
    { region: 'faces', next: ['next-face'], attrs: { 'data-next-face': 'face-1' }, text: '' },
    { region: 'faces', tag: 'button', next: ['next-face-generate'], attrs: { 'aria-label': 'Generate Morph from', type: 'button' }, text: 'Generate' },
    { region: 'faces', next: ['next-sr'], attrs: {}, text: 'Cached preview' },
  ]);
});

test('a different wrapper structure with the same contract is equal', () => {
  const flat = { tag: 'section', classes: ['next-face', 'css-1x2y'], attrs: { 'data-next-face': 'face-1' }, children: [
    { tag: 'button', classes: ['next-face-generate'], attrs: { type: 'button', 'aria-label': 'Generate Morph from' }, text: 'Generate' },
    { tag: 'span', classes: ['next-sr'], text: 'Cached preview' },
  ] };
  assert.deepEqual(diffContracts(contractOf({ faces: [face('Generate Morph from')] }), contractOf({ faces: [flat] })), []);
});

test('changed text, ARIA or disabled state is one change in place', () => {
  const control = contractOf({ faces: [face('Generate Morph from')] });
  const d1 = diffContracts(control, contractOf({ faces: [face('Generate Morph from', 'Make')] }));
  assert.equal(d1.length, 1);
  assert.equal(d1[0].op, 'changed');
  assert.equal(d1[0].control.text, 'Generate');
  assert.equal(d1[0].subject.text, 'Make');
  assert.equal(diffContracts(control, contractOf({ faces: [face('Generate Morph from', 'Generate', true)] }))[0].subject.attrs.disabled, '');
});

test('a missing or extra control is reported once, not as a cascade', () => {
  const two = { faces: [face('A'), face('B')] }, one = { faces: [face('B')] };
  const d = diffContracts(contractOf(two), contractOf(one));
  assert.ok(d.length >= 1 && d.every((x) => x.op === 'missing'));
  assert.ok(diffContracts(contractOf(one), contractOf(two)).every((x) => x.op === 'added'));
});

test('parity rows compare exactly; changed and new rows are owner-graded and never compared', () => {
  const step = (dom, name = 'arrived') => ({ step: name, dom });
  const ctl = [step({ faces: [face('A')] })];
  assert.equal(gradeRow({ rowId: 'p', tag: 'parity' }, ctl, ctl).verdict, 'passed');
  const planted = gradeRow({ rowId: 'p', tag: 'parity' }, ctl, [step({ faces: [face('A', 'Generat')] })]);
  assert.equal(planted.verdict, 'failed');
  assert.equal(planted.steps[0].diffs[0].op, 'changed');
  assert.equal(gradeRow({ rowId: 'p', tag: 'parity' }, ctl, [step({ faces: [face('A')] }, 'other')]).reason, 'different step sequence');
  assert.deepEqual(gradeRow({ rowId: 'c', tag: 'changed', owner: 'ws-face' }, ctl, []), { rowId: 'c', verdict: 'owner-graded', owner: 'ws-face', tag: 'changed' });
  assert.equal(gradeRow({ rowId: 'n', tag: 'new', owner: 'ws-names' }, [], []).verdict, 'owner-graded');
  assert.equal(gradeRow({ rowId: 'p', tag: 'parity' }, [], []).verdict, 'untested');
});
