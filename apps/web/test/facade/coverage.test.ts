// The facade's coverage checklist (fm-pia9): every [<Import>] in classic Product.fs (recorded in
// test/fixtures/facade/product-fs-imports.json from b2d945a8) maps to one typed facade export. A rename is the
// facade's name for the same function (the crop view's verbs, and the bridge's *Reported photo steps).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as facade from '../../shell/facade/bridge.ts';

const RENAMED: Readonly<Record<string, string>> = {
  previewPhotoReported: 'previewPhoto',
  cropPhotoReported: 'cropPhoto',
  selectPhotoReported: 'selectPhoto',
  pan: 'panCrop',
  rotate: 'rotateCrop',
  rect: 'cropRect',
  resizeViewport: 'resizeCrop',
};
const recorded = JSON.parse(
  readFileSync(new URL('../fixtures/facade/product-fs-imports.json', import.meta.url), 'utf8'),
) as { imports: { module: string; name: string }[] };

// fm-25um: hold-to-compare removed. fm-k09b: the pan/zoom square became the stencil editor (no zoom, no frame).
const RETIRED = new Set(['rememberSourcePhoto', 'sourcePhotoUrl', 'zoomTo', 'frame']);
test('every retained Product.fs import has its typed facade export; retired comparison helpers are absent', (t) => {
  const exports = facade as unknown as Record<string, unknown>;
  const missing: string[] = [];
  for (const { module, name } of recorded.imports) {
    const as = RENAMED[name] ?? name;
    const value = exports[as];
    if (RETIRED.has(name)) {
      assert.equal(value, undefined, `${name}: fm-25um removes the comparison facade`);
      continue;
    }
    t.diagnostic(`${module} ${name} -> ${as}: ${typeof value}`);
    if (value === undefined) missing.push(`${module} ${name} (facade ${as})`);
  }
  assert.ok(recorded.imports.length >= 60, 'the recorded import list is incomplete');
  assert.deepEqual(missing, []);
});
