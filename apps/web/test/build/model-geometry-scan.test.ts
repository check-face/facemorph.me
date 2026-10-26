// No FFHQ geometry hardcoded in the rewired app (fm-dmlz): runtime.mjs, ort-worker.mjs and the bridge read the
// side, W+ shape and pixel bytes from the shipped model's descriptor (engineGeometry(FFHQ_1024_DESCRIPTOR)). The
// patterns are the package source scan's (packages/stylegan-js/test/engine/source-scan.test.ts): the 1024 px side
// and its pixel counts, and the 18 x 512 W+. Comments are skipped. Unlike the package scan, byte arithmetic on the
// side (`1024*1024*4` pixel bytes) is geometry here and is caught; MiB conversions of byte counts are allowed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const FILES = [
  'src/Next/browser/runtime.mjs',
  'src/Next/browser/ort-worker.mjs',
  'src/Next/product-bridge.mjs',
] as const;
const PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: '1024', re: /(?<![\w.])1024(?![\w.])/g },
  { name: '1024 squared', re: /\b1048576\b|\b1_048_576\b/g },
  { name: '18x512', re: /\b18\s*[,x*×]\s*512\b|\blayers:\s*18\b|\b9216\b/g },
  { name: '3 or 32 x 1024 x 1024', re: /\b3145728\b|\b33554432\b/g },
];
/** Allowed: a byte count in MiB or a byte limit, which are sizes of files and storage, not model dimensions. */
const BYTES =
  /(sizeMb|usageMb|quotaMb):[^,;]*\/1048576|\b\d+\*1024\*1024\b|\b1024\*1024\?'small'|\bsize<1024\*1024\b/g;

const code = (text: string) =>
  text
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');

export function geometryHits(text: string): string[] {
  const hits: string[] = [];
  const lines = code(text).split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(BYTES, '');
    for (const p of PATTERNS)
      for (const m of line.matchAll(p.re))
        hits.push(`${i + 1}: ${p.name}: ${line.slice(Math.max(0, m.index - 40), m.index + 30)}`);
  });
  return hits;
}

test('model-geometry scan: no hardcoded 1024 or 18 x 512 in runtime.mjs, ort-worker.mjs or the bridge', () => {
  for (const file of FILES) {
    const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.deepEqual(geometryHits(text), [], file);
  }
});

test('model-geometry scan: a planted literal side, W+ shape or pixel-byte check is caught; MiB conversions are not', () => {
  assert.equal(geometryHits('canvas.width=1024;').length, 1);
  assert.equal(geometryHits('shape:[1,18,512]').length, 1);
  assert.equal(geometryHits('rgba.byteLength!==1024*1024*4').length, 2);
  assert.equal(geometryHits('const n=9216;').length, 1);
  assert.deepEqual(
    geometryHits('sizeMb:planned/1048576,usageMb:Math.round(status.usage/1048576)'),
    [],
  );
  assert.deepEqual(geometryHits('if(raw.byteLength>4*1024*1024)throw Error()'), []);
  assert.deepEqual(geometryHits('// FFHQ is 1024 x 1024, W+ 18x512'), []);
});
