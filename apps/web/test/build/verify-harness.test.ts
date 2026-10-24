// The verification harness's plain values (fm-48bj): text variants, seeds, breakpoints, sweep and manifest.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aroundBreakpoints,
  breakpoints,
  GRID_COUNTS,
  manifestProblems,
  SEEDS,
  stepId,
  SWEEP_WIDTHS,
  sweepViewports,
  textOfBytes,
  textVariants,
} from '../verify/harness.ts';

const bytes = (s: string) => new TextEncoder().encode(s).length;

test('the long text variants are exactly 512 and 513 UTF-8 bytes and contain multibyte characters', () => {
  const v = Object.fromEntries(textVariants().map((t) => [t.id, t]));
  assert.equal(bytes(v['bytes-512']!.text), 512);
  assert.equal(bytes(v['bytes-513']!.text), 513);
  for (const id of ['bytes-512', 'bytes-513'])
    assert.ok(
      [...v[id]!.text].some((c) => bytes(c) > 1),
      `${id} has a multibyte character`,
    );
  assert.equal(v['empty']!.text, '');
  assert.equal(v['whitespace']!.text.trim(), '');
  assert.equal(v['ime']!.entry, 'ime');
  assert.equal(v['pasted']!.entry, 'paste');
  for (const n of [0, 1, 2, 3, 4, 511, 512, 513]) assert.equal(bytes(textOfBytes(n, '顔')), n);
});

test('the seed set covers the uint32 edges, one past them, a negative, a fraction and pasted spaces', () => {
  const texts = SEEDS.map((s) => s.text);
  for (const t of ['0', '4294967295', '4294967296', '-1', '1.5']) assert.ok(texts.includes(t), t);
  assert.ok(
    texts.some((t) => /^\s*\d+\s+\d+\s*$/.test(t)),
    'pasted digits with spaces',
  );
});

test('breakpoints come from media and container queries in px, em and rem, min, max and range syntax', () => {
  const css = [
    '@media (min-width:600px){.a{}}',
    '@media screen and (max-width: 47.9375em){.b{}}',
    '@media (min-width:64rem) and (max-width:1279.95px){.c{}}',
    '@container face (min-width: 30em){.d{}}',
    '@media (width >= 900px){.e{}}',
    '@media (400px < width){.f{}}',
    '@media (min-height:500px){.g{}}', // a height query is not a width breakpoint
    '.h{width:700px}', // nor a declaration outside a query
  ].join('');
  assert.deepEqual(breakpoints(css), [400, 480, 600, 767, 900, 1024, 1279.95]);
  assert.deepEqual(aroundBreakpoints([600, 601]), [599, 600, 601, 602]);
});

test('the sweep is the declared widths with touch at or below the breakpoint', () => {
  assert.deepEqual(SWEEP_WIDTHS, [320, 360, 390, 480, 600, 768, 900, 1024, 1280, 1920, 2560]);
  assert.deepEqual(GRID_COUNTS, [1, 2, 3, 4, 8, 30, 64, 150]);
  const v = sweepViewports(599);
  assert.deepEqual(
    v.filter((x) => x.hasTouch).map((x) => x.width),
    [320, 360, 390, 480],
  );
  assert.ok(v.every((x) => x.hasTouch === x.isMobile));
});

test('a case that maps to no flow-matrix row or defect fails validation', () => {
  const ok = {
    bead: 'verify.input',
    cases: [{ id: 'remove-to-one', steps: ['press-remove'], rows: ['face.remove'], defects: [1] }],
  };
  assert.deepEqual(manifestProblems(ok, new Set(['face.remove'])), []);
  assert.equal(
    stepId('verify.input', 'remove-to-one', 'press-remove'),
    'verify.input/remove-to-one/press-remove',
  );
  const unmapped = { bead: 'verify.input', cases: [{ id: 'x', steps: ['s'] }] };
  assert.match(
    manifestProblems(unmapped).join('\n'),
    /maps to no flow-matrix row or candidate defect/,
  );
  const bad = {
    bead: 'Verify Input',
    cases: [
      { id: 'a', steps: [], rows: ['nope'], cells: ['phone-gpu'], widths: [0] },
      { id: 'a', steps: ['s'], defects: [0] },
    ],
  };
  const problems = manifestProblems(bad, new Set(['face.remove'])).join('\n');
  for (const p of [
    /is not a plan key/,
    /no steps/,
    /unknown flow-matrix row nope/,
    /unknown lab cell phone-gpu/,
    /width 0/,
    /duplicate case id/,
    /defect 0/,
  ])
    assert.match(problems, p);
});
