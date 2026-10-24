import assert from 'node:assert/strict';
import test from 'node:test';
import { PACKAGE } from '../src/index.ts';

test('the placeholder names itself', () => {
  assert.equal(PACKAGE, '@facemorph/browser-model-manager');
});
