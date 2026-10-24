import assert from 'node:assert/strict';
import test from 'node:test';
import { HOOK, scan } from './scan-test-hook.mjs';
import { plant, tempDir } from '../../scripts/inventory/testing.mjs';

test('a production build without the hook passes; one carrying it is named', () => {
  const clean = plant(tempDir('hook-'), { 'index.html': '<!doctype html>', 'app.js': 'console.log(1)' });
  assert.deepEqual(scan(clean), { files: 2, hits: [] });
  const leaked = plant(tempDir('hook-'), { 'index.html': '<!doctype html>', 'js/app.js': `if(window.${HOOK})detect=()=>0` });
  assert.equal(scan(leaked).hits.length, 1);
  assert.match(scan(leaked).hits[0], /js\/app\.js$/);
});
