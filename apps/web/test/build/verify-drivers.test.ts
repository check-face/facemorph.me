// The drivers' plain parts (fm-48bj): visual order of focus stops, the sweep's points, breakpoints from built files.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  builtBreakpoints,
  SWEEP_WIDTHS,
  sweepPoints,
  visualOrderProblems,
  type FocusStop,
} from '../verify/harness.ts';

const stop = (element: string, x: number, y: number): FocusStop => ({
  element,
  box: { x, y, width: 100, height: 40 },
  focusVisible: true,
});

test('focus stops in reading order pass; one reached before a stop it sits after is reported', () => {
  const row = [stop('a', 0, 0), stop('b', 120, 0), stop('c', 240, 0), stop('d', 0, 60)];
  assert.deepEqual(visualOrderProblems(row), []);
  assert.deepEqual(visualOrderProblems([row[0]!, row[2]!, row[1]!, row[3]!]), [
    'b is reached after c but sits before it',
  ]);
  assert.deepEqual(visualOrderProblems([row[3]!, row[0]!]), [
    'a is reached after d but sits before it',
  ]);
  assert.deepEqual(
    visualOrderProblems([stop('x', 0, 0), stop('y', 0, 10)]),
    [],
    'a few px lower is the same row',
  );
});

test('the sweep has every declared width, each CSS breakpoint at +/-1 px, orientation, height, zoom and text', () => {
  const points = sweepPoints(599, [600, 768]);
  const widths = new Set(points.map((p) => p.width));
  for (const w of [...SWEEP_WIDTHS, 599, 600, 601, 767, 768, 769]) assert.ok(widths.has(w), `${w}`);
  const byId = Object.fromEntries(points.map((p) => [p.id, p]));
  assert.equal(byId['599x900']!.hasTouch, true);
  assert.equal(byId['601x900']!.hasTouch, false);
  assert.equal(byId['landscape-844x390']!.hasTouch, true, 'a landscape phone keeps touch');
  assert.equal(byId['zoom-200-1280']!.deviceScaleFactor, 2);
  assert.equal(byId['zoom-200-1280']!.width, 640, '200 % zoom at 1280 lays out at 640 CSS px');
  assert.equal(byId['text-200-390']!.textScale, 2);
  assert.ok(byId['short-1280x480']);
});

test('breakpoints are read from built CSS files and inline style blocks, nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-css-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(
    join(dir, 'assets/a.css'),
    '@media (min-width:600px){.a{}}@media (max-width:47.9375em){.b{}}',
  );
  writeFileSync(
    join(dir, 'index.html'),
    '<style>@container (min-width: 30rem){.c{}}</style><p>@media (min-width:999px)</p>',
  );
  writeFileSync(join(dir, 'assets/a.js'), "css('@media (min-width:1100px){}')");
  assert.deepEqual(builtBreakpoints(dir), [480, 600, 767]);
});
