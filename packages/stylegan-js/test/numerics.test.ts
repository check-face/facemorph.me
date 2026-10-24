import assert from 'node:assert/strict';
import { test } from 'node:test';
import { E4E_LATENT_TOLERANCE, EXPORT_QUALITY_RULES, PRODUCT_CANARY_TOLERANCE, checkE4eLatent, checkSynthesis } from '../src/index.ts';

test('tolerances are the candidate values and cite their source', () => {
  assert.equal(PRODUCT_CANARY_TOLERANCE.maxRgbDiff, 1);
  assert.equal(PRODUCT_CANARY_TOLERANCE.maxSampledRawFloatError, 0.002);
  assert.equal(E4E_LATENT_TOLERANCE.maxAbsError, 0.0001);
  assert.match(PRODUCT_CANARY_TOLERANCE.source.file, /canary-qualification\.mjs$/);
  assert.match(E4E_LATENT_TOLERANCE.source.file, /encoder-preflight\.mjs$/);
  assert.ok(Object.isFrozen(PRODUCT_CANARY_TOLERANCE) && Object.isFrozen(E4E_LATENT_TOLERANCE));
});

test('checks keep the raw differences and pass only within tolerance', () => {
  assert.deepEqual(checkSynthesis('seed-1', 'webgpu', 1, 0.002), { name: 'seed-1', route: 'webgpu', maxRgbDiff: 1, maxSampledRawFloatError: 0.002, passed: true });
  assert.equal(checkSynthesis('seed-1', 'cpu', 2, 0).passed, false);
  assert.equal(checkSynthesis('seed-1', 'cpu', 0, 0.0021).passed, false);
  assert.equal(checkSynthesis('seed-1', 'cpu', Number.NaN, 0).passed, false);
  assert.equal(checkE4eLatent('photo', 'cpu', 0.0001).passed, true);
  assert.equal(checkE4eLatent('photo', 'cpu', 0.00011).maxAbsError, 0.00011);
  assert.equal(checkE4eLatent('photo', 'cpu', 0.00011).passed, false);
});

test('inherited image-hash assertions are non-gates; the five quality gates are gates', () => {
  const gates = EXPORT_QUALITY_RULES.filter((r) => r.isGate).map((r) => r.id);
  assert.deepEqual(gates, ['dimensions', 'orientation', 'valid-format-and-playback', 'lossless-decode-equals-supplied-pixels', 'recovery-envelope-regenerated']);
  assert.deepEqual(EXPORT_QUALITY_RULES.filter((r) => !r.isGate).map((r) => r.id), ['encoded-byte-identity', 'decoded-lossy-equality']);
});
