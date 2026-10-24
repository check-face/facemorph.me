// The verification fixtures (fm-48bj): every one present at its digest, of the kind its name says.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fixtureFindings, fixturePath, FIXTURES } from '../verify/fixtures.ts';

test('every fixture is present at its recorded digest', () => {
  assert.deepEqual(fixtureFindings(), []);
  assert.ok(Object.keys(FIXTURES).length >= 11);
});

test('each fixture is what its name says', () => {
  const bytes = (id: keyof typeof FIXTURES) => readFileSync(fixturePath(id));
  const webp = bytes('photo-one-face');
  assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
  for (const chunk of ['EXIF', 'XMP '])
    assert.equal(webp.includes(chunk), false, `no ${chunk} chunk`);
  assert.ok(
    bytes('photo-rotated-exif').subarray(0, 64).includes('Exif'),
    'the rotated photo has EXIF',
  );
  const v1 = bytes('still-recovery-v1');
  assert.ok(v1.includes('"schema":1'), 'schema 1 still');
  for (const id of [
    'still-recovery-v2',
    'still-recovery-v2-webp',
    'still-model-mismatch-v2',
  ] as const)
    assert.ok(bytes(id).length > 0);
  assert.equal(bytes('project-mp4').subarray(4, 8).toString(), 'ftyp');
  assert.ok(bytes('project-mp4').includes('FaceMorphProject'), 'the project box is in the MP4');
  assert.notEqual(
    bytes('still-damaged-v1').toString('hex'),
    v1.toString('hex'),
    'the damaged still differs from the intact one',
  );
});
