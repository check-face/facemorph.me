// DOM contract projection, diff and row grading (fm-q007), with plain values.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contractOf, diffContracts, gradeRow } from './dom-contract.mjs';

const face = (label, text = 'Generate', disabled = false) => ({
  tag: 'section',
  classes: ['box', 'next-face', 'jss12'],
  attrs: { 'data-next-face': 'face-1' },
  children: [
    {
      tag: 'div',
      classes: ['MuiBox-root'],
      children: [
        {
          tag: 'button',
          classes: ['MuiButton-root', 'next-face-generate'],
          attrs: { 'aria-label': label, type: 'button', ...(disabled ? { disabled: '' } : {}) },
          text,
        },
        { tag: 'span', classes: ['next-sr'], text: '  Cached\n preview ' },
      ],
    },
  ],
});

test('the contract keeps next- classes, ARIA, text and interactive tags, and drops wrappers and generated classes', () => {
  const c = contractOf({ faces: [face('Generate Morph from')] });
  assert.deepEqual(c, [
    { region: 'faces', next: ['next-face'], attrs: { 'data-next-face': 'face-1' }, text: '' },
    {
      region: 'faces',
      tag: 'button',
      next: ['next-face-generate'],
      attrs: { 'aria-label': 'Generate Morph from', type: 'button' },
      text: 'Generate',
    },
    { region: 'faces', next: ['next-sr'], attrs: {}, text: 'Cached preview' },
  ]);
});

test('a different wrapper structure with the same contract is equal', () => {
  const flat = {
    tag: 'section',
    classes: ['next-face', 'css-1x2y'],
    attrs: { 'data-next-face': 'face-1' },
    children: [
      {
        tag: 'button',
        classes: ['next-face-generate'],
        attrs: { type: 'button', 'aria-label': 'Generate Morph from' },
        text: 'Generate',
      },
      { tag: 'span', classes: ['next-sr'], text: 'Cached preview' },
    ],
  };
  assert.deepEqual(
    diffContracts(
      contractOf({ faces: [face('Generate Morph from')] }),
      contractOf({ faces: [flat] }),
    ),
    [],
  );
});

test('changed text, ARIA or disabled state is one change in place', () => {
  const control = contractOf({ faces: [face('Generate Morph from')] });
  const d1 = diffContracts(control, contractOf({ faces: [face('Generate Morph from', 'Make')] }));
  assert.equal(d1.length, 1);
  assert.equal(d1[0].op, 'changed');
  assert.equal(d1[0].control.text, 'Generate');
  assert.equal(d1[0].subject.text, 'Make');
  assert.equal(
    diffContracts(
      control,
      contractOf({ faces: [face('Generate Morph from', 'Generate', true)] }),
    )[0].subject.attrs.disabled,
    '',
  );
});

test('a missing or extra control is reported once, not as a cascade', () => {
  const two = { faces: [face('A'), face('B')] },
    one = { faces: [face('B')] };
  const d = diffContracts(contractOf(two), contractOf(one));
  assert.ok(d.length >= 1 && d.every((x) => x.op === 'missing'));
  assert.ok(diffContracts(contractOf(one), contractOf(two)).every((x) => x.op === 'added'));
});

test('parity rows compare exactly; changed and new rows are owner-graded and never compared', () => {
  const step = (dom, name = 'arrived') => ({ step: name, dom });
  const ctl = [step({ faces: [face('A')] })];
  assert.equal(gradeRow({ rowId: 'p', tag: 'parity' }, ctl, ctl).verdict, 'passed');
  const planted = gradeRow({ rowId: 'p', tag: 'parity' }, ctl, [
    step({ faces: [face('A', 'Generat')] }),
  ]);
  assert.equal(planted.verdict, 'failed');
  assert.equal(planted.steps[0].diffs[0].op, 'changed');
  assert.equal(
    gradeRow({ rowId: 'p', tag: 'parity' }, ctl, [step({ faces: [face('A')] }, 'other')]).reason,
    'different step sequence',
  );
  assert.deepEqual(gradeRow({ rowId: 'c', tag: 'changed', owner: 'ws-face' }, ctl, []), {
    rowId: 'c',
    verdict: 'owner-graded',
    owner: 'ws-face',
    tag: 'changed',
  });
  assert.equal(
    gradeRow({ rowId: 'n', tag: 'new', owner: 'ws-names' }, [], []).verdict,
    'owner-graded',
  );
  assert.equal(gradeRow({ rowId: 'p', tag: 'parity' }, [], []).verdict, 'untested');
});

