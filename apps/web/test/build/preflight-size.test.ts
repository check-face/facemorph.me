import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkerSize } from '../../build/preflight-size.ts';

test('checker size includes shared dependencies and worker; a planted oversize dependency fails', () => {
  const directory = mkdtempSync(join(tmpdir(), 'preflight-size-'));
  try {
    mkdirSync(join(directory, '.vite'));
    writeFileSync(
      join(directory, '.vite/manifest.json'),
      JSON.stringify({
        'preflight-check.html': { file: 'check.js', imports: ['shared'] },
        shared: { file: 'shared.js' },
      }),
    );
    writeFileSync(
      join(directory, 'worker-inventory.json'),
      JSON.stringify({ emitted: [{ source: 'src/preflight/cpu-worker.mjs', file: 'worker.js' }] }),
    );
    for (const name of ['check.js', 'shared.js', 'worker.js'])
      writeFileSync(join(directory, name), 'small');
    assert.equal(checkerSize(directory).chunks.length, 3);
    writeFileSync(join(directory, 'shared.js'), randomBytes(110 * 1024));
    assert.throws(() => checkerSize(directory), /exceeds/);
    writeFileSync(join(directory, 'worker-inventory.json'), '{"emitted":[]}');
    assert.throws(() => checkerSize(directory), /worker missing/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
