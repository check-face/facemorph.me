#!/usr/bin/env node
// Acquisition checks every asset's size and digest again on a hit. Unrelated inventory edits
// must not turn the same multi-gigabyte runtime into a cold cache on every runner.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function runtimeCacheKey(inputs) {
  const assets = inputs?.runtime?.assets;
  assert(Array.isArray(assets) && assets.length > 0, 'Runtime asset inventory required');
  return createHash('sha256').update(JSON.stringify(assets)).digest('hex');
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(runtimeCacheKey(JSON.parse(readFileSync('import/build-inputs.json', 'utf8'))));
