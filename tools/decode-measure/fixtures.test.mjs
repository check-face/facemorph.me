#!/usr/bin/env node
// fm-4cp: fixtures are generated, metadata-free and exactly what fixtures.json pins.
// The JPEG/PNG walkers here are pure byte checks - no image library, no fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIR = `${ROOT}tools/decode-measure/`;
const manifest = JSON.parse(readFileSync(`${DIR}fixtures.json`, 'utf8'));

export function jpegSegments(buffer) {
  const segments = [];
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    segments.push({ marker, start: offset + 4, length: length - 2 });
    offset += 2 + length;
    if (marker === 0xda) break; // start of scan
  }
  return segments;
}

export function jpegDimensions(buffer) {
  for (const segment of jpegSegments(buffer)) {
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(segment.marker)) {
      return { height: buffer.readUInt16BE(segment.start + 1), width: buffer.readUInt16BE(segment.start + 3) };
    }
  }
  return null;
}

export function pngChunks(buffer) {
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    chunks.push({ type, length });
    offset += 12 + length;
  }
  return chunks;
}

test('manifest fixtures exist, match their pins and carry no metadata', () => {
  for (const [name, spec] of Object.entries(manifest.fixtures)) {
    if (spec.generated_at_measure_time) continue; // pinned recipe, generated per run, checked there
    const body = readFileSync(`${ROOT}${spec.path}`);
    assert.equal(createHash('sha256').update(body).digest('hex'), spec.sha256, `${name} sha256`);
    assert.equal(body.length, spec.bytes, `${name} bytes`);
    if (name.endsWith('.jpg')) {
      const segments = jpegSegments(body);
      for (const segment of segments) {
        const text = body.toString('latin1', segment.start, segment.start + Math.min(segment.length, 64));
        const offence = segment.marker === 0xfe ? 'JPEG comment'
          : segment.marker === 0xe1 && text.startsWith('Exif') ? 'EXIF'
          : segment.marker === 0xed ? 'Photoshop IRB'
          : segment.marker === 0xee && text.includes('XMP') ? 'XMP' : null;
        assert.equal(offence, null, `${name} metadata: ${offence}`);
      }
      const dims = jpegDimensions(body);
      assert.ok(dims, `${name} has a SOF`);
      assert.equal(dims.width * dims.height, spec.pixels, `${name} pixels`);
    } else {
      const chunks = pngChunks(body);
      for (const chunk of chunks) {
        assert.ok(!['tEXt', 'iTXt', 'zTXt', 'eXIf'].includes(chunk.type), `${name} metadata chunk ${chunk.type}`);
      }
      assert.equal(body.readUInt32BE(16) * body.readUInt32BE(20), spec.pixels, `${name} pixels`);
    }
  }
});

test('the limits come from the candidate crop.mjs values', () => {
  assert.equal(manifest.limits.CROP_MAX_BYTES, 64 * 1024 * 1024);
  assert.equal(manifest.limits.CROP_MAX_PIXELS, 120 * 1024 * 1024);
  assert.equal(manifest.limits.CROP_MAX_EDGE, 20000);
});

test('fixtures sit under the limits they stress', () => {
  assert.ok(manifest.fixtures['typical.jpg'].bytes < manifest.limits.CROP_MAX_BYTES);
  assert.ok(manifest.fixtures['max-pixels.jpg'].pixels <= manifest.limits.CROP_MAX_PIXELS);
  assert.ok(manifest.fixtures['max-edge.png'].pixels <= manifest.limits.CROP_MAX_PIXELS);
  assert.ok(manifest.fixtures['max-compressed.jpg'].recipe.bytes <= manifest.limits.CROP_MAX_BYTES);
  assert.ok(manifest.fixtures['max-compressed.jpg'].recipe.bytes > manifest.limits.CROP_MAX_BYTES * 0.9, 'the compressed fixture is close to the limit, not tiny');
});
