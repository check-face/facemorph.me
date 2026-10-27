// The eight EXIF orientations at the app layer (fm-9jnt): the end-to-end crop acceptance drives orientations 1, 3, 6
// and 8 through the built UI; here every one of the eight is checked on the same stored pixels. The header reads the
// tag under the legacy-ignore-exif policy without changing the dimensions, and the browser decode copy drops the EXIF
// segment so every orientation decodes to the same bytes (stylegan-js confirmed-crop.orientation-1..8 covers the
// encoder input for each).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
// @ts-expect-error the app module is plain JavaScript
import { browserDecodeBytes } from '../../src/Next/photo/crop.mjs';
// @ts-expect-error the app module is plain JavaScript
import { inspectImage } from '../../src/Next/photo/image-header.mjs';
import { withOrientation } from '../support/crop-fixtures.ts';

const oriented = readFileSync(
  join(fileURLToPath(new URL('../../../../', import.meta.url)), 'tests/crop/fixtures/oriented.jpg'),
);

test('every EXIF orientation 1-8: the tag is read, ignored, and stripped from the decode copy', () => {
  const plain = inspectImage(new Uint8Array(oriented));
  const decoded = new Set<string>();
  for (let o = 1; o <= 8; o++) {
    const file = new Uint8Array(withOrientation(oriented, o));
    const header = inspectImage(file);
    assert.equal(header.exifOrientation, o, `orientation ${o} read`);
    assert.equal(header.orientationPolicy, 'legacy-ignore-exif');
    assert.deepEqual(
      [header.width, header.height],
      [plain.width, plain.height],
      `${o}: stored size`,
    );
    const copy = file.slice();
    const clean = browserDecodeBytes(file);
    assert.deepEqual(file, copy, `${o}: the chosen file is unchanged`);
    assert.equal(inspectImage(clean).exifOrientation, 1, `${o}: no orientation left to apply`);
    decoded.add(Buffer.from(clean).toString('base64'));
  }
  assert.equal(decoded.size, 1, 'all eight orientations decode the same bytes');
});
