// fm-369d: every workflow that pins the runtime pins the same value, so changing it in one place cannot leave
// another lane on the old one. Read as text (no YAML dependency).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const WORKFLOWS = join(ROOT, '.github/workflows');

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
