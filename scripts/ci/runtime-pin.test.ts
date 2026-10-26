// fm-369d: the mobile product runtime cache is keyed by the pinned runtime manifest SHA-256 itself, so a
// runtime-mirror manifest change misses the cache instead of restoring stale bytes; and every workflow that
// pins the runtime pins the same value, so changing it in one place cannot leave another lane on the old one.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const ROOT = new URL('../../', import.meta.url).pathname;
const WORKFLOWS = join(ROOT, '.github/workflows');
const SHA = /^[0-9a-f]{64}$/;

type Step = { uses?: string; with?: Record<string, string>; run?: string };
type Job = { env?: Record<string, string>; steps?: Step[] };
const workflow = (name: string) =>
  parse(readFileSync(join(WORKFLOWS, name), 'utf8')) as { jobs: Record<string, Job> };

test('the iOS product runtime cache key is derived from the job runtime pin, and the run uses the same pin', () => {
  const job = workflow('mobile-browser.yml').jobs['ios-product-simulator']!;
  const pin = job.env?.['RUNTIME_SHA'];
  assert.match(pin ?? '', SHA, 'the job pins one runtime manifest SHA-256');
  const cache = job.steps!.find((s) => s.uses?.startsWith('actions/cache@'));
  assert.equal(cache?.with?.['key'], 'mobile-runtime-sha256-${{ env.RUNTIME_SHA }}');
  const product = job.steps!.find((s) => s.run?.includes('next-ios-sim.py'));
  assert.match(product?.run ?? '', /--runtime-sha "\$RUNTIME_SHA"/);
  assert.doesNotMatch(
    product?.run ?? '',
    /[0-9a-f]{64}/,
    'no second literal pin beside the variable',
  );
});

test('a different runtime manifest gives a different cache key (the change misses)', () => {
  const key = (sha: string) =>
    'mobile-runtime-sha256-${{ env.RUNTIME_SHA }}'.replace('${{ env.RUNTIME_SHA }}', sha);
  const current =
    workflow('mobile-browser.yml').jobs['ios-product-simulator']!.env!['RUNTIME_SHA']!;
  const changed = current.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
  assert.notEqual(key(changed), key(current));
});

test('every workflow pins the same runtime manifest SHA-256', () => {
  const pins = new Map<string, string[]>();
  for (const file of readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml'))) {
    const text = readFileSync(join(WORKFLOWS, file), 'utf8');
    for (const match of text.matchAll(
      /(?:runtime_sha|RUNTIME_SHA|runtime-sha)\W{1,6}([0-9a-f]{64})/gi,
    )) {
      const where = pins.get(match[1]!) ?? [];
      where.push(file);
      pins.set(match[1]!, where);
    }
  }
  assert.ok(pins.size >= 1, 'workflows pin a runtime');
  assert.equal(pins.size, 1, `runtime pins differ: ${JSON.stringify(Object.fromEntries(pins))}`);
});
