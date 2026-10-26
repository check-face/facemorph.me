// Module survival scan (fm-fy2.19) over the real repository, then over a real copy of the files it reads with a
// planted deletion, an unmapped move, an unlisted test and a removed capability.
import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MAP_PATH, scanSurvival, type SurvivalMap } from '../../build/survival-scan.ts';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const map = JSON.parse(readFileSync(join(repo, MAP_PATH), 'utf8')) as SurvivalMap;

function copy(): string {
  const root = mkdtempSync(join(tmpdir(), 'fm-survival-'));
  const paths = new Set([
    '.github/workflows',
    'package.json',
    'apps/web/package.json',
    ...['stylegan-js', 'browser-model-manager', 'cloudflare-model-host', 'model-conv'].map(
      (p) => `packages/${p}/package.json`,
    ),
    ...map.modules.flatMap((m) => [m.path, ...m.tests]),
    ...map.capabilities.map((c) => c.path),
  ]);
  for (const p of paths) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    cpSync(join(repo, p), join(root, p), { recursive: true });
  }
  return root;
}

test('every mapped module, its CI-listed tests and the runtime capabilities survive in the repository', () => {
  assert.equal(map.modules.length, 19);
  assert.deepEqual(scanSurvival(repo, map), []);
});

test('a real copy scans clean; a planted deletion of a listed module fails', () => {
  const root = copy();
  try {
    assert.deepEqual(scanSurvival(root, map), []);
    rmSync(join(root, 'apps/web/src/Next/storage-request.mjs'));
    assert.deepEqual(scanSurvival(root, map), [
      'storage-request.mjs: missing at apps/web/src/Next/storage-request.mjs and not found elsewhere',
    ]);
    // Only a webgl-execution-only or native-only tag excuses an absent module.
    const tagged = {
      ...map,
      modules: map.modules.map((m) =>
        m.module === 'storage-request.mjs' ? { ...m, tag: 'native-only' as const } : m,
      ),
    };
    assert.deepEqual(scanSurvival(root, tagged), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a module moved into a package without a module map update fails; the map update passes', () => {
  const root = copy();
  try {
    const to = 'packages/stylegan-js/src/engine/png.mjs';
    mkdirSync(dirname(join(root, to)), { recursive: true });
    renameSync(join(root, 'apps/web/src/Next/browser/png.mjs'), join(root, to));
    assert.deepEqual(scanSurvival(root, map), [
      `browser/png.mjs: moved to ${to} without a module map update (map says apps/web/src/Next/browser/png.mjs)`,
    ]);
    const updated = {
      ...map,
      modules: map.modules.map((m) => (m.module === 'browser/png.mjs' ? { ...m, path: to } : m)),
    };
    assert.deepEqual(scanSurvival(root, updated), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a listed test no CI command runs, and a removed runtime capability, each fail', () => {
  const root = copy();
  try {
    const workflow = join(root, '.github/workflows/next-site-artifact.yml');
    writeFileSync(
      workflow,
      readFileSync(workflow, 'utf8').replaceAll(' src/Next/storage-request.test.mjs', ''),
    );
    const worker = join(root, 'apps/web/src/Next/browser/ort-worker.mjs');
    writeFileSync(
      worker,
      readFileSync(worker, 'utf8').replace('Math.max(1,Math.min(4,', 'Math.max(1,Math.min(8,'),
    );
    assert.deepEqual(scanSurvival(root, map), [
      'storage-request.mjs: listed test apps/web/src/Next/storage-request.test.mjs is not run by any CI test command',
      'cpu-thread-bounds-1-4: not found in apps/web/src/Next/browser/ort-worker.mjs (/Math\\.max\\(1,Math\\.min\\(4,/)',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