test('reviewed MUI label wrappers and input sentinel preserve the semantic contract', () => {
  const button = (children, text) => ({ tag: 'button', attrs: { type: 'button' }, children, text });
  const old = { faces: [button([{ tag: 'span', text: 'Generate' }])] };
  const current = {
    faces: [
      button([], 'Generate'),
      { tag: 'span', attrs: { 'aria-hidden': 'true' }, text: '\u200b' },
    ],
  };
  assert.deepEqual(contractOf(old), contractOf(current));
  assert.notDeepEqual(contractOf(old), contractOf({ faces: [button([], 'Retry')] }));
  assert.notDeepEqual(
    contractOf(old),
    contractOf({ faces: [button([], 'Generate'), { tag: 'button', text: 'Extra' }] }),
  );
});

test('only a lower priority closed consent toast is ignored beside the visible model toast', () => {
  const consent = {
    tag: 'div',
    classes: ['next-consent-toast'],
    attrs: { role: 'alert' },
    text: 'Help us test?',
  };
  const model = {
    tag: 'div',
    classes: ['next-consent-toast', 'next-model-toast'],
    attrs: { role: 'alert' },
    text: 'Download',
  };
  assert.deepEqual(contractOf({ toasts: [model, consent] }), contractOf({ toasts: [model] }));
  assert.notDeepEqual(contractOf({ toasts: [consent] }), contractOf({ toasts: [] }));
});

test('a real failed browser run cannot pass just because its row is owner-graded', () => {
  const out = mkdtempSync(join(tmpdir(), 'parity-failed-browser-'));
  try {
    const run = spawnSync(
      process.execPath,
      [
        'apps/web/test/harness/run.ts',
        '--subject',
        join(out, 'missing-site'),
        '--name',
        'missing',
        '--source',
        'planted-missing-input',
        '--rows',
        'names.open-pick',
        '--out',
        out,
      ],
      { cwd: new URL('../..', import.meta.url), encoding: 'utf8', timeout: 60000 },
    );
    assert.equal(run.error, undefined);
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /"playwrightExit":1/);
    assert.match(run.stdout, /"ownerGraded":2/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('reviewed Checkbox and Slider restyles keep control labels and values', () => {
  const oldCheck = {
    tag: 'span',
    attrs: { 'aria-label': 'Pinch centre' },
    children: [{ tag: 'span', children: [{ tag: 'input', attrs: { type: 'checkbox' } }] }],
  };
  const nativeCheck = { tag: 'input', attrs: { type: 'checkbox', 'aria-label': 'Pinch centre' } };
  assert.deepEqual(contractOf({ faces: [oldCheck] }), contractOf({ faces: [nativeCheck] }));
  assert.notDeepEqual(
    contractOf({ faces: [oldCheck] }),
    contractOf({
      faces: [{ ...nativeCheck, attrs: { ...nativeCheck.attrs, 'aria-label': 'Wrong' } }],
    }),
  );
  const oldSlider = [
    { tag: 'input', attrs: { type: 'hidden', value: '1' } },
    { tag: 'span', attrs: { role: 'slider', 'aria-label': 'Morph frame', 'aria-valuenow': '1' } },
  ];
  const nativeSlider = {
    tag: 'input',
    attrs: { type: 'range', 'aria-label': 'Morph frame', 'aria-valuenow': '1' },
  };
  assert.deepEqual(contractOf({ faces: oldSlider }), contractOf({ faces: [nativeSlider] }));
  assert.notDeepEqual(
    contractOf({ faces: oldSlider }),
    contractOf({
      faces: [{ ...nativeSlider, attrs: { ...nativeSlider.attrs, 'aria-valuenow': '2' } }],
    }),
  );
});

test('only the explicitly retired WebGL option is excluded; other provider changes fail', () => {
  const opt = (value, text) => ({ tag: 'option', attrs: { value }, text });
  const control = {
    faces: [opt('cpu', 'CPU'), opt('webgl', 'WebGL GPU'), opt('webgpu', 'WebGPU')],
  };
  assert.deepEqual(
    contractOf(control),
    contractOf({ faces: [opt('cpu', 'CPU'), opt('webgpu', 'WebGPU')] }),
  );
  assert.notDeepEqual(contractOf(control), contractOf({ faces: [opt('cpu', 'CPU')] }));
});
