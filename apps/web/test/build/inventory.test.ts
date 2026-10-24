// The emitted and hosted worker inventories and their identity, with plain values and real files.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  emittedFromBundle,
  hostedWorkers,
  inventoryFindings,
  workerInventory,
} from '../../build/worker-inventory.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const hosted = [{ path: 'assets/a/ort-wasm-simd-threaded.mjs', sha256: sha('ort') }];

test('emitted workers are named by source, file and the hash of their bytes', () => {
  const [w] = emittedFromBundle('/repo/apps/web', [
    {
      facadeModuleId: '/repo/apps/web/src/Next/video-worker.mjs',
      fileName: 'assets/video-worker-x.js',
      code: 'video',
    },
    { facadeModuleId: null, fileName: 'assets/shared.js', code: 'shared' },
  ]);
  assert.deepEqual(w, {
    source: 'src/Next/video-worker.mjs',
    file: 'assets/video-worker-x.js',
    sha256: sha('video'),
  });
});

test('the identity covers both graphs: a change in either changes it, order does not', () => {
  const a = { source: 'src/Next/a.mjs', file: 'assets/a.js', sha256: sha('a') };
  const b = { source: 'src/Next/b.mjs', file: 'assets/b.js', sha256: sha('b') };
  const base = workerInventory([a, b], hosted).identity;
  assert.equal(workerInventory([b, a], hosted).identity, base);
  assert.notEqual(workerInventory([a, { ...b, sha256: sha('b2') }], hosted).identity, base);
  assert.notEqual(workerInventory([a, b], [{ ...hosted[0]!, sha256: sha('ort2') }]).identity, base);
});

test('hosted workers come from the pinned graph in build-inputs', () => {
  assert.deepEqual(
    hostedWorkers({
      worker_graphs: {
        pinned: [{ path: 'p', sha256: 'h', location: 'x' } as { path: string; sha256: string }],
      },
    }),
    [{ path: 'p', sha256: 'h' }],
  );
});

test('a built file that differs from the inventory, a missing one and a forged identity are found', () => {
  const dist = mkdtempSync(join(tmpdir(), 'inventory-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'assets/a.js'), 'a');
  const inv = workerInventory(
    [{ source: 'src/Next/a.mjs', file: 'assets/a.js', sha256: sha('a') }],
    hosted,
  );
  assert.deepEqual(inventoryFindings(inv, dist), []);
  writeFileSync(join(dist, 'assets/a.js'), 'rebuilt');
  assert.match(inventoryFindings(inv, dist)[0] ?? '', /hashes .* inventory says/);
  const missing = workerInventory(
    [{ source: 'src/Next/b.mjs', file: 'assets/b.js', sha256: sha('b') }],
    hosted,
  );
  assert.match(inventoryFindings(missing, dist)[0] ?? '', /hashes missing/);
  writeFileSync(join(dist, 'assets/a.js'), 'a');
  assert.match(
    inventoryFindings({ ...inv, identity: sha('forged') }, dist)[0] ?? '',
    /does not follow/,
  );
});
