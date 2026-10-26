// DOM contract projection, diff and row grading (fm-q007), with plain values.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquisitionPair,
  cancelledRetryContract,
  contractOf,
  debugPromptContract,
  DECLARED_DEBUG,
  diffContracts,
  gradeRow,
  morphOptionsContract,
  onePromptPair,
  progressContract,
  retiredLinksContract,
  runningCancelContract,
  seedFieldContract,
  seedLiteralContract,
  tileStatesContract,
  videoFormatContract,
} from './dom-contract.mjs';

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

test('declared arrival tile changes retain checks on labels, action presence, placement and disabled state', () => {
  const input = (label) => ({ tag: 'input', attrs: { type: 'file', 'aria-label': label } });
  const action = {
    tag: 'button',
    classes: ['next-face-generate'],
    attrs: { type: 'button', 'aria-label': 'Generate Morph from' },
    text: 'Generate',
  };
  const close = {
    tag: 'button',
    classes: ['next-face-close'],
    attrs: { type: 'button', 'aria-label': 'Remove Morph from' },
  };
  const field = { tag: 'div', classes: ['next-input-row'], text: 'Morph from' };
  const actions = { tag: 'div', classes: ['next-face-actions'] };
  const image = (children) => ({ tag: 'div', classes: ['next-face-image'], children });
  const dom = (children) => ({ faces: [{ tag: 'section', classes: ['next-face'], children }] });
  const legacy = dom([
    input('Choose photo'),
    image([{ tag: 'span', classes: ['next-sr'], text: 'Cached preview' }, close]),
    field,
    action,
    actions,
  ]);
  const current = dom([
    input('Encode image'),
    image([close]),
    field,
    { ...action, classes: ['next-face-generate', 'next-face-operation'] },
    actions,
  ]);
  const grade = (subject) =>
    gradeRow(
      { rowId: 'first-visit', tag: 'parity' },
      [{ step: 'arrived', dom: legacy }],
      [{ step: 'arrived', dom: subject }],
    ).verdict;
  assert.equal(grade(current), 'passed');
  for (const mutate of [
    (d) => {
      d.faces[0].children.splice(3, 1); // no action
    },
    (d) => {
      d.faces[0].children[3].attrs['aria-label'] = 'Generate the wrong face';
    },
    (d) => {
      d.faces[0].children[3].attrs.disabled = '';
    },
    (d) => {
      d.faces[0].children[1].children.unshift(d.faces[0].children.splice(3, 1)[0]); // back in the image
    },
    (d) => {
      d.faces[0].children[2].text = 'Morph form';
    },
    (d) => {
      d.faces[0].children.shift(); // no card chooser
    },
    (d) => {
      d.faces[0].children[0].attrs['aria-label'] = 'Choose photo'; // old name
    },
  ]) {
    const changed = structuredClone(current);
    mutate(changed);
    assert.equal(grade(changed), 'failed');
  }
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

test('the declared first-visit prompt move keeps checks on its label, role and actions row', async () => {
  const { arrivalPromptContract } = await import('./dom-contract.mjs');
  const retained = [
    {
      region: 'toasts',
      next: ['next-consent-toast', 'next-model-toast'],
      attrs: { role: 'alert' },
      text: '',
    },
    { region: 'toasts', next: [], attrs: {}, text: 'Faces are made on this device.' },
    { region: 'toasts', tag: 'button', next: [], attrs: { type: 'button' }, text: 'Not now' },
  ];
  const current = [
    {
      region: 'toasts',
      next: ['next-consent-toast', 'next-first-visit', 'next-model-toast'],
      attrs: { 'aria-label': 'Face model download', role: 'region' },
      text: '',
    },
    { region: 'toasts', next: [], attrs: {}, text: 'Faces are made on this device.' },
    { region: 'toasts', next: ['next-first-visit-actions'], attrs: {}, text: '' },
    { region: 'toasts', tag: 'button', next: [], attrs: { type: 'button' }, text: 'Not now' },
  ];
  const same = (a, b) =>
    JSON.stringify(arrivalPromptContract(a)) === JSON.stringify(arrivalPromptContract(b));
  assert.ok(same(retained, current));
  const withoutLabel = structuredClone(current);
  delete withoutLabel[0].attrs['aria-label'];
  const oldRole = structuredClone(current);
  oldRole[0].attrs.role = 'alert';
  const noActionsRow = current.filter((e) => !e.next.includes('next-first-visit-actions'));
  for (const changed of [withoutLabel, oldRole, noActionsRow]) assert.ok(!same(retained, changed));
});

// fm-fy2.5: the reviewed declared changes, each mapping only its retained form and leaving everything else exact.
const E = (text, extra = {}) => ({ region: 'faces', next: [], attrs: {}, text, ...extra });

test('declared morph options (fm-36ag): per-face wording, Custom, video length and the Video choice; other text fails', () => {
  const retained = [
    E('', { tag: 'select', attrs: { 'aria-label': 'Morph length', disabled: 'true' } }),
    E('Length: short · 8 frames per segment'),
    E('Length: long · 32 frames per segment'),
    E('16 frames total', { next: ['next-frame-count'] }),
    E('Pinch centre'),
  ];
  const declared = morphOptionsContract(retained);
  assert.deepEqual(
    declared.map((e) => e.text),
    [
      '',
      'Length: short · 8 frames per face',
      'Length: long · 32 frames per face',
      'Custom · choose frames per face',
      '16 frames total · <ms> video',
      '',
      '',
      'Video',
      '',
      'Standard · 512 × 512',
      'Full quality · up to 1024 × 1024',
      'Quicker, smaller files that play everywhere.',
      'Pinch centre',
    ],
  );
  assert.equal(
    declared.find((e) => e.attrs['aria-label'] === 'Video size').attrs.disabled,
    'true',
    'disabled with Length',
  );
  // A subject that dropped the Video choice, or kept per-segment wording, still differs.
  assert.ok(
    diffContracts(
      declared,
      declared.filter((e) => e.text !== 'Full quality · up to 1024 × 1024'),
    ).length,
  );
  assert.ok(diffContracts(morphOptionsContract(retained), retained).length);
});

test('declared debug prompt (fm-szbf) and the one-prompt rule before the first face', () => {
  const toast = (text, extra = {}) => ({ region: 'toasts', next: [], attrs: {}, text, ...extra });
  const retained = [
    toast('', { next: ['next-consent-toast'], attrs: { role: 'alert' } }),
    toast(
      'Send debug reports: timings, device type and error codes. Never your photos, words or faces. Kept with no deletion date.',
      { next: ['next-consent-message'] },
    ),
    toast('Help us test?'),
    toast('Turn on', { tag: 'button', attrs: { type: 'button' } }),
    toast('No thanks', { tag: 'button', attrs: { type: 'button' } }),
  ];
  const declared = debugPromptContract(retained);
  assert.deepEqual(declared[0].attrs, { 'aria-label': 'Debug reporting', role: 'region' });
  assert.equal(declared[1].text, DECLARED_DEBUG);
  assert.deepEqual(
    declared.slice(3).map((e) => e.text),
    ['', 'Turn on debug reporting', 'No thanks'],
  );
  // Before the first face the model prompt replaces the debug prompt; nothing else is excused.
  const model = [
    toast('', { next: ['next-consent-toast', 'next-first-visit', 'next-model-toast'] }),
    toast('Faces are made on this device.'),
  ];
  const [c, sub] = onePromptPair([E('x'), ...declared], [E('x'), ...model]);
  assert.deepEqual(diffContracts(c, sub), []);
  const [c2, s2] = onePromptPair([E('x'), ...declared], [E('y'), ...model]);
  assert.equal(diffContracts(c2, s2).length, 1, 'other entries still compare');
  const [c3, s3] = onePromptPair([E('x'), ...declared, ...model], [E('x'), ...model]);
  assert.ok(
    diffContracts(c3, s3).length,
    'not excused when the control also shows the model prompt',
  );
});

test('declared tile states (fm-25um): no instant picture, no Generate on a verified tile; other tiles compare', () => {
  const tile = (state) =>
    E('', { next: ['next-face'], attrs: { 'data-next-face': 'face-2', 'data-next-state': state } });
  const generate = E('Generate', {
    tag: 'button',
    next: ['next-face-generate', 'next-face-operation'],
    attrs: { 'aria-label': 'Generate Morph to', type: 'button' },
  });
  assert.deepEqual(
    tileStatesContract([tile('preview'), E('', { next: ['next-face-img'] }), generate]),
    [tile('empty'), E('Press Generate to make this face', { next: ['next-face-hint'] }), generate],
  );
  assert.deepEqual(tileStatesContract([tile('filled'), generate]), [tile('filled')]);
  assert.deepEqual(tileStatesContract([tile('empty'), generate]), [tile('empty'), generate]);
});

test('declared retirement, progress copy, result size and seed field change only their own entries', () => {
  const link = (text) => ({ region: 'notes', tag: 'a', next: [], attrs: {}, text });
  assert.deepEqual(
    retiredLinksContract([link('Desktop app capabilities and availability'), link('Privacy')]),
    [link('Privacy')],
  );
  assert.deepEqual(
    progressContract([E('Face 1 of 2'), E('Face 1 of 2', { next: ['next-x'] })]).map((e) => e.text),
    ['Generating this face…', 'Face 1 of 2'],
  );
  const share = E('Share morph', { tag: 'button', attrs: { type: 'button' } });
  const withSize = videoFormatContract([E('', { next: ['next-actions'] }), share]);
  assert.deepEqual(withSize[1], {
    region: 'faces',
    next: ['next-video-format'],
    attrs: { 'data-next-video-width': '512' },
    text: 'MP4 · 512 × 512',
  });
  assert.ok(
    diffContracts(withSize, [
      E('', { next: ['next-actions'] }),
      E('MP4 · 1024 × 1024', {
        next: ['next-video-format'],
        attrs: { 'data-next-video-width': '1024' },
      }),
      share,
    ]).length,
    'a different size fails',
  );
  assert.deepEqual(
    seedFieldContract([
      E('', { tag: 'input', attrs: { type: 'number' } }),
      E('', { tag: 'input', attrs: { type: 'file' } }),
    ]).map((e) => e.attrs.type),
    ['text', 'file'],
  );
});

test('the seed literal rule (fm-25um) keeps the date and refuses Generate on that tile', () => {
  const tile = E('', {
    next: ['next-face'],
    attrs: { 'data-next-face': 'face-2', 'data-next-state': 'empty' },
  });
  const hint = E('Press Generate to make this face', { next: ['next-face-hint'] });
  const generate = E('Generate', {
    tag: 'button',
    attrs: { 'aria-label': 'Generate Morph to', type: 'button' },
  });
  const declared = seedLiteralContract([tile, hint, generate]);
  assert.deepEqual(
    declared.map((e) => e.text),
    ['', '', 'Use a whole number from 0 to 4294967295.', 'Generate'],
  );
  assert.equal(declared.at(-1).attrs.disabled, 'true');
});

test('declared running Cancel and Retry (fm-25um) move to the operation action; a missing action still fails', () => {
  const op = (label, text, disabled) =>
    E(text, {
      tag: 'button',
      next: ['next-face-generate', 'next-face-operation'],
      attrs: { 'aria-label': label, ...(disabled ? { disabled: 'true' } : {}), type: 'button' },
    });
  const retained = [
    E('', {
      next: ['next-face'],
      attrs: { 'data-next-face': 'face-2', 'data-next-state': 'empty' },
    }),
    E('', { next: ['next-tile-status'], attrs: { role: 'status' } }),
    E('Generating this face…'),
    E('Cancel', { tag: 'button', attrs: { type: 'button' } }),
    op('Generate Morph to', 'Generate', true),
  ];
  const declared = runningCancelContract(retained);
  assert.deepEqual(declared.at(-1), op('Cancel Morph to', 'Cancel', false));
  assert.equal(declared.length, retained.length - 1);
  assert.ok(diffContracts(declared, declared.slice(0, -1)).length, 'no Cancel at all fails');
  assert.deepEqual(cancelledRetryContract([op('Generate Morph to', 'Generate', false)]), [
    op('Retry Morph to', 'Retry', false),
  ]);
  assert.deepEqual(cancelledRetryContract([op('Generate Morph to', 'Generate', true)]), [
    op('Generate Morph to', 'Generate', true),
  ]);
});

test('declared in-action progress (fm-vbj7) reads as the action start only where the control shows that start', () => {
  const control = [
    E('Generating this face…'),
    E('', {
      next: ['next-face-progress'],
      attrs: { 'aria-label': 'Morph to progress', role: 'progressbar' },
    }),
    E('Morph to'),
  ];
  const subject = [
    E('Downloading model files… 23 MB of 158 MB'),
    E('', {
      next: ['next-face-progress'],
      attrs: { 'aria-label': 'Morph to progress', 'aria-valuenow': '14.2', role: 'progressbar' },
    }),
    E('Morph to'),
  ];
  assert.deepEqual(diffContracts(...acquisitionPair(control, subject)), []);
  assert.deepEqual(
    diffContracts(...acquisitionPair(control, [E('Generating…'), control[1], E('Morph to')])),
    [],
  );
  // Other differences in the step still fail, and nothing is mapped where the control did not show the start.
  assert.equal(
    diffContracts(...acquisitionPair(control, [...subject.slice(0, 2), E('Morph from')])).length,
    1,
  );
  const idle = [E('Ready'), E('Morph to')];
  assert.ok(
    diffContracts(...acquisitionPair(idle, [E('Downloading model files…'), E('Morph to')])).length,
  );
});
