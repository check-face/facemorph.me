import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import { runtimeCacheKey } from './runtime-cache-key.mjs';

const inputs = JSON.parse(readFileSync(new URL('../../import/build-inputs.json', import.meta.url)));

test('unrelated inventory changes reuse the exact runtime, while every acquisition field invalidates it', () => {
  const key = runtimeCacheKey(inputs);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(
    runtimeCacheKey({ runtime: { assets: inputs.runtime.assets }, tests: ['new'] }),
    key,
  );
  for (const field of ['path', 'sha256', 'bytes', 'location', 'acquire']) {
    const changed = structuredClone(inputs);
    changed.runtime.assets[0][field] = field === 'bytes' ? 1 : 'changed';
    assert.notEqual(runtimeCacheKey(changed), key, field);
  }
  const removed = structuredClone(inputs);
  removed.runtime.assets.pop();
  assert.notEqual(runtimeCacheKey(removed), key);
  for (const invalid of [null, {}, { runtime: { assets: [] } }])
    assert.throws(() => runtimeCacheKey(invalid), /Runtime asset inventory required/);
});

test('hosted and self-hosted caches use the asset key and retain full acquisition and pin verification', () => {
  const action = parse(
    readFileSync(
      new URL('../../.github/actions/setup-runtime/action.yml', import.meta.url),
      'utf8',
    ),
  );
  const steps = action.runs.steps;
  assert.match(steps[0].run, /pins=\$\(node scripts\/ci\/runtime-cache-key\.mjs\)/);
  assert.match(steps[0].run, /pins=\$pins/);
  assert.match(
    steps.find((step) => step.uses === 'actions/cache@v4').with.key,
    /steps.runtime.outputs.pins/,
  );
  assert(
    steps.some((step) => step.run === 'node scripts/runtime/acquire-ci.mjs --cache "$RUNTIME_DIR"'),
  );
  assert(
    steps.some((step) =>
      step.run?.includes('node scripts/runtime/check-pins.mjs --runtime "$RUNTIME_DIR"'),
    ),
  );
});
