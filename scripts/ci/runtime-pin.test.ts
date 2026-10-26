// fm-369d: the mobile product runtime cache is keyed by the pinned runtime manifest SHA-256 itself, so a
// runtime-mirror manifest change misses the cache instead of restoring stale bytes; and every workflow that
// pins the runtime pins the same value, so changing it in one place cannot leave another lane on the old one.
// Read as text (no YAML dependency): the job block is the lines between its key and the next job key.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const WORKFLOWS = join(ROOT, '.github/workflows');

function jobBlock(file: string, job: string): string {
  const lines = readFileSync(join(WORKFLOWS, file), 'utf8').split('\n');
  const start = lines.findIndex((l) => l === `  ${job}:`);
  assert.ok(start >= 0, `${file} has job ${job}`);
  const end = lines.findIndex((l, i) => i > start && /^ {2}[a-z0-9-]+:\s*$/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}
const block = () => jobBlock('mobile-browser.yml', 'ios-product-simulator');
const pin = () => /^\s+RUNTIME_SHA:\s*([0-9a-f]{64})\s*$/m.exec(block())?.[1];

test('the iOS product runtime cache key is derived from the job runtime pin, and the run uses the same pin', () => {
  assert.match(pin() ?? '', /^[0-9a-f]{64}$/, 'the job pins one runtime manifest SHA-256');
  assert.match(block(), /^\s+key:\s*mobile-runtime-sha256-\$\{\{ env\.RUNTIME_SHA \}\}\s*$/m);
  const run = block()
    .split('\n')
    .find((l) => l.includes('next-ios-sim.py'));
  assert.ok(run, 'the product step runs next-ios-sim.py');
  assert.match(run, /--runtime-sha "\$RUNTIME_SHA"/);
  assert.doesNotMatch(run, /[0-9a-f]{64}/, 'no second literal pin beside the variable');
});

test('a different runtime manifest gives a different cache key (the change misses)', () => {
  const key = (sha: string) => `mobile-runtime-sha256-${sha}`;
  const current = pin()!;
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
