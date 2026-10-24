// The estimate's wording rule, with plain values and the candidate's own duration wording (estimate.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error -- the candidate's estimate.mjs has no declarations; it is called here exactly as the bridge calls it
import { describeMeasuredMs, describeMs } from '../../src/Next/estimate.mjs';
import { estimateText } from '../../shell/render/estimate.ts';

const base = { perFace: 4000, perFrame: '', describeMs, describeMeasuredMs };

test('a prior is never worded as measured here, and a measurement always is', () => {
  const prior = estimateText({ ...base, frames: 32, measuredHere: false });
  const measured = estimateText({ ...base, frames: 32, measuredHere: true });
  assert.doesNotMatch(prior, /On this device/);
  assert.match(prior, /^On similar devices a face takes .+, so a 32-frame morph would take .+\. This device's own timing replaces this estimate after the first face\.$/);
  assert.match(measured, /^On this device a face took .+, so a 32-frame morph should take .+\.$/);
});

test('without a morph to plan, only the per-face sentence is said', () => {
  assert.match(estimateText({ ...base, frames: 0, measuredHere: true }), /^On this device a face took [^,]+\.$/);
  assert.match(estimateText({ ...base, frames: 0, measuredHere: false }), /^On similar devices a face takes [^,]+\. This device's own timing/);
});

test('per-frame wording joins the measured sentence in brackets', () => {
  assert.match(estimateText({ ...base, frames: 16, measuredHere: true, perFrame: 'about 1 s a frame' }), /\(about 1 s a frame\), so a 16-frame morph/);
});
