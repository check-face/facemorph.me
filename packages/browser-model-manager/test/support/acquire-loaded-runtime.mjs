// Acquire only the pinned CPU generator component's real inputs, using the existing digest-verifying acquirer.
// No encoder weights, model changes, app serving surface or qualification receipts are manufactured here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { acquire, TERMS } from '../../../../scripts/runtime/acquire.mjs';

if (process.env.ACCEPT_MODEL_TERMS !== 'yes') {
  console.error(TERMS);
  process.exit(2);
}
const cache = resolve(process.argv[2] || '.cache/manager-loaded-runtime');
const inputs = JSON.parse(
  readFileSync(new URL('../../../../import/build-inputs.json', import.meta.url)),
);
const pin = 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c';
const manifestRow = inputs.runtime.assets.find((row) => row.path === 'manifest.json');
assert.equal(manifestRow?.sha256, pin);
// The same immutable overlay manifest is published on the allowed runtime origin. Verify its frozen digest,
// avoiding a classic checkout solely to retrieve this one metadata file on hosted component runners.
const manifestResult = await acquire({
  rows: [{ ...manifestRow, location: 'https://next.facemorph.me/runtime/manifest.json' }],
  cache,
  log: (entry) => console.log(JSON.stringify(entry)),
});
assert.equal(manifestResult.failed.length, 0, 'Pinned manifest acquisition failed');
const manifest = JSON.parse(readFileSync(resolve(cache, 'manifest.json')));
const assets = new Map();
function visit(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value.chunks)) {
    for (const chunk of value.chunks) visit(chunk);
    return;
  }
  if (typeof value.sha256 === 'string' && typeof value.url === 'string') {
    const url = new URL(value.url);
    assert.equal(url.origin, 'https://next.facemorph.me');
    assert.ok(url.pathname.startsWith('/runtime/'));
    const path = url.pathname.slice('/runtime/'.length);
    const row = inputs.runtime.assets.find((row) => row.path === path);
    assert.equal(
      row?.sha256,
      value.sha256,
      'Manifest asset must match the frozen runtime inventory',
    );
    assert.equal(row.bytes, value.size);
    assets.set(path, row);
    return;
  }
  for (const item of Array.isArray(value) ? value : Object.values(value)) visit(item);
}
visit([
  manifest.runtime,
  manifest.mapping,
  manifest.average,
  manifest.noise,
  manifest.synthesis,
  manifest.sampleIndices,
  manifest.canaries[0],
]);
assert.equal(
  assets.size,
  34,
  'The component must acquire its exact pinned CPU files, including eight synthesis chunks',
);
assert.equal(
  [...assets.values()].reduce((sum, row) => sum + row.bytes, 0),
  157405379,
);
const result = await acquire({
  rows: [...assets.values()],
  cache,
  log: (entry) => console.log(JSON.stringify(entry)),
});
assert.equal(result.failed.length, 0, 'Pinned component asset acquisition failed');
console.log(
  JSON.stringify({
    component: 'loaded-browser',
    manifestSha256: pin,
    cache,
    assets: assets.size,
    bytes: [...assets.values()].reduce((sum, row) => sum + row.bytes, 0),
    result,
  }),
);
