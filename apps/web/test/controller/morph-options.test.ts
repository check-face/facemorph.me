// fm-36ag: Custom frames per face and the video size choice, as pure rules.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  customFramesProblem,
  maxFramesPerFace,
  morphLengthSummary,
  targetVideoSize,
} from '../../src/controller/morph-options.ts';

test('custom frames: any whole number from 2 up to the frame budget, with an inline reason otherwise', () => {
  assert.equal(maxFramesPerFace(2), 2048);
  assert.equal(maxFramesPerFace(3), 1365);
  assert.equal(maxFramesPerFace(1), 2048, 'a single face is counted as the two-face minimum');
  for (const ok of ['2', '7', '16', ' 33 ', '2048'])
    assert.equal(customFramesProblem(ok, 2), '', ok);
  assert.equal(customFramesProblem('1365', 3), '');
  for (const bad of ['', ' ', '0', '1', '1.5', '-4', '1e3', 'ten', '2049'])
    assert.match(
      customFramesProblem(bad, 2),
      /^Enter a whole number from 2 to 2,048/,
      JSON.stringify(bad),
    );
  assert.match(customFramesProblem('1', 2), /at least 2 frames per face/);
  assert.equal(
    customFramesProblem('1366', 3),
    'Enter a whole number from 2 to 1,365: 3 faces × 1,366 frames is over the 4,096-frame limit for one morph.',
  );
});

test('length summary: total frames and video length always; the estimate only for long measured morphs', () => {
  assert.equal(morphLengthSummary(32, 16, null), '32 frames total · 2.0 s video');
  assert.equal(
    morphLengthSummary(64, 16, 500),
    '64 frames total · 4.0 s video',
    'short morphs need no estimate',
  );
  assert.equal(
    morphLengthSummary(320, 16, 500),
    '320 frames total · 20 s video · about 3 minutes to make on this device',
  );
  assert.equal(morphLengthSummary(4096, 16, undefined), '4,096 frames total · 256 s video');
});

test('video size: Standard is 512 or the model size if smaller; Full quality is the model size', () => {
  assert.equal(targetVideoSize('standard', 1024), 512);
  assert.equal(targetVideoSize('full', 1024), 1024);
  assert.equal(targetVideoSize('standard', 512), 512);
  assert.equal(targetVideoSize('full', 512), 512, 'a 512 model has no larger Full quality');
  assert.equal(targetVideoSize('standard', 256), 256, 'never upscaled');
});
