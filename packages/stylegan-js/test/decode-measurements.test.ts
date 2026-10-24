// The decode-ceiling measurements (fm-4cp) sit beside the frozen limits constants they were taken
// at, so the milestone-2 ceilings row reads both from one place. Each file must have been measured at
// exactly the limits crop-policy.ts freezes, and say which routes it did not measure (not admitted).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CROP_MAX_BYTES, CROP_MAX_EDGE, CROP_MAX_PIXELS } from '../src/index.ts';

const dir = new URL('../src/contracts/decode-measurements/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

test('measurement files sit beside the limits constants', () => {
  assert.ok(readdirSync(new URL('../src/contracts/', import.meta.url)).includes('crop-policy.ts'));
  assert.ok(files.length >= 1, 'no decode measurements beside crop-policy.ts');
});

test('each measurement was taken at the frozen limits, with raw rows and its not-admitted list', () => {
  for (const file of files) {
    const m = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    assert.deepEqual(m.limits, { CROP_MAX_BYTES, CROP_MAX_PIXELS, CROP_MAX_EDGE }, file);
    for (const key of ['machine', 'browser', 'browser_version', 'classic_commit', 'lease_run_id']) assert.ok(m[key], `${file}: ${key}`);
    assert.ok(Array.isArray(m.rows) && m.rows.length > 0, file);
    for (const r of m.rows) assert.ok(typeof r.route === 'string' && typeof r.fixture === 'string' && typeof r.representation === 'string' && (r.ok === false || Number.isSafeInteger(r.peak_bytes)), `${file}: ${JSON.stringify(r)}`);
    assert.ok(Array.isArray(m.not_measured), `${file}: not_measured`);
  }
});
